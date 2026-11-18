import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { api, toApiError } from './client';
import type { MatchSubmission, SubmitMatchResponse } from './contracts';
import { queryKeys, retryDelay } from './queries';
import { enqueueSubmission, outboxStore, updateSubmissionState } from '../storage/matches';

interface SubmissionApi {
  /** Persists the match in the outbox and sends it. Safe to call repeatedly. */
  record(submission: MatchSubmission): void;
  /** Re-sends one pending match (or all when omitted). Duplicate calls are ignored while in flight. */
  retry(matchId?: string): void;
}

const SubmissionContext = createContext<SubmissionApi | null>(null);

export const SUBMIT_MUTATION_KEY = ['matches', 'submit'] as const;

/**
 * Owns the "submit match" mutation (TanStack Query) and the pending-submission outbox.
 * - Exactly-once on the server is guaranteed by the idempotency key (matchId).
 * - At-least-once delivery is guaranteed by the outbox: entries are removed only after a
 *   confirmed response, survive refreshes and are retried on startup / reconnect / demand.
 */
export function SubmissionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const inFlight = useRef(new Set<string>());

  const mutation = useMutation<SubmitMatchResponse, Error, MatchSubmission>({
    mutationKey: SUBMIT_MUTATION_KEY,
    mutationFn: (submission) => api.submitMatch(submission),
    retry: (count, error) => toApiError(error).retryable && count < 2,
    retryDelay,
    onMutate: (submission) => updateSubmissionState(submission.matchId, 'sending'),
    onSuccess: async (_res, submission) => {
      updateSubmissionState(submission.matchId, 'saved');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.ranking }),
        queryClient.invalidateQueries({ queryKey: queryKeys.history }),
      ]);
    },
    onError: (error, submission) => updateSubmissionState(submission.matchId, 'failed', toApiError(error).message),
    onSettled: (_d, _e, submission) => {
      inFlight.current.delete(submission.matchId);
    },
  });

  const { mutate } = mutation;

  const send = useCallback(
    (submission: MatchSubmission) => {
      if (inFlight.current.has(submission.matchId)) return;
      inFlight.current.add(submission.matchId);
      mutate(submission);
    },
    [mutate],
  );

  const retry = useCallback(
    (matchId?: string) => {
      for (const entry of outboxStore.get()) {
        if (!matchId || entry.submission.matchId === matchId) send(entry.submission);
      }
    },
    [send],
  );

  const record = useCallback(
    (submission: MatchSubmission) => {
      enqueueSubmission(submission);
      send(submission);
    },
    [send],
  );

  // Recover pending submissions after a refresh and whenever connectivity returns.
  useEffect(() => {
    retry();
    const onOnline = () => retry();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [retry]);

  const value = useMemo(() => ({ record, retry }), [record, retry]);
  return <SubmissionContext.Provider value={value}>{children}</SubmissionContext.Provider>;
}

export function useSubmissions(): SubmissionApi {
  const ctx = useContext(SubmissionContext);
  if (!ctx) throw new Error('useSubmissions must be used inside <SubmissionProvider>');
  return ctx;
}
