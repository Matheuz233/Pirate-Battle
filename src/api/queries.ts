import { keepPreviousData, QueryClient, queryOptions, type QueryKey } from '@tanstack/react-query';
import { api, ApiError, toApiError } from './client';
import { DEFAULT_PAGE_SIZE, type MatchConfigSnapshot, type Page } from './contracts';

export const queryKeys = {
  ranking: ['ranking'] as const,
  rankingPage: (bucket: MatchConfigSnapshot, page: number) =>
    ['ranking', 'page', bucket.sessionTimeSec, bucket.spawnIntervalSec, bucket.configVersion, page] as const,
  rankingBuckets: ['ranking', 'buckets'] as const,
  history: ['history'] as const,
  historyPage: (playerId: string, page: number) => ['history', playerId, page] as const,
};

export function shouldRetry(failureCount: number, error: unknown): boolean {
  const e = toApiError(error);
  return e.retryable && failureCount < 2;
}

export function retryDelay(attempt: number): number {
  return Math.min(4000, 400 * 2 ** attempt);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

/**
 * Guards against late responses: if the cache already holds data with a newer server
 * revision for the same key, the older response is discarded and the cached data is kept.
 */
function keepNewest<T extends Page<unknown>>(client: QueryClient, key: QueryKey, incoming: T): T {
  const cached = client.getQueryData<T>(key);
  if (cached && cached.revision > incoming.revision) return cached;
  return incoming;
}

export function rankingPageQuery(bucket: MatchConfigSnapshot, page: number) {
  return queryOptions({
    queryKey: queryKeys.rankingPage(bucket, page),
    queryFn: async ({ signal, client, queryKey }) =>
      keepNewest(client, queryKey, await api.getRanking({ ...bucket, page, pageSize: DEFAULT_PAGE_SIZE }, signal)),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

export function rankingBucketsQuery() {
  return queryOptions({
    queryKey: queryKeys.rankingBuckets,
    queryFn: ({ signal }) => api.getRankingBuckets(signal),
    refetchOnMount: 'always',
  });
}

export function historyPageQuery(playerId: string, page: number) {
  return queryOptions({
    queryKey: queryKeys.historyPage(playerId, page),
    queryFn: async ({ signal, client, queryKey }) =>
      keepNewest(client, queryKey, await api.getMatchHistory(playerId, { page, pageSize: DEFAULT_PAGE_SIZE }, signal)),
    placeholderData: keepPreviousData,
    refetchOnMount: 'always',
  });
}

export function errorMessage(error: unknown): string {
  const e = error instanceof ApiError ? error : toApiError(error);
  return e.message;
}
