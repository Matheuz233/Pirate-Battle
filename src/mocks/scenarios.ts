import { STORAGE_KEYS, isRecord, readJson, writeJson } from '../storage/localStore';

export const SCENARIOS = {
  success: 'Success — normal latency (200–600 ms)',
  empty: 'Empty lists — no fixture players',
  'many-pages': 'Many pages — 150 extra fixture matches',
  slow: 'Slow — every response takes 2.5 s',
  'variable-latency': 'Variable latency — 100 ms to 3 s',
  'out-of-order': 'Out of order — earlier requests answer later',
  timeout: 'Timeout — the server never answers',
  'network-error': 'Connection failure — every request fails',
  'server-error': 'HTTP 500 on every request',
  'client-error': 'HTTP 4xx on every request',
  flaky: 'Flaky — ~50% of requests fail with 503',
  'ranking-error': 'Ranking query fails (503)',
  'history-error': 'Match history query fails (500)',
  'submit-timeout': 'Match is stored, but the first response times out',
  'submit-offline': 'Backend unavailable for match submission',
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export interface ScenarioSettings {
  name: ScenarioName;
  /** Seed for latency jitter and flaky failures (reproducible runs). */
  seed: number;
  /** Multiplies every artificial delay (0 = instant, used by tests). "Infinite" delays are kept. */
  latencyScale: number;
}

export const DEFAULT_SCENARIO: ScenarioSettings = { name: 'success', seed: 42, latencyScale: 1 };

function isScenario(v: unknown): v is ScenarioSettings {
  return (
    isRecord(v) &&
    typeof v.name === 'string' &&
    v.name in SCENARIOS &&
    typeof v.seed === 'number' &&
    typeof v.latencyScale === 'number'
  );
}

export function readScenario(): ScenarioSettings {
  return readJson(STORAGE_KEYS.mockScenario, isScenario) ?? DEFAULT_SCENARIO;
}

export function writeScenario(s: ScenarioSettings): void {
  writeJson(STORAGE_KEYS.mockScenario, s);
  window.dispatchEvent(new CustomEvent('pb:scenario-changed', { detail: s }));
}

/** Allows `?scenario=slow&mockSeed=7&latency=0` in the URL (handy for demos and bug reports). */
export function applyScenarioFromUrl(search: string): void {
  const params = new URLSearchParams(search);
  const name = params.get('scenario');
  if (!name && !params.has('latency') && !params.has('mockSeed')) return;
  const current = readScenario();
  const next: ScenarioSettings = {
    name: name && name in SCENARIOS ? (name as ScenarioName) : current.name,
    seed: params.has('mockSeed') ? Number(params.get('mockSeed')) || 0 : current.seed,
    latencyScale: params.has('latency') ? Math.max(0, Number(params.get('latency')) || 0) : current.latencyScale,
  };
  writeScenario(next);
}
