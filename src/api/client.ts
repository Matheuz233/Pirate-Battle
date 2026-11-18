import axios, { AxiosError, type AxiosInstance } from 'axios';
import type {
  ApiErrorBody,
  MatchPage,
  MatchSubmission,
  RankingBucket,
  RankingPage,
  SubmitMatchResponse,
} from './contracts';

const DEFAULT_TIMEOUT_MS = 8000;

function resolveTimeout(): number {
  const fromUrl = Number(new URLSearchParams(window.location.search).get('apiTimeout'));
  if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
  const fromEnv = Number(import.meta.env.VITE_API_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_TIMEOUT_MS;
}

export const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: resolveTimeout(),
  headers: { Accept: 'application/json' },
});

export type ApiErrorKind = 'timeout' | 'network' | 'client' | 'server' | 'cancelled' | 'unknown';

/** Normalised error used by the UI and by the retry policy. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get retryable(): boolean {
    return this.kind === 'timeout' || this.kind === 'network' || this.kind === 'server' || this.status === 429;
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (axios.isCancel(err)) return new ApiError('cancelled', 'Request cancelled.');
  if (err instanceof AxiosError) {
    if (err.code === AxiosError.ECONNABORTED || err.code === AxiosError.ETIMEDOUT) {
      return new ApiError('timeout', 'The server took too long to respond.');
    }
    if (!err.response) return new ApiError('network', 'Could not reach the server. Check your connection.');
    const status = err.response.status;
    const body = err.response.data as Partial<ApiErrorBody> | undefined;
    const message = body?.message ?? `Request failed with status ${status}.`;
    return new ApiError(status >= 500 ? 'server' : 'client', message, status, body?.code);
  }
  return new ApiError('unknown', err instanceof Error ? err.message : 'Unexpected error.');
}

async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await fn()).data;
  } catch (err) {
    throw toApiError(err);
  }
}

export const api = {
  getRanking(
    params: { sessionTimeSec: number; spawnIntervalSec: number; configVersion: number; page: number; pageSize: number },
    signal?: AbortSignal,
  ): Promise<RankingPage> {
    return call(() => http.get<RankingPage>('/ranking', { params, signal }));
  },

  getRankingBuckets(signal?: AbortSignal): Promise<RankingBucket[]> {
    return call(() => http.get<RankingBucket[]>('/ranking/buckets', { signal }));
  },

  getMatchHistory(
    playerId: string,
    params: { page: number; pageSize: number },
    signal?: AbortSignal,
  ): Promise<MatchPage> {
    return call(() => http.get<MatchPage>(`/players/${encodeURIComponent(playerId)}/matches`, { params, signal }));
  },

  /** Idempotent: re-sending the same matchId returns the stored record (`created: false`). */
  submitMatch(submission: MatchSubmission): Promise<SubmitMatchResponse> {
    return call(() =>
      http.post<SubmitMatchResponse>('/matches', submission, { headers: { 'Idempotency-Key': submission.matchId } }),
    );
  },
};
