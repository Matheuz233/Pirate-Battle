import { isMatchSubmission, type MatchSubmission } from '../api/contracts';
import { PersistentStore, STORAGE_KEYS, isRecord } from './localStore';

export type SubmissionState = 'pending' | 'sending' | 'failed' | 'saved';

export interface LastResult {
  submission: MatchSubmission;
  state: SubmissionState;
  /** Last error message shown to the player, if any. */
  error: string | null;
}

export interface OutboxEntry {
  submission: MatchSubmission;
  state: Exclude<SubmissionState, 'saved'>;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

function isLastResult(v: unknown): v is LastResult {
  return (
    isRecord(v) &&
    isMatchSubmission(v.submission) &&
    (v.state === 'pending' || v.state === 'sending' || v.state === 'failed' || v.state === 'saved')
  );
}

function isOutbox(v: unknown): v is OutboxEntry[] {
  return Array.isArray(v) && v.every((e) => isRecord(e) && isMatchSubmission(e.submission) && typeof e.attempts === 'number');
}

/** Result of the last completed match (survives refresh). */
export const lastResultStore = new PersistentStore<LastResult | null>(
  STORAGE_KEYS.lastResult,
  (v): v is LastResult | null => v === null || isLastResult(v),
  () => null,
);

/**
 * Pending submissions (transactional outbox). A completed match is written here before the
 * first network attempt, so it survives failures and refreshes until the server confirms it.
 * A "sending" entry found at startup means the page was closed mid-request: it is retried.
 */
export const outboxStore = new PersistentStore<OutboxEntry[]>(
  STORAGE_KEYS.outbox,
  isOutbox,
  () => [],
);

export function enqueueSubmission(submission: MatchSubmission): void {
  outboxStore.set((list) =>
    list.some((e) => e.submission.matchId === submission.matchId)
      ? list
      : [...list, { submission, state: 'pending', attempts: 0, lastError: null, updatedAt: new Date().toISOString() }],
  );
  lastResultStore.set({ submission, state: 'pending', error: null });
}

export function updateSubmissionState(matchId: string, state: SubmissionState, error: string | null = null): void {
  if (state === 'saved') {
    outboxStore.set((list) => list.filter((e) => e.submission.matchId !== matchId));
  } else {
    outboxStore.set((list) =>
      list.map((e) =>
        e.submission.matchId === matchId
          ? {
              ...e,
              state,
              attempts: state === 'sending' ? e.attempts + 1 : e.attempts,
              lastError: error,
              updatedAt: new Date().toISOString(),
            }
          : e,
      ),
    );
  }
  const last = lastResultStore.get();
  if (last && last.submission.matchId === matchId) lastResultStore.set({ ...last, state, error });
}
