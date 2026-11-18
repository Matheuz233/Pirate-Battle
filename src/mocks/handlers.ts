import { delay, http, HttpResponse } from 'msw';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  compareRanking,
  isMatchSubmission,
  type ApiErrorBody,
  type MatchPage,
  type MatchRecord,
  type RankingBucket,
  type RankingPage,
  type SubmitMatchResponse,
} from '../api/contracts';
import { Rng } from '../game/core/rng';
import { fixtures, loadDb, sameSubmission, saveDb } from './db';
import { readScenario, type ScenarioSettings } from './scenarios';

type Endpoint = 'ranking' | 'buckets' | 'history' | 'submit';

let rng = new Rng(42);
let rngSeed = 42;
let requestCounter = 0;

function scenarioRng(s: ScenarioSettings): Rng {
  if (s.seed !== rngSeed) {
    rngSeed = s.seed;
    rng = new Rng(s.seed);
    requestCounter = 0;
  }
  return rng;
}

/** Resets jitter RNG and counters (called by the "reset" action of the network lab). */
export function resetHandlerState(): void {
  rngSeed = Number.NaN;
  requestCounter = 0;
}

function error(status: number, code: string, message: string) {
  return HttpResponse.json<ApiErrorBody>({ code, message }, { status });
}

/**
 * Applies the selected scenario for one request: waits the simulated latency and returns an
 * error response when the scenario says this request must fail (or null to continue).
 */
async function applyScenario(endpoint: Endpoint): Promise<Response | null> {
  const s = readScenario();
  const r = scenarioRng(s);
  const n = ++requestCounter;
  const wait = (ms: number) => delay(Math.round(ms * s.latencyScale));

  switch (s.name) {
    case 'slow':
      await wait(2500);
      break;
    case 'variable-latency':
      await wait(r.range(100, 3000));
      break;
    case 'out-of-order':
      // Odd requests are slow, even ones fast: a newer request can answer before an older one.
      await wait(n % 2 === 1 ? 1800 : 150);
      break;
    case 'timeout':
      await delay('infinite');
      break;
    default:
      await wait(r.range(200, 600));
  }

  switch (s.name) {
    case 'network-error':
      return HttpResponse.error();
    case 'server-error':
      return error(500, 'internal_error', 'The server failed to process the request.');
    case 'client-error':
      return endpoint === 'submit'
        ? error(422, 'invalid_match', 'The match record was rejected by the server.')
        : error(400, 'bad_request', 'The request parameters were rejected by the server.');
    case 'flaky':
      return r.next() < 0.5 ? error(503, 'unavailable', 'Service temporarily unavailable.') : null;
    case 'ranking-error':
      return endpoint === 'ranking' || endpoint === 'buckets' ? error(503, 'ranking_unavailable', 'Ranking service is unavailable.') : null;
    case 'history-error':
      return endpoint === 'history' ? error(500, 'history_unavailable', 'Match history service failed.') : null;
    case 'submit-offline':
      return endpoint === 'submit' ? HttpResponse.error() : null;
    default:
      return null;
  }
}

function allRecords(): { records: MatchRecord[]; revision: number } {
  const s = readScenario();
  const db = loadDb();
  const kind = s.name === 'empty' ? 'none' : s.name === 'many-pages' ? 'many' : 'base';
  return { records: [...fixtures(kind), ...db.records], revision: db.revision };
}

function pageParams(url: URL): { page: number; pageSize: number } | null {
  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) return null;
  return { page, pageSize };
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalItems, totalPages };
}

export const handlers = [
  http.get('/api/ranking/buckets', async () => {
    const failure = await applyScenario('buckets');
    if (failure) return failure;
    const { records } = allRecords();
    const map = new Map<string, RankingBucket>();
    for (const r of records) {
      const key = `${r.config.sessionTimeSec}|${r.config.spawnIntervalSec}|${r.config.configVersion}`;
      const b = map.get(key) ?? { ...r.config, matches: 0 };
      b.matches++;
      map.set(key, b);
    }
    const list = [...map.values()].sort((a, b) => b.matches - a.matches || a.sessionTimeSec - b.sessionTimeSec);
    return HttpResponse.json(list);
  }),

  http.get('/api/ranking', async ({ request }) => {
    const failure = await applyScenario('ranking');
    if (failure) return failure;
    const url = new URL(request.url);
    const p = pageParams(url);
    const sessionTimeSec = Number(url.searchParams.get('sessionTimeSec'));
    const spawnIntervalSec = Number(url.searchParams.get('spawnIntervalSec'));
    const configVersion = Number(url.searchParams.get('configVersion') ?? '1');
    if (!p || !sessionTimeSec || !spawnIntervalSec) return error(400, 'bad_request', 'Invalid ranking query.');
    const { records, revision } = allRecords();
    const ranked = records
      .filter(
        (r) =>
          r.config.sessionTimeSec === sessionTimeSec &&
          r.config.spawnIntervalSec === spawnIntervalSec &&
          r.config.configVersion === configVersion,
      )
      .sort(compareRanking)
      .map((r, i) => ({
        rank: i + 1,
        matchId: r.matchId,
        playerId: r.playerId,
        playerName: r.playerName,
        score: r.score,
        durationMs: r.durationMs,
        endReason: r.endReason,
        playedAt: r.playedAt,
      }));
    const body: RankingPage = {
      ...paginate(ranked, p.page, p.pageSize),
      revision,
      bucket: { sessionTimeSec, spawnIntervalSec, configVersion },
    };
    return HttpResponse.json(body);
  }),

  http.get('/api/players/:playerId/matches', async ({ request, params }) => {
    const failure = await applyScenario('history');
    if (failure) return failure;
    const p = pageParams(new URL(request.url));
    if (!p) return error(400, 'bad_request', 'Invalid pagination parameters.');
    const playerId = String(params.playerId);
    const { records, revision } = allRecords();
    const mine = records
      .filter((r) => r.playerId === playerId)
      .sort((a, b) => b.playedAt.localeCompare(a.playedAt) || b.matchId.localeCompare(a.matchId));
    const body: MatchPage = { ...paginate(mine, p.page, p.pageSize), revision };
    return HttpResponse.json(body);
  }),

  http.post('/api/matches', async ({ request }) => {
    const s = readScenario();
    // Validate and persist before simulating network trouble so the submit-timeout
    // scenario really stores the record and then loses the response.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error(400, 'bad_json', 'Body must be JSON.');
    }
    const key = request.headers.get('Idempotency-Key');
    if (!isMatchSubmission(body)) return error(422, 'invalid_match', 'Invalid match record.');
    if (key && key !== body.matchId) return error(400, 'bad_idempotency_key', 'Idempotency-Key must equal matchId.');

    if (s.name === 'submit-timeout') {
      const db = loadDb();
      if (!db.droppedOnce.includes(body.matchId) && !db.records.some((r) => r.matchId === body.matchId)) {
        db.records.push({ ...body, recordedAt: new Date().toISOString() });
        db.revision++;
        db.droppedOnce.push(body.matchId);
        saveDb(db);
        await delay('infinite');
      }
    } else {
      const failure = await applyScenario('submit');
      if (failure) return failure;
    }

    const db = loadDb();
    const existing = db.records.find((r) => r.matchId === body.matchId);
    if (existing) {
      if (!sameSubmission(existing, body)) {
        return error(409, 'conflict', 'A different record already exists for this match id.');
      }
      return HttpResponse.json<SubmitMatchResponse>({ match: existing, created: false }, { status: 200 });
    }
    const record: MatchRecord = { ...body, recordedAt: new Date().toISOString() };
    db.records.push(record);
    db.revision++;
    saveDb(db);
    return HttpResponse.json<SubmitMatchResponse>({ match: record, created: true }, { status: 201 });
  }),
];
