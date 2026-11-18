import type { EndReason } from '../sim/types';

export type EnginePhase = 'loading' | 'ready' | 'running' | 'paused' | 'ended' | 'error';
export type PauseReason = 'manual' | 'focus' | 'hidden' | 'orientation';

export interface MatchSummary {
  score: number;
  durationMs: number;
  endReason: EndReason;
}

/** Low-frequency snapshot consumed by React. Only changes when a displayed value changes. */
export interface HudSnapshot {
  phase: EnginePhase;
  pauseReason: PauseReason | null;
  score: number;
  /** Whole seconds remaining (ceil), so the HUD updates once per second. */
  timeLeftSec: number;
  hp: number;
  maxHp: number;
  enemies: number;
  loadProgress: number;
  error: string | null;
  summary: MatchSummary | null;
}

type Listener = () => void;

/**
 * Tiny external store bridging the simulation and React (`useSyncExternalStore`).
 * The engine calls `patch` every frame, but listeners fire only when something changed,
 * so React never re-renders at frame rate.
 */
export class GameStore {
  private snapshot: HudSnapshot;
  private readonly listeners = new Set<Listener>();

  constructor(initial: HudSnapshot) {
    this.snapshot = initial;
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): HudSnapshot => this.snapshot;

  patch(partial: Partial<HudSnapshot>): void {
    let changed = false;
    for (const key of Object.keys(partial) as (keyof HudSnapshot)[]) {
      if (!Object.is(this.snapshot[key], partial[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...partial };
    this.listeners.forEach((l) => l());
  }

  clear(): void {
    this.listeners.clear();
  }
}

export function initialHud(maxHp: number, durationSec: number): HudSnapshot {
  return {
    phase: 'loading',
    pauseReason: null,
    score: 0,
    timeLeftSec: durationSec,
    hp: maxHp,
    maxHp,
    enemies: 0,
    loadProgress: 0,
    error: null,
    summary: null,
  };
}
