import type { EnemyKind, ShipKind } from '../config/gameConfig';

export type MatchStatus = 'running' | 'ended';
export type EndReason = 'time_up' | 'destroyed';
export type WeaponId = 'front' | 'left' | 'right' | 'enemy';
export type Team = 'player' | 'enemy';

/** Input sampled once per simulation step. */
export interface InputFrame {
  forward: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  fireFront: boolean;
  fireLeft: boolean;
  fireRight: boolean;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  forward: false,
  turnLeft: false,
  turnRight: false,
  fireFront: false,
  fireLeft: false,
  fireRight: false,
});

export interface Ship {
  id: number;
  kind: ShipKind;
  team: Team;
  x: number;
  y: number;
  /** Heading in radians; 0 = +x (east), PI/2 = +y (south, screen down). */
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  radius: number;
  alive: boolean;
  /** Remaining cooldown per weapon, in seconds. */
  cooldowns: Record<WeaponId, number>;
  /** Visual variant (sail color) chosen at spawn. */
  variant: number;
}

export interface Projectile {
  id: number;
  team: Team;
  ownerId: number;
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  /** Remaining lifetime in seconds (range / speed). */
  ttl: number;
}

export type SimEvent =
  | { type: 'shot'; weapon: WeaponId; team: Team; x: number; y: number; angle: number }
  | { type: 'hit'; x: number; y: number; targetId: number; targetKind: ShipKind; damage: number }
  | { type: 'splash'; x: number; y: number; onLand: boolean }
  | { type: 'spawn'; id: number; kind: EnemyKind }
  | { type: 'destroyed'; id: number; kind: ShipKind; x: number; y: number; heading: number; variant: number; byPlayer: boolean }
  | { type: 'ram'; id: number; x: number; y: number; damage: number }
  | { type: 'collision'; x: number; y: number }
  | { type: 'score'; score: number }
  | { type: 'ended'; reason: EndReason };
