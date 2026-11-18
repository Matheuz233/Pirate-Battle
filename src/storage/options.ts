import { SESSION_LIMITS, SPAWN_LIMITS, type PlayerSettings } from '../game/config/gameConfig';
import { PersistentStore, STORAGE_KEYS, isRecord } from './localStore';

export interface GameOptions extends PlayerSettings {
  soundEnabled: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  sessionTimeSec: SESSION_LIMITS.default,
  spawnIntervalSec: SPAWN_LIMITS.default,
  soundEnabled: true,
};

export type OptionsErrors = Partial<Record<'sessionTimeSec' | 'spawnIntervalSec', string>>;

function isStep(value: number, step: number, min: number): boolean {
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < 1e-6;
}

/** Validates raw form values. Returns typed options or field errors (messages are user-facing). */
export function validateOptions(raw: {
  sessionTimeSec: string | number;
  spawnIntervalSec: string | number;
  soundEnabled: boolean;
}): { ok: true; value: GameOptions } | { ok: false; errors: OptionsErrors } {
  const errors: OptionsErrors = {};
  const session = typeof raw.sessionTimeSec === 'number' ? raw.sessionTimeSec : Number(String(raw.sessionTimeSec).trim());
  const spawn = typeof raw.spawnIntervalSec === 'number' ? raw.spawnIntervalSec : Number(String(raw.spawnIntervalSec).trim().replace(',', '.'));

  if (String(raw.sessionTimeSec).trim() === '' || !Number.isFinite(session)) {
    errors.sessionTimeSec = 'Enter the session time in seconds.';
  } else if (!Number.isInteger(session)) {
    errors.sessionTimeSec = 'Session time must be a whole number of seconds.';
  } else if (session < SESSION_LIMITS.min || session > SESSION_LIMITS.max) {
    errors.sessionTimeSec = `Session time must be between ${SESSION_LIMITS.min} and ${SESSION_LIMITS.max} seconds.`;
  }

  if (String(raw.spawnIntervalSec).trim() === '' || !Number.isFinite(spawn)) {
    errors.spawnIntervalSec = 'Enter the spawn interval in seconds.';
  } else if (spawn <= 0) {
    errors.spawnIntervalSec = 'Spawn interval must be greater than zero.';
  } else if (spawn < SPAWN_LIMITS.min || spawn > SPAWN_LIMITS.max) {
    errors.spawnIntervalSec = `Spawn interval must be between ${SPAWN_LIMITS.min} and ${SPAWN_LIMITS.max} seconds.`;
  } else if (!isStep(spawn, SPAWN_LIMITS.step, SPAWN_LIMITS.min)) {
    errors.spawnIntervalSec = `Spawn interval must use steps of ${SPAWN_LIMITS.step} seconds.`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { sessionTimeSec: session, spawnIntervalSec: spawn, soundEnabled: raw.soundEnabled } };
}

function isOptions(v: unknown): v is GameOptions {
  if (!isRecord(v)) return false;
  const r = validateOptions({
    sessionTimeSec: v.sessionTimeSec as number,
    spawnIntervalSec: v.spawnIntervalSec as number,
    soundEnabled: Boolean(v.soundEnabled),
  });
  return r.ok && typeof v.soundEnabled === 'boolean';
}

export const optionsStore = new PersistentStore<GameOptions>(STORAGE_KEYS.options, isOptions, () => ({ ...DEFAULT_OPTIONS }));
