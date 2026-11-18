import type { EnemyKind, GameConfig, ShipStats, WeaponConfig } from '../config/gameConfig';
import { ARENA_MAP, islandRects, type ArenaMap } from '../config/arenaMap';
import {
  DEG,
  approach,
  circleRectPush,
  clamp,
  dist2,
  pointInRect,
  rotateTowards,
  wrapAngle,
  type Rect,
} from '../core/math';
import { Rng } from '../core/rng';
import { FlowField, hasLineOfSight } from './navigation';
import type { EndReason, InputFrame, MatchStatus, Projectile, Ship, SimEvent, Team, WeaponId } from './types';

const PLAYER_VARIANT = 2; // black sails with skull
const ENEMY_VARIANTS: Record<EnemyKind, readonly number[]> = { chaser: [3], shooter: [5] };

/**
 * Deterministic, render-agnostic match simulation.
 *
 * - Advanced only through `step(dt, input)` with a fixed dt, so behaviour is independent
 *   of the frame rate.
 * - Never touches the DOM, PixiJS or timers; everything it needs comes from the config
 *   snapshot, the seed and the per-step input.
 * - Side effects for presentation (sounds, particles, HUD) are published as `SimEvent`s.
 */
export class World {
  readonly config: Readonly<GameConfig>;
  readonly map: ArenaMap;
  readonly islands: readonly Rect[];
  readonly rng: Rng;

  status: MatchStatus = 'running';
  endReason: EndReason | null = null;
  score = 0;
  stepCount = 0;
  /** Count of enemies spawned per kind (diagnostics and tests). */
  readonly spawned: Record<EnemyKind, number> = { chaser: 0, shooter: 0 };
  readonly kills: Record<EnemyKind, number> = { chaser: 0, shooter: 0 };

  player: Ship;
  readonly enemies: Ship[] = [];
  readonly projectiles: Projectile[] = [];
  readonly events: SimEvent[] = [];

  private nextId = 1;
  private spawnTimer: number;
  private spawnIndex = 0;
  private pathTimer = 0;
  private readonly durationSteps: number;
  private readonly flow: FlowField;
  private readonly spawnCandidates: { x: number; y: number }[];

  constructor(config: Readonly<GameConfig>, seed: number, map: ArenaMap = ARENA_MAP) {
    this.config = config;
    this.map = map;
    this.islands = islandRects(map);
    this.rng = new Rng(seed);
    this.durationSteps = Math.round(config.session.durationSec / config.simulation.fixedStepSec);
    this.spawnTimer = Math.min(config.spawn.initialDelaySec, config.spawn.intervalSec);
    const maxEnemyRadius = Math.max(config.chaser.radius, config.shooter.radius);
    this.flow = new FlowField(map.width, map.height, config.ai.navCellSize, this.islands, maxEnemyRadius);
    this.spawnCandidates = this.buildSpawnCandidates();
    this.player = this.createShip('player', map.playerStart.x, map.playerStart.y, map.playerStart.heading, PLAYER_VARIANT);
    this.flow.update(this.player.x, this.player.y, true);
  }

  get elapsedSec(): number {
    return this.stepCount * this.config.simulation.fixedStepSec;
  }

  get timeLeftSec(): number {
    return Math.max(0, (this.durationSteps - this.stepCount) * this.config.simulation.fixedStepSec);
  }

  get aliveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /** Clears the event queue and returns its previous content. */
  drainEvents(out: SimEvent[]): SimEvent[] {
    for (const e of this.events) out.push(e);
    this.events.length = 0;
    return out;
  }

  step(dt: number, input: InputFrame): void {
    if (this.status !== 'running') return;
    this.stepCount++;

    this.updatePlayer(dt, input);
    this.updateSpawner(dt);
    this.updateEnemies(dt);
    this.resolveShipContacts();
    this.updateProjectiles(dt);
    this.removeDead();

    if (!this.player.alive) this.end('destroyed');
    else if (this.stepCount >= this.durationSteps) this.end('time_up');
  }

  /* ------------------------------------------------------------------ ships */

  private createShip(kind: Ship['kind'], x: number, y: number, heading: number, variant: number): Ship {
    const stats = this.statsOf(kind);
    return {
      id: this.nextId++,
      kind,
      team: kind === 'player' ? 'player' : 'enemy',
      x,
      y,
      heading,
      speed: 0,
      hp: stats.maxHealth,
      maxHp: stats.maxHealth,
      radius: stats.radius,
      alive: true,
      cooldowns: { front: 0, left: 0, right: 0, enemy: 0 },
      variant,
    };
  }

  private statsOf(kind: Ship['kind']): ShipStats {
    return kind === 'player' ? this.config.player : kind === 'chaser' ? this.config.chaser : this.config.shooter;
  }

  private tickCooldowns(ship: Ship, dt: number): void {
    const c = ship.cooldowns;
    c.front = Math.max(0, c.front - dt);
    c.left = Math.max(0, c.left - dt);
    c.right = Math.max(0, c.right - dt);
    c.enemy = Math.max(0, c.enemy - dt);
  }

  /** Moves a ship forward along its heading and resolves island/arena collisions. */
  private moveShip(ship: Ship, dt: number): void {
    ship.x += Math.cos(ship.heading) * ship.speed * dt;
    ship.y += Math.sin(ship.heading) * ship.speed * dt;
    this.resolveStatic(ship);
  }

  /** Pushes a ship out of islands and keeps it inside the arena. Returns true on contact. */
  private resolveStatic(ship: Ship): boolean {
    let touched = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const rect of this.islands) {
        const push = circleRectPush(ship.x, ship.y, ship.radius, rect);
        if (push) {
          ship.x += push.x;
          ship.y += push.y;
          touched = true;
        }
      }
    }
    const r = ship.radius;
    const nx = clamp(ship.x, r, this.map.width - r);
    const ny = clamp(ship.y, r, this.map.height - r);
    if (nx !== ship.x || ny !== ship.y) touched = true;
    ship.x = nx;
    ship.y = ny;
    if (touched) ship.speed = Math.min(ship.speed, this.statsOf(ship.kind).maxSpeed * 0.6);
    return touched;
  }

  private updatePlayer(dt: number, input: InputFrame): void {
    const p = this.player;
    const cfg = this.config.player;
    this.tickCooldowns(p, dt);
    const turn = (input.turnRight ? 1 : 0) - (input.turnLeft ? 1 : 0);
    p.heading = wrapAngle(p.heading + turn * cfg.turnRateDeg * DEG * dt);
    p.speed = input.forward ? approach(p.speed, cfg.maxSpeed, cfg.acceleration * dt) : approach(p.speed, 0, cfg.drag * dt);
    this.moveShip(p, dt);

    if (input.fireFront && p.cooldowns.front <= 0) {
      p.cooldowns.front = cfg.frontCannon.cooldownMs / 1000;
      this.fire(p, 'front', cfg.frontCannon, p.heading, 0, [0]);
    }
    const side = cfg.sideCannons;
    const offsets: number[] = [];
    for (let i = 0; i < side.count; i++) offsets.push((i - (side.count - 1) / 2) * side.spacing);
    if (input.fireLeft && p.cooldowns.left <= 0) {
      p.cooldowns.left = side.cooldownMs / 1000;
      this.fire(p, 'left', side, p.heading - Math.PI / 2, 0, offsets);
    }
    if (input.fireRight && p.cooldowns.right <= 0) {
      p.cooldowns.right = side.cooldownMs / 1000;
      this.fire(p, 'right', side, p.heading + Math.PI / 2, 0, offsets);
    }
  }

  /**
   * Spawns projectiles from a ship. `offsets` are distances along the hull (heading axis)
   * so broadsides fire parallel balls from bow to stern.
   */
  private fire(ship: Ship, weapon: WeaponId, w: WeaponConfig, angle: number, _spread: number, offsets: number[]): void {
    const team: Team = ship.team;
    const fx = Math.cos(ship.heading);
    const fy = Math.sin(ship.heading);
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const muzzle = ship.radius + w.projectileRadius + 2;
    for (const off of offsets) {
      const x = ship.x + dx * muzzle + fx * off;
      const y = ship.y + dy * muzzle + fy * off;
      this.projectiles.push({
        id: this.nextId++,
        team,
        ownerId: ship.id,
        weapon,
        x,
        y,
        vx: dx * w.speed,
        vy: dy * w.speed,
        damage: w.damage,
        radius: w.projectileRadius,
        ttl: w.range / w.speed,
      });
      this.events.push({ type: 'shot', weapon, team, x, y, angle });
    }
  }

  /* ---------------------------------------------------------------- spawner */

  private buildSpawnCandidates(): { x: number; y: number }[] {
    const inset = this.config.spawn.edgeInset;
    const { width, height } = this.map;
    const pts: { x: number; y: number }[] = [];
    const step = 64;
    for (let x = inset; x <= width - inset; x += step) {
      pts.push({ x, y: inset }, { x, y: height - inset });
    }
    for (let y = inset + step; y <= height - inset - step; y += step) {
      pts.push({ x: inset, y }, { x: width - inset, y });
    }
    const clearance = Math.max(this.config.chaser.radius, this.config.shooter.radius) + 6;
    return pts.filter((p) => !this.islands.some((r) => pointInRect(p.x, p.y, r, clearance)));
  }

  private updateSpawner(dt: number): void {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    const sp = this.config.spawn;
    if (this.aliveEnemies >= sp.maxAlive) {
      // At the cap: wait for the next interval.
      this.spawnTimer += sp.intervalSec;
      return;
    }
    const kind: EnemyKind = sp.openingSequence[this.spawnIndex] ?? this.rng.weighted(sp.distribution);
    const point = this.pickSpawnPoint(kind);
    if (!point) {
      this.spawnTimer = sp.retryDelaySec;
      return;
    }
    this.spawnIndex++;
    this.spawnTimer += sp.intervalSec;
    if (this.spawnTimer <= 0) this.spawnTimer = sp.intervalSec;
    const heading = Math.atan2(this.player.y - point.y, this.player.x - point.x);
    const ship = this.createShip(kind, point.x, point.y, heading, this.rng.pick(ENEMY_VARIANTS[kind]));
    // Stagger enemy fire so a fresh shooter never fires on the spawn frame.
    ship.cooldowns.enemy = this.config.shooter.cannon.cooldownMs / 1000;
    this.enemies.push(ship);
    this.spawned[kind]++;
    this.events.push({ type: 'spawn', id: ship.id, kind });
  }

  private pickSpawnPoint(kind: EnemyKind): { x: number; y: number } | null {
    const sp = this.config.spawn;
    const minP = sp.minDistanceFromPlayer ** 2;
    const minS = sp.minDistanceFromShips ** 2;
    const radius = this.statsOf(kind).radius;
    const valid = this.spawnCandidates.filter((c) => {
      if (dist2(c.x, c.y, this.player.x, this.player.y) < minP) return false;
      if (this.islands.some((r) => circleRectPush(c.x, c.y, radius + 4, r))) return false;
      for (const e of this.enemies) if (e.alive && dist2(c.x, c.y, e.x, e.y) < minS) return false;
      return true;
    });
    if (valid.length === 0) return null;
    return this.rng.pick(valid);
  }

  /* -------------------------------------------------------------------- AI */

  private updateEnemies(dt: number): void {
    this.pathTimer -= dt;
    if (this.pathTimer <= 0) {
      this.pathTimer = this.config.ai.pathRefreshSec;
      this.flow.update(this.player.x, this.player.y);
    }
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      this.tickCooldowns(e, dt);
      const stats = this.statsOf(e.kind);
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const distance = Math.hypot(dx, dy);
      const sees = hasLineOfSight(e.x, e.y, p.x, p.y, this.islands, e.radius * 0.8);
      let desired = Math.atan2(dy, dx);
      if (!sees) {
        const wp = this.flow.nextWaypoint(e.x, e.y);
        if (wp) desired = Math.atan2(wp.y - e.y, wp.x - e.x);
      }
      let throttle = 1;
      if (e.kind === 'shooter') {
        const s = this.config.shooter;
        if (sees && distance <= s.preferredDistance) throttle = 0.15;
        else if (sees && distance <= s.attackRange) throttle = 0.45;
        if (sees && distance <= s.attackRange) {
          desired = Math.atan2(dy, dx);
          const aimError = Math.abs(wrapAngle(desired - e.heading));
          if (aimError <= s.aimToleranceDeg * DEG && e.cooldowns.enemy <= 0) {
            e.cooldowns.enemy = s.cannon.cooldownMs / 1000;
            this.fire(e, 'enemy', s.cannon, e.heading, 0, [0]);
          }
        }
      }
      e.heading = rotateTowards(e.heading, desired, stats.turnRateDeg * DEG * dt);
      const turnPenalty = clamp(Math.cos(wrapAngle(desired - e.heading)), 0.35, 1);
      const target = stats.maxSpeed * throttle * turnPenalty;
      e.speed = approach(e.speed, target, (e.speed < target ? stats.acceleration : stats.drag) * dt);
      this.moveShip(e, dt);
    }
  }

  /** Ship-vs-ship contacts: chaser rams, soft separation for everything else. */
  private resolveShipContacts(): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive || !p.alive) continue;
      const rr = e.radius + p.radius;
      const d2 = dist2(e.x, e.y, p.x, p.y);
      if (d2 >= rr * rr) continue;
      if (e.kind === 'chaser') {
        const dmg = this.config.chaser.contactDamage;
        this.damage(p, dmg);
        this.events.push({ type: 'ram', id: e.id, x: e.x, y: e.y, damage: dmg });
        this.events.push({ type: 'hit', x: (e.x + p.x) / 2, y: (e.y + p.y) / 2, targetId: p.id, targetKind: 'player', damage: dmg });
        this.kill(e, false);
      } else {
        this.separate(e, p, Math.sqrt(d2), rr);
        this.events.push({ type: 'collision', x: (e.x + p.x) / 2, y: (e.y + p.y) / 2 });
      }
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j]!;
        if (!b.alive) continue;
        const rr = a.radius + b.radius;
        const d2 = dist2(a.x, a.y, b.x, b.y);
        if (d2 < rr * rr) this.separate(a, b, Math.sqrt(d2), rr);
      }
    }
  }

  private separate(a: Ship, b: Ship, d: number, rr: number): void {
    const overlap = rr - d;
    const nx = d > 1e-6 ? (a.x - b.x) / d : 1;
    const ny = d > 1e-6 ? (a.y - b.y) / d : 0;
    a.x += nx * overlap * 0.5;
    a.y += ny * overlap * 0.5;
    b.x -= nx * overlap * 0.5;
    b.y -= ny * overlap * 0.5;
    this.resolveStatic(a);
    this.resolveStatic(b);
  }

  /* ----------------------------------------------------------- projectiles */

  private updateProjectiles(dt: number): void {
    const list = this.projectiles;
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const pr = list[i]!;
      if (this.advanceProjectile(pr, dt)) list[write++] = pr;
    }
    list.length = write;
  }

  /** Returns false when the projectile must be removed. Damage is applied at most once. */
  private advanceProjectile(pr: Projectile, dt: number): boolean {
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.ttl -= dt;
    const { width, height } = this.map;
    if (pr.x < 0 || pr.y < 0 || pr.x > width || pr.y > height) return false;
    for (const rect of this.islands) {
      if (pointInRect(pr.x, pr.y, rect, pr.radius)) {
        this.events.push({ type: 'splash', x: pr.x, y: pr.y, onLand: true });
        return false;
      }
    }
    if (pr.team === 'player') {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const rr = e.radius + pr.radius;
        if (dist2(pr.x, pr.y, e.x, e.y) < rr * rr) {
          this.events.push({ type: 'hit', x: pr.x, y: pr.y, targetId: e.id, targetKind: e.kind, damage: pr.damage });
          this.damage(e, pr.damage);
          if (e.hp <= 0) this.kill(e, true);
          return false;
        }
      }
    } else {
      const p = this.player;
      const rr = p.radius + pr.radius;
      if (p.alive && dist2(pr.x, pr.y, p.x, p.y) < rr * rr) {
        this.events.push({ type: 'hit', x: pr.x, y: pr.y, targetId: p.id, targetKind: 'player', damage: pr.damage });
        this.damage(p, pr.damage);
        return false;
      }
    }
    if (pr.ttl <= 0) {
      this.events.push({ type: 'splash', x: pr.x, y: pr.y, onLand: false });
      return false;
    }
    return true;
  }

  private damage(ship: Ship, amount: number): void {
    if (!ship.alive || this.status !== 'running') return;
    ship.hp = Math.max(0, ship.hp - amount);
    if (ship.kind === 'player' && ship.hp <= 0) {
      ship.alive = false;
      this.events.push({ type: 'destroyed', id: ship.id, kind: 'player', x: ship.x, y: ship.y, heading: ship.heading, variant: ship.variant, byPlayer: false });
    }
  }

  private kill(ship: Ship, byPlayer: boolean): void {
    if (!ship.alive) return;
    ship.alive = false;
    ship.hp = Math.min(ship.hp, 0);
    this.events.push({ type: 'destroyed', id: ship.id, kind: ship.kind, x: ship.x, y: ship.y, heading: ship.heading, variant: ship.variant, byPlayer });
    if (byPlayer && ship.kind !== 'player' && this.player.alive) {
      this.score += 1;
      this.kills[ship.kind]++;
      this.events.push({ type: 'score', score: this.score });
    }
  }

  private removeDead(): void {
    let write = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (e.alive) this.enemies[write++] = e;
    }
    this.enemies.length = write;
  }

  private end(reason: EndReason): void {
    if (this.status === 'ended') return;
    this.status = 'ended';
    this.endReason = reason;
    this.events.push({ type: 'ended', reason });
  }
}
