import type { DeepPartial, GameConfig } from '../game/config/gameConfig';

/**
 * Test / diagnostics flags read from the URL query string, e.g.
 *   /?test=1&seed=7&clock=manual&overrides={"spawn":{"maxAlive":0}}#/play
 * Instrumentation only observes state and controls the clock; game rules, input,
 * collisions and rendering always run for real.
 */
export interface TestFlags {
  enabled: boolean;
  seed: number | null;
  manualClock: boolean;
  overrides: DeepPartial<GameConfig> | undefined;
  resolution: number | undefined;
  perfOverlay: boolean;
  resultDelayMs: number;
}

function parse(): TestFlags {
  const p = new URLSearchParams(window.location.search);
  const enabled = p.get('test') === '1';
  let overrides: DeepPartial<GameConfig> | undefined;
  if (enabled && p.get('overrides')) {
    try {
      overrides = JSON.parse(p.get('overrides')!) as DeepPartial<GameConfig>;
    } catch {
      console.warn('[test] Ignoring invalid overrides JSON');
    }
  }
  const seed = p.get('seed');
  const res = Number(p.get('resolution'));
  return {
    enabled,
    seed: seed !== null && Number.isFinite(Number(seed)) ? Number(seed) : null,
    manualClock: enabled && p.get('clock') === 'manual',
    overrides,
    resolution: Number.isFinite(res) && res > 0 ? res : undefined,
    perfOverlay: p.get('perf') === '1',
    resultDelayMs: enabled ? Number(p.get('resultDelay') ?? '300') : 1600,
  };
}

export const testFlags: TestFlags = parse();
