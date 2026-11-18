import { test as base, expect, type Page } from '@playwright/test';

/** Shape returned by `window.__PIRATE__.getState()` (subset used by the tests). */
export interface DebugState {
  phase: 'loading' | 'ready' | 'running' | 'paused' | 'ended' | 'error';
  status: 'running' | 'ended';
  endReason: 'time_up' | 'destroyed' | null;
  score: number;
  stepCount: number;
  elapsedSec: number;
  timeLeftSec: number;
  spawned: { chaser: number; shooter: number };
  kills: { chaser: number; shooter: number };
  arena: { width: number; height: number };
  islands: { x: number; y: number; w: number; h: number }[];
  player: { id: number; x: number; y: number; heading: number; speed: number; hp: number; maxHp: number; radius: number; alive: boolean; cooldowns: Record<string, number> };
  enemies: { id: number; kind: 'chaser' | 'shooter'; x: number; y: number; heading: number; speed: number; hp: number; maxHp: number; radius: number }[];
  projectiles: { id: number; team: 'player' | 'enemy'; weapon: string; x: number; y: number; vx: number; vy: number; damage: number }[];
  config: Record<string, unknown> & {
    session: { durationSec: number };
    spawn: { intervalSec: number; minDistanceFromPlayer: number; initialDelaySec: number };
    player: { turnRateDeg: number; frontCannon: { cooldownMs: number; damage: number }; sideCannons: { damage: number; cooldownMs: number } };
    chaser: { contactDamage: number };
    shooter: { attackRange: number; cannon: { damage: number } };
  };
  render: { ships: number; projectiles: number; particles: number } | null;
}

export interface AppSetup {
  /** Mock API scenario (default: success with zero latency). */
  scenario?: string;
  latencyScale?: number;
  mockSeed?: number;
  options?: { sessionTimeSec: number; spawnIntervalSec: number; soundEnabled?: boolean };
  playerName?: string;
}

const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /GL Driver Message/i,
  /WebGL/i,
  /\[MSW\]/,
  /Download the React DevTools/i,
];

/**
 * Seeds localStorage once per test (not on reloads, so persistence can be verified),
 * and fails the test on unexpected console errors or uncaught exceptions.
 */
export const test = base.extend<{ setup: (s?: AppSetup) => Promise<void>; consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((r) => r.test(text))) return;
      errors.push(text);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    await use(errors);
    expect(errors, 'unexpected console errors').toEqual([]);
  },
  setup: async ({ page, consoleErrors: _ }, use) => {
    await use(async (s: AppSetup = {}) => {
      const payload = {
        scenario: { name: s.scenario ?? 'success', seed: s.mockSeed ?? 1, latencyScale: s.latencyScale ?? 0 },
        options: s.options ? { soundEnabled: false, ...s.options } : null,
        playerName: s.playerName ?? 'Test Captain',
      };
      await page.addInitScript((p) => {
        if (sessionStorage.getItem('__pb_seeded')) return;
        sessionStorage.setItem('__pb_seeded', '1');
        localStorage.setItem('pb.mock.scenario.v1', JSON.stringify(p.scenario));
        localStorage.setItem('pb.player.v1', JSON.stringify({ playerId: 'player-e2e', playerName: p.playerName }));
        if (p.options) localStorage.setItem('pb.options.v1', JSON.stringify(p.options));
      }, payload);
    });
  },
});

export { expect };

export interface MatchSetup {
  seed?: number;
  manual?: boolean;
  overrides?: Record<string, unknown>;
  resultDelay?: number;
  apiTimeout?: number;
}

export function appUrl(m: MatchSetup = {}): string {
  const p = new URLSearchParams({ test: '1', seed: String(m.seed ?? 1) });
  if (m.manual !== false) p.set('clock', 'manual');
  if (m.overrides) p.set('overrides', JSON.stringify(m.overrides));
  if (m.resultDelay !== undefined) p.set('resultDelay', String(m.resultDelay));
  if (m.apiTimeout !== undefined) p.set('apiTimeout', String(m.apiTimeout));
  return `/?${p.toString()}#/`;
}

/** Opens the menu with test instrumentation and starts a match through the real UI. */
export async function startMatch(page: Page, m: MatchSetup = {}): Promise<void> {
  await page.goto(appUrl(m));
  await page.getByTestId('play-button').click();
  await waitForPhase(page, 'running');
}

export async function waitForPhase(page: Page, phase: DebugState['phase']): Promise<void> {
  await page.waitForFunction(
    (ph) => {
      const api = (window as unknown as { __PIRATE__?: { getState(): { phase: string } } }).__PIRATE__;
      return api?.getState().phase === ph;
    },
    phase,
    { timeout: 20_000 },
  );
}

export function getState(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as unknown as { __PIRATE__: { getState(): DebugState } }).__PIRATE__.getState());
}

/** Advances the real simulation (manual clock) by `ms` with whatever input is currently held. */
export function advance(page: Page, ms: number): Promise<number> {
  return page.evaluate((t) => (window as unknown as { __PIRATE__: { advance(ms: number): number } }).__PIRATE__.advance(t), ms);
}

/** Holds a key for `ms` of simulated time. */
export async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await advance(page, ms);
  await page.keyboard.up(key);
}

/** Taps a key and lets the simulation consume it. */
export async function tap(page: Page, key: string, ms = 1000 / 60): Promise<void> {
  await page.keyboard.press(key);
  await advance(page, ms);
}

/** Turns the player (with the real turn keys) until it faces (x, y) within `tolDeg`. */
export async function aimAt(page: Page, x: number, y: number, tolDeg = 2): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const s = await getState(page);
    const desired = Math.atan2(y - s.player.y, x - s.player.x);
    let diff = desired - s.player.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const deg = (diff * 180) / Math.PI;
    if (Math.abs(deg) <= tolDeg) return;
    const ms = Math.max(1000 / 60, (Math.abs(deg) / s.config.player.turnRateDeg) * 1000);
    await hold(page, deg > 0 ? 'KeyD' : 'KeyA', ms);
  }
  throw new Error('Could not aim at target');
}

/** Static, harmless enemies (no movement, no fire) for deterministic combat checks. */
export const STATIC_SHOOTER = {
  spawn: { openingSequence: ['shooter'], distribution: { chaser: 0, shooter: 1 }, maxAlive: 1, initialDelaySec: 0.1 },
  shooter: { maxSpeed: 0, turnRateDeg: 0, cannon: { cooldownMs: 1e9 } },
};

export const NO_SPAWNS = { spawn: { maxAlive: 0 } };

export async function finishMatchByTime(page: Page, sessionSec = 60): Promise<void> {
  await advance(page, sessionSec * 1000 + 100);
}
