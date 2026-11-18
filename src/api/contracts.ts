/**
 * Typed REST contracts shared by the Axios client, the MSW handlers and the tests.
 * Base path: /api
 *
 *   GET  /api/ranking?sessionTimeSec&spawnIntervalSec&page&pageSize  → RankingPage
 *   GET  /api/ranking/buckets                                        → RankingBucket[]
 *   GET  /api/players/:playerId/matches?page&pageSize                → MatchPage
 *   POST /api/matches   (header Idempotency-Key: <matchId>)          → SubmitMatchResponse
 */

export type EndReason = 'time_up' | 'destroyed';

export interface MatchConfigSnapshot {
  sessionTimeSec: number;
  spawnIntervalSec: number;
  /** GameConfig.version used for the match. Part of the ranking bucket. */
  configVersion: number;
}

export interface MatchSubmission {
  /** Client-generated UUID; doubles as the idempotency key. */
  matchId: string;
  playerId: string;
  playerName: string;
  /** ISO-8601 timestamp of when the match ended. */
  playedAt: string;
  score: number;
  /** Effective active play time (pauses excluded), in milliseconds. */
  durationMs: number;
  endReason: EndReason;
  config: MatchConfigSnapshot;
}

export interface MatchRecord extends MatchSubmission {
  /** Server time when the record was first stored. */
  recordedAt: string;
}

export interface SubmitMatchResponse {
  match: MatchRecord;
  /** false when the record already existed (retry / duplicate click). */
  created: boolean;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  /** Monotonic data revision of the server store, used to discard stale responses. */
  revision: number;
}

export interface RankingEntry {
  rank: number;
  matchId: string;
  playerId: string;
  playerName: string;
  score: number;
  durationMs: number;
  endReason: EndReason;
  playedAt: string;
}

export interface RankingPage extends Page<RankingEntry> {
  bucket: MatchConfigSnapshot;
}

export type MatchPage = Page<MatchRecord>;

export interface RankingBucket extends MatchConfigSnapshot {
  matches: number;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export const DEFAULT_PAGE_SIZE = 5;
export const MAX_PAGE_SIZE = 50;

/**
 * Deterministic ranking order for matches in the same bucket:
 * 1. higher score; 2. longer effective duration (survived longer);
 * 3. earlier playedAt (first to reach it); 4. matchId (lexicographic) as final tie-break.
 */
export function compareRanking(a: MatchSubmission, b: MatchSubmission): number {
  return (
    b.score - a.score ||
    b.durationMs - a.durationMs ||
    a.playedAt.localeCompare(b.playedAt) ||
    a.matchId.localeCompare(b.matchId)
  );
}

export function isMatchSubmission(v: unknown): v is MatchSubmission {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  const c = m.config as Record<string, unknown> | undefined;
  return (
    typeof m.matchId === 'string' &&
    m.matchId.length >= 8 &&
    typeof m.playerId === 'string' &&
    typeof m.playerName === 'string' &&
    typeof m.playedAt === 'string' &&
    !Number.isNaN(Date.parse(m.playedAt)) &&
    Number.isInteger(m.score) &&
    (m.score as number) >= 0 &&
    typeof m.durationMs === 'number' &&
    (m.durationMs as number) >= 0 &&
    (m.endReason === 'time_up' || m.endReason === 'destroyed') &&
    typeof c === 'object' &&
    c !== null &&
    typeof c.sessionTimeSec === 'number' &&
    typeof c.spawnIntervalSec === 'number' &&
    typeof c.configVersion === 'number'
  );
}
