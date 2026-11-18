/**
 * Central, typed gameplay configuration.
 *
 * Every balancing number used by the simulation lives here. Systems read from the
 * `GameConfig` snapshot they receive at match start and never hard-code values, so
 * balancing changes only require editing `DEFAULT_GAME_CONFIG` (or passing overrides).
 */

export type EnemyKind = 'chaser' | 'shooter';
export type ShipKind = 'player' | EnemyKind;

export interface WeaponConfig {
  /** Damage applied once per projectile. */
  damage: number;
  /** Projectile speed in world units per second. */
  speed: number;
  /** Maximum travel distance in world units. Lifetime = range / speed. */
  range: number;
  /** Minimum time between two shots of this weapon, in milliseconds. */
  cooldownMs: number;
  /** Collision radius of the projectile. */
  projectileRadius: number;
}

export interface BroadsideConfig extends WeaponConfig {
  /** Number of parallel projectiles fired per broadside. */
  count: number;
  /** Distance between parallel projectiles along the hull. */
  spacing: number;
}

export interface ShipStats {
  maxHealth: number;
  /** Collision radius used for ship/island/ship/projectile tests. */
  radius: number;
  /** Max forward speed in world units per second. */
  maxSpeed: number;
  /** Forward acceleration in units/s². */
  acceleration: number;
  /** Passive deceleration when not thrusting, in units/s². */
  drag: number;
  /** Rotation speed in degrees per second. */
  turnRateDeg: number;
}

export interface GameConfig {
  /** Bump when the meaning of the config changes (part of the ranking bucket key). */
  version: number;
  session: {
    /** Active match duration, in seconds. Allowed range: 60–180. */
    durationSec: number;
    /** Remaining seconds at which the HUD starts warning. */
    warningAtSec: number;
  };
  simulation: {
    /** Fixed simulation step in seconds. */
    fixedStepSec: number;
    /** Upper bound of simulation steps per rendered frame (spiral-of-death guard). */
    maxStepsPerFrame: number;
    /** Frame deltas above this are clamped (tab switches, debugger pauses). */
    maxFrameDeltaMs: number;
  };
  spawn: {
    /** Seconds between spawns. Allowed range: 0.5–10. */
    intervalSec: number;
    /** Delay before the first spawn. Capped by intervalSec. */
    initialDelaySec: number;
    /** Maximum number of alive enemies; spawns are skipped while at the cap. */
    maxAlive: number;
    /** Spawn points closer than this to the player are rejected. */
    minDistanceFromPlayer: number;
    /** Spawn points must be at least this far from other ships. */
    minDistanceFromShips: number;
    /** Relative weights used after the opening sequence. */
    distribution: Record<EnemyKind, number>;
    /** Enemy kinds spawned first, in order, so every match shows both types. */
    openingSequence: EnemyKind[];
    /** Distance from the arena edge where spawn candidates are placed. */
    edgeInset: number;
    /** Retry delay when no valid spawn point exists. */
    retryDelaySec: number;
  };
  player: ShipStats & {
    frontCannon: WeaponConfig;
    sideCannons: BroadsideConfig;
  };
  chaser: ShipStats & {
    /** Damage dealt to the player when the chaser rams it (the chaser explodes). */
    contactDamage: number;
  };
  shooter: ShipStats & {
    /** Distance at which the shooter starts firing. */
    attackRange: number;
    /** Distance the shooter tries to keep from the player. */
    preferredDistance: number;
    /** Maximum aim error, in degrees, for the shooter to fire. */
    aimToleranceDeg: number;
    cannon: WeaponConfig;
  };
  ai: {
    /** Seconds between flow-field recomputations. */
    pathRefreshSec: number;
    /** Size of a navigation grid cell in world units. */
    navCellSize: number;
  };
}

export const SESSION_LIMITS = { min: 60, max: 180, step: 1, default: 120 } as const;
export const SPAWN_LIMITS = { min: 0.5, max: 10, step: 0.5, default: 3 } as const;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  version: 1,
  session: { durationSec: SESSION_LIMITS.default, warningAtSec: 10 },
  simulation: { fixedStepSec: 1 / 60, maxStepsPerFrame: 6, maxFrameDeltaMs: 250 },
  spawn: {
    intervalSec: SPAWN_LIMITS.default,
    initialDelaySec: 1.5,
    maxAlive: 10,
    minDistanceFromPlayer: 360,
    minDistanceFromShips: 80,
    distribution: { chaser: 0.55, shooter: 0.45 },
    openingSequence: ['chaser', 'shooter'],
    edgeInset: 44,
    retryDelaySec: 0.25,
  },
  player: {
    maxHealth: 100,
    radius: 28,
    maxSpeed: 165,
    acceleration: 260,
    drag: 200,
    turnRateDeg: 150,
    frontCannon: { damage: 20, speed: 460, range: 440, cooldownMs: 450, projectileRadius: 5 },
    sideCannons: {
      damage: 15,
      speed: 400,
      range: 300,
      cooldownMs: 1200,
      projectileRadius: 5,
      count: 3,
      spacing: 18,
    },
  },
  chaser: {
    maxHealth: 40,
    radius: 25,
    maxSpeed: 120,
    acceleration: 200,
    drag: 200,
    turnRateDeg: 110,
    contactDamage: 25,
  },
  shooter: {
    maxHealth: 60,
    radius: 28,
    maxSpeed: 85,
    acceleration: 150,
    drag: 150,
    turnRateDeg: 95,
    attackRange: 320,
    preferredDistance: 230,
    aimToleranceDeg: 10,
    cannon: { damage: 10, speed: 330, range: 360, cooldownMs: 1700, projectileRadius: 5 },
  },
  ai: { pathRefreshSec: 0.25, navCellSize: 32 },
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeConfig<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return structuredClone(base);
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? mergeConfig(current, value) : structuredClone(value);
  }
  return out as T;
}

function deepFreeze<T>(obj: T): Readonly<T> {
  if (isPlainObject(obj) || Array.isArray(obj)) {
    Object.values(obj as object).forEach((v) => deepFreeze(v));
    Object.freeze(obj);
  }
  return obj;
}

export interface PlayerSettings {
  sessionTimeSec: number;
  spawnIntervalSec: number;
}

/**
 * Builds the immutable configuration snapshot used by one match.
 * Later changes to the options do not affect a match in progress.
 */
export function createMatchConfig(
  settings: PlayerSettings,
  overrides?: DeepPartial<GameConfig>,
): Readonly<GameConfig> {
  const merged = mergeConfig(DEFAULT_GAME_CONFIG, overrides);
  merged.session.durationSec = settings.sessionTimeSec;
  merged.spawn.intervalSec = settings.spawnIntervalSec;
  return deepFreeze(merged);
}

/** Key used to bucket ranking entries that were played with comparable settings. */
export function configBucketKey(c: { sessionTimeSec: number; spawnIntervalSec: number }): string {
  return `s${c.sessionTimeSec}-i${c.spawnIntervalSec}`;
}
