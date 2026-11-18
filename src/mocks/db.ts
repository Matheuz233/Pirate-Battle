import { Rng } from '../game/core/rng';
import type { MatchRecord, MatchSubmission } from '../api/contracts';
import { STORAGE_KEYS, isRecord, readJson, removeKey, writeJson } from '../storage/localStore';

/**
 * Mock "server" storage. Confirmed records are persisted in localStorage so they survive
 * refreshes (in development, tests and the published demo). Fixtures are generated
 * deterministically and never persisted.
 */
interface DbState {
  revision: number;
  records: MatchRecord[];
  /** Match ids whose first POST response is deliberately dropped (submit-timeout scenario). */
  droppedOnce: string[];
}

const EMPTY: DbState = { revision: 1, records: [], droppedOnce: [] };

function isDb(v: unknown): v is DbState {
  return isRecord(v) && typeof v.revision === 'number' && Array.isArray(v.records) && Array.isArray(v.droppedOnce);
}

export function loadDb(): DbState {
  return readJson(STORAGE_KEYS.mockDb, isDb) ?? structuredClone(EMPTY);
}

export function saveDb(db: DbState): void {
  writeJson(STORAGE_KEYS.mockDb, db);
}

export function resetDb(): void {
  removeKey(STORAGE_KEYS.mockDb);
}

const CAPTAINS = [
  'Captain Flint',
  'Red Sparrow',
  'Storm Rider',
  'Sea Wolf',
  'Anne Bonny',
  'Black Gull',
  'Salt Beard',
  'Iron Kate',
  'Grim Tide',
  'Lady Kraken',
  'Coral Jim',
  'Silver Fin',
];

const BUCKETS = [
  { sessionTimeSec: 120, spawnIntervalSec: 3 },
  { sessionTimeSec: 60, spawnIntervalSec: 2 },
  { sessionTimeSec: 180, spawnIntervalSec: 4 },
  { sessionTimeSec: 90, spawnIntervalSec: 3 },
];

function generate(count: number, seed: number, onlyFirstBucket: boolean, idPrefix: string): MatchRecord[] {
  const rng = new Rng(seed);
  const base = Date.UTC(2026, 8, 8, 12, 0, 0);
  const out: MatchRecord[] = [];
  for (let i = 0; i < count; i++) {
    const bucket = onlyFirstBucket ? BUCKETS[0]! : rng.pick(BUCKETS);
    const name = rng.pick(CAPTAINS);
    const destroyed = rng.next() < 0.35;
    const durationMs = destroyed ? Math.round(rng.range(0.3, 0.95) * bucket.sessionTimeSec * 1000) : bucket.sessionTimeSec * 1000;
    const playedAt = new Date(base - Math.floor(rng.range(0, 1000 * 60 * 60 * 24 * 20))).toISOString();
    out.push({
      matchId: `${idPrefix}-${String(i).padStart(4, '0')}`,
      playerId: `fixture-${CAPTAINS.indexOf(name)}`,
      playerName: name,
      playedAt,
      recordedAt: playedAt,
      score: Math.round(rng.range(2, 40) * (durationMs / (bucket.sessionTimeSec * 1000))),
      durationMs,
      endReason: destroyed ? 'destroyed' : 'time_up',
      config: { ...bucket, configVersion: 1 },
    });
  }
  return out;
}

const BASE_FIXTURES = generate(48, 2026, false, 'fx');
const EXTRA_FIXTURES = generate(150, 99, true, 'fx-many');

export function fixtures(kind: 'none' | 'base' | 'many'): MatchRecord[] {
  if (kind === 'none') return [];
  if (kind === 'many') return [...BASE_FIXTURES, ...EXTRA_FIXTURES];
  return BASE_FIXTURES;
}

export function sameSubmission(a: MatchSubmission, b: MatchSubmission): boolean {
  return (
    a.matchId === b.matchId &&
    a.playerId === b.playerId &&
    a.score === b.score &&
    a.durationMs === b.durationMs &&
    a.endReason === b.endReason &&
    a.config.sessionTimeSec === b.config.sessionTimeSec &&
    a.config.spawnIntervalSec === b.config.spawnIntervalSec
  );
}
