import { Container, Graphics, Sprite, TilingSprite, type Renderer, type Texture } from 'pixi.js';
import { TILE, islandTileAt, type ArenaMap } from '../config/arenaMap';
import type { GameTextures } from '../assets/gameAssets';
import type { World } from '../sim/world';
import type { Ship, SimEvent } from '../sim/types';
import { ParticleSystem } from './effects';

const SHIP_SCALE = 0.92;
const SPRITE_ROTATION_OFFSET = -Math.PI / 2; // ship art points down (+y)

/** Damage stage → offset added to the base ship frame (1..6 intact, +6, +12, +18 wreck). */
function damageStage(ship: Ship): number {
  const f = ship.hp / ship.maxHp;
  if (f > 0.66) return 0;
  if (f > 0.33) return 1;
  return 2;
}

class ShipView {
  readonly root = new Container();
  readonly hull: Sprite;
  readonly fires: Sprite[] = [];
  readonly bar = new Container();
  readonly barFill: Sprite;
  private stage = -1;
  private flash = 0;
  private lastHp: number;
  seen = true;

  constructor(
    readonly ship: Ship,
    private readonly tex: GameTextures,
  ) {
    this.hull = new Sprite(tex.ship(`ship_${ship.variant}`));
    this.hull.anchor.set(0.5);
    this.hull.scale.set(SHIP_SCALE);
    this.root.addChild(this.hull);
    const fireTex = [tex.ship('fire_1'), tex.ship('fire_2')];
    for (let i = 0; i < 2; i++) {
      const f = new Sprite(fireTex[i]!);
      f.anchor.set(0.5, 0.9);
      f.visible = false;
      this.fires.push(f);
      this.root.addChild(f);
    }
    const isPlayer = ship.kind === 'player';
    const frame = new Sprite(tex.ui(isPlayer ? 'health_frame' : 'enemy_health_frame'));
    this.barFill = new Sprite(tex.healthFill(isPlayer ? 'player' : 'enemy', 'green', 1));
    const s = isPlayer ? 0.32 : 0.42;
    frame.scale.set(s);
    this.barFill.scale.set(s);
    frame.anchor.set(0.5, 0.5);
    this.barFill.anchor.set(0, 0.5);
    this.barFill.x = -frame.width / 2;
    this.bar.addChild(frame, this.barFill);
    this.lastHp = ship.hp;
  }

  sync(dt: number, time: number): void {
    const s = this.ship;
    this.root.position.set(s.x, s.y);
    this.root.rotation = s.heading + SPRITE_ROTATION_OFFSET;
    const stage = damageStage(s);
    if (stage !== this.stage) {
      this.stage = stage;
      this.hull.texture = this.tex.ship(`ship_${s.variant + stage * 6}`);
      this.fires[0]!.visible = stage >= 1;
      this.fires[1]!.visible = stage >= 2;
      this.fires[0]!.position.set(-8, 6);
      this.fires[1]!.position.set(9, -14);
    }
    if (s.hp < this.lastHp) this.flash = 0.14;
    this.lastHp = s.hp;
    if (this.flash > 0) {
      this.flash -= dt;
      this.hull.tint = this.flash > 0 ? 0xff7a6a : 0xffffff;
    }
    // Flame flicker driven by render time (cosmetic only).
    for (let i = 0; i < this.fires.length; i++) {
      const f = this.fires[i]!;
      if (!f.visible) continue;
      const k = 0.85 + 0.15 * Math.sin(time * 18 + i * 2.1);
      f.scale.set(0.8 * k, 0.8 * (2 - k));
      f.rotation = -this.root.rotation; // flames always rise "up" the screen
    }
    // Health bar stays upright above the ship.
    this.bar.position.set(s.x, s.y - (s.kind === 'player' ? 64 : 58));
    const frac = Math.max(0, s.hp / s.maxHp);
    const isPlayer = s.kind === 'player';
    const color = frac > 0.5 ? 'green' : frac > 0.25 && isPlayer ? 'amber' : 'red';
    this.barFill.texture = this.tex.healthFill(isPlayer ? 'player' : 'enemy', color, frac);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.bar.destroy({ children: true });
  }
}

/**
 * Draws the world state with PixiJS. Reads the simulation each frame (no gameplay logic
 * here) and turns simulation events into cosmetic effects.
 */
export class ArenaRenderer {
  readonly root = new Container();
  private readonly shake = new Container();
  private readonly water: TilingSprite;
  private readonly wreckLayer = new Container();
  private readonly shipLayer = new Container();
  private readonly projectileLayer = new Container();
  private readonly trails = new Graphics();
  private readonly barLayer = new Container();
  private readonly particles = new ParticleSystem(600);
  private readonly wakes = new ParticleSystem(300);
  private readonly ships = new Map<number, ShipView>();
  private readonly balls = new Map<number, Sprite>();
  private readonly ballPool: Sprite[] = [];
  private readonly explosionFrames: Texture[];
  private readonly debris: Texture[];
  private readonly puff: Texture;
  private readonly ring: Texture;
  private time = 0;
  private shakeTime = 0;
  private wakeTimer = 0;
  private viewW = 0;
  private viewH = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly tex: GameTextures,
    private readonly map: ArenaMap,
  ) {
    this.water = new TilingSprite({ texture: tex.water, width: map.width, height: map.height });
    this.explosionFrames = [tex.ship('explosion_3'), tex.ship('explosion_2'), tex.ship('explosion_1'), tex.ship('explosion_2')];
    this.debris = [tex.ship('wood_1'), tex.ship('wood_2'), tex.ship('wood_3'), tex.ship('wood_4')];
    this.puff = this.makeCircleTexture(16, 0xffffff, true);
    this.ring = this.makeRingTexture(18);

    const statics = this.buildStatics();
    // Static map tiles are baked into one texture: one draw call and no seams between
    // atlas tiles when the arena is scaled by a fractional factor.
    statics.cacheAsTexture({ antialias: false });
    const arenaFrame = new Graphics().rect(0, 0, map.width, map.height).stroke({ width: 4, color: 0x0d2f4a, alpha: 0.6 });
    this.shake.addChild(
      this.water,
      statics,
      this.wakes.container,
      this.wreckLayer,
      this.trails,
      this.projectileLayer,
      this.shipLayer,
      this.particles.container,
      this.barLayer,
      arenaFrame,
    );
    this.root.addChild(this.shake);
  }

  get counts() {
    return { ships: this.ships.size, projectiles: this.balls.size, particles: this.particles.activeCount + this.wakes.activeCount };
  }

  /** Fits the logical arena inside the viewport, preserving its aspect ratio. */
  layout(viewW: number, viewH: number, insetTop = 0): { scale: number; offsetX: number; offsetY: number } {
    this.viewW = viewW;
    this.viewH = viewH;
    const usableH = Math.max(1, viewH - insetTop);
    const scale = Math.min(viewW / this.map.width, usableH / this.map.height);
    const offsetX = (viewW - this.map.width * scale) / 2;
    const offsetY = insetTop + (usableH - this.map.height * scale) / 2;
    this.root.scale.set(scale);
    this.root.position.set(offsetX, offsetY);
    return { scale, offsetX, offsetY };
  }

  get viewport() {
    return { width: this.viewW, height: this.viewH };
  }

  private buildStatics(): Container {
    const c = new Container();
    const shallowTile = (col: number, row: number, cols: number, rows: number) => {
      const cc = col === 0 ? 0 : col === cols - 1 ? 2 : 1;
      const rr = row === 0 ? 0 : row === rows - 1 ? 2 : 1;
      return 10 + cc + rr * 16;
    };
    for (const isl of this.map.islands) {
      // Light "shallow water" ring one tile around each island.
      const cols = isl.tw + 2;
      const rows = isl.th + 2;
      for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
          const inner = col > 0 && col < cols - 1 && r > 0 && r < rows - 1;
          if (inner) continue;
          const s = new Sprite(this.tex.tile(shallowTile(col, r, cols, rows)));
          s.position.set((isl.tx - 1 + col) * TILE, (isl.ty - 1 + r) * TILE);
          s.alpha = 0.75;
          c.addChild(s);
        }
      }
    }
    for (const isl of this.map.islands) {
      for (let r = 0; r < isl.th; r++) {
        for (let col = 0; col < isl.tw; col++) {
          const s = new Sprite(this.tex.tile(islandTileAt(isl.style, col, r, isl.tw, isl.th)));
          s.position.set((isl.tx + col) * TILE, (isl.ty + r) * TILE);
          c.addChild(s);
        }
      }
      for (const p of isl.props ?? []) {
        const s = new Sprite(this.tex.tile(p.tile));
        s.position.set(p.tx * TILE, p.ty * TILE);
        c.addChild(s);
      }
    }
    return c;
  }

  private makeCircleTexture(radius: number, color: number, soft: boolean): Texture {
    const g = new Graphics();
    if (soft) {
      for (let i = 4; i >= 1; i--) g.circle(radius, radius, (radius * i) / 4).fill({ color, alpha: 0.18 });
    } else {
      g.circle(radius, radius, radius).fill({ color });
    }
    const t = this.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return t;
  }

  private makeRingTexture(radius: number): Texture {
    const g = new Graphics().circle(radius + 2, radius + 2, radius).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
    const t = this.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return t;
  }

  /** Draws one frame. `dt` is render time (0 while paused so effects freeze). */
  sync(world: World, dt: number): void {
    this.time += dt;
    this.water.tilePosition.set(this.time * 6, this.time * 3);

    // Ships
    for (const v of this.ships.values()) v.seen = false;
    this.syncShip(world.player, dt);
    for (const e of world.enemies) this.syncShip(e, dt);
    for (const [id, v] of this.ships) {
      if (!v.seen) {
        v.destroy();
        this.ships.delete(id);
      }
    }

    // Wakes behind moving ships
    if (dt > 0) {
      this.wakeTimer -= dt;
      if (this.wakeTimer <= 0) {
        this.wakeTimer = 0.07;
        for (const v of this.ships.values()) {
          const s = v.ship;
          if (s.speed < 25) continue;
          const bx = s.x - Math.cos(s.heading) * 30;
          const by = s.y - Math.sin(s.heading) * 30;
          this.wakes.emit({ texture: this.puff, x: bx, y: by, life: 0.9, scale0: 0.45, scale1: 1.1, alpha0: 0.45, alpha1: 0 });
        }
      }
    }

    // Projectiles (pooled sprites keyed by projectile id) and their trails
    const seen = new Set<number>();
    this.trails.clear();
    for (const pr of world.projectiles) {
      seen.add(pr.id);
      let s = this.balls.get(pr.id);
      if (!s) {
        s = this.ballPool.pop() ?? this.newBall();
        s.visible = true;
        this.balls.set(pr.id, s);
      }
      s.position.set(pr.x, pr.y);
      const len = 0.07;
      this.trails
        .moveTo(pr.x - pr.vx * len, pr.y - pr.vy * len)
        .lineTo(pr.x, pr.y)
        .stroke({ width: 3, color: pr.team === 'player' ? 0xffffff : 0xffd2c4, alpha: 0.55 });
    }
    for (const [id, s] of this.balls) {
      if (!seen.has(id)) {
        s.visible = false;
        this.ballPool.push(s);
        this.balls.delete(id);
      }
    }

    this.particles.update(dt);
    this.wakes.update(dt);
    this.updateWrecks(dt);

    if (this.shakeTime > 0 && dt > 0) {
      this.shakeTime -= dt;
      const a = Math.max(0, this.shakeTime) * 22;
      this.shake.position.set(this.particles.rng.range(-a, a), this.particles.rng.range(-a, a));
    } else if (this.shakeTime <= 0) {
      this.shake.position.set(0, 0);
    }
  }

  private newBall(): Sprite {
    const s = new Sprite(this.tex.ship('cannon_ball'));
    s.anchor.set(0.5);
    this.projectileLayer.addChild(s);
    return s;
  }

  private syncShip(ship: Ship, dt: number): void {
    if (!ship.alive) return;
    let v = this.ships.get(ship.id);
    if (!v) {
      v = new ShipView(ship, this.tex);
      this.ships.set(ship.id, v);
      this.shipLayer.addChild(v.root);
      this.barLayer.addChild(v.bar);
    }
    v.seen = true;
    v.sync(dt, this.time);
  }

  /* ---------------------------------------------------------------- effects */

  private readonly wrecks: { sprite: Sprite; life: number }[] = [];

  private updateWrecks(dt: number): void {
    if (dt <= 0) return;
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i]!;
      w.life += dt;
      const t = w.life / 2.2;
      w.sprite.alpha = Math.max(0, 1 - t);
      w.sprite.scale.set(SHIP_SCALE * (1 - 0.25 * t));
      if (t >= 1) {
        w.sprite.destroy();
        this.wrecks.splice(i, 1);
      }
    }
  }

  handleEvents(events: readonly SimEvent[]): void {
    const rng = this.particles.rng;
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          this.particles.emit({
            texture: this.explosionFrames[0]!,
            x: e.x,
            y: e.y,
            life: 0.16,
            scale0: 0.3,
            scale1: 0.5,
            alpha0: 1,
            alpha1: 0.2,
            rotation: rng.range(0, Math.PI * 2),
          });
          for (let i = 0; i < 2; i++) {
            this.particles.emit({
              texture: this.puff,
              x: e.x,
              y: e.y,
              vx: Math.cos(e.angle) * rng.range(30, 70) + rng.range(-15, 15),
              vy: Math.sin(e.angle) * rng.range(30, 70) + rng.range(-15, 15),
              drag: 2.5,
              life: rng.range(0.5, 0.8),
              scale0: 0.5,
              scale1: 1.6,
              alpha0: 0.7,
              alpha1: 0,
              tint: 0xdddddd,
            });
          }
          break;
        }
        case 'hit': {
          this.particles.emit({ texture: this.explosionFrames[0]!, x: e.x, y: e.y, life: 0.25, scale0: 0.45, scale1: 0.8, alpha1: 0 });
          for (let i = 0; i < 3; i++) {
            const a = rng.range(0, Math.PI * 2);
            this.particles.emit({
              texture: this.debris[rng.int(this.debris.length)]!,
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * rng.range(40, 110),
              vy: Math.sin(a) * rng.range(40, 110),
              drag: 3,
              spin: rng.range(-6, 6),
              life: 0.7,
              scale0: 0.5,
              scale1: 0.4,
              alpha0: 1,
              alpha1: 0,
            });
          }
          if (e.targetKind === 'player') this.shakeTime = 0.25;
          break;
        }
        case 'splash': {
          this.particles.emit({
            texture: e.onLand ? this.puff : this.ring,
            x: e.x,
            y: e.y,
            life: 0.45,
            scale0: 0.2,
            scale1: e.onLand ? 1 : 0.9,
            alpha0: 0.9,
            alpha1: 0,
            tint: e.onLand ? 0xc9a66b : 0xffffff,
          });
          break;
        }
        case 'destroyed': {
          this.explode(e.x, e.y, 1.1);
          const wreck = new Sprite(this.tex.ship(`ship_${e.variant + 18}`));
          wreck.anchor.set(0.5);
          wreck.scale.set(SHIP_SCALE);
          wreck.position.set(e.x, e.y);
          wreck.rotation = e.heading + SPRITE_ROTATION_OFFSET;
          this.wreckLayer.addChild(wreck);
          this.wrecks.push({ sprite: wreck, life: 0 });
          break;
        }
        case 'ram':
          this.explode(e.x, e.y, 0.9);
          this.shakeTime = 0.35;
          break;
        default:
          break;
      }
    }
  }

  private explode(x: number, y: number, size: number): void {
    const rng = this.particles.rng;
    this.particles.emit({
      texture: this.explosionFrames[0]!,
      frames: this.explosionFrames,
      x,
      y,
      life: 0.6,
      scale0: 0.6 * size,
      scale1: 1.3 * size,
      alpha0: 1,
      alpha1: 0.1,
    });
    for (let i = 0; i < 7; i++) {
      const a = rng.range(0, Math.PI * 2);
      const sp = rng.range(50, 160);
      this.particles.emit({
        texture: this.debris[rng.int(this.debris.length)]!,
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        drag: 2.2,
        spin: rng.range(-8, 8),
        life: rng.range(0.8, 1.3),
        scale0: 0.7,
        scale1: 0.5,
        alpha1: 0,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.particles.emit({
        texture: this.puff,
        x: x + rng.range(-12, 12),
        y: y + rng.range(-12, 12),
        vx: rng.range(-20, 20),
        vy: rng.range(-30, -5),
        life: rng.range(0.9, 1.5),
        scale0: 0.8,
        scale1: 2.4,
        alpha0: 0.55,
        alpha1: 0,
        tint: 0x444444,
      });
    }
  }

  destroy(): void {
    for (const v of this.ships.values()) v.destroy();
    this.ships.clear();
    this.balls.clear();
    this.ballPool.length = 0;
    this.wrecks.length = 0;
    this.particles.clear();
    this.wakes.clear();
    this.puff.destroy(true);
    this.ring.destroy(true);
    // Atlas textures are shared and cached for the next match: destroy display objects only.
    this.root.destroy({ children: true, texture: false, textureSource: false });
  }
}
