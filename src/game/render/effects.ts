import { Container, Sprite, type Texture } from 'pixi.js';
import { Rng } from '../core/rng';

interface Particle {
  sprite: Sprite;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  drag: number;
  spin: number;
  scale0: number;
  scale1: number;
  alpha0: number;
  alpha1: number;
  frames: readonly Texture[] | null;
  active: boolean;
}

export interface ParticleSpec {
  texture: Texture;
  frames?: readonly Texture[];
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  drag?: number;
  life: number;
  rotation?: number;
  spin?: number;
  scale0?: number;
  scale1?: number;
  alpha0?: number;
  alpha1?: number;
  tint?: number;
}

/**
 * Pooled particle system for short-lived cosmetic effects (muzzle flashes, smoke, splashes,
 * debris, explosions). Sprites are recycled; nothing is allocated once the pool is warm.
 * Effects use their own seeded RNG so screenshots in tests are reproducible.
 */
export class ParticleSystem {
  readonly container = new Container();
  private readonly pool: Particle[] = [];
  private readonly live: Particle[] = [];
  readonly rng = new Rng(1337);

  constructor(private readonly max = 500) {}

  get activeCount(): number {
    return this.live.length;
  }

  emit(spec: ParticleSpec): void {
    let p = this.pool.pop();
    if (!p) {
      if (this.live.length >= this.max) return;
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      this.container.addChild(sprite);
      p = {
        sprite,
        life: 0,
        maxLife: 1,
        vx: 0,
        vy: 0,
        drag: 0,
        spin: 0,
        scale0: 1,
        scale1: 1,
        alpha0: 1,
        alpha1: 0,
        frames: null,
        active: false,
      };
    }
    p.active = true;
    p.life = 0;
    p.maxLife = spec.life;
    p.vx = spec.vx ?? 0;
    p.vy = spec.vy ?? 0;
    p.drag = spec.drag ?? 0;
    p.spin = spec.spin ?? 0;
    p.scale0 = spec.scale0 ?? 1;
    p.scale1 = spec.scale1 ?? p.scale0;
    p.alpha0 = spec.alpha0 ?? 1;
    p.alpha1 = spec.alpha1 ?? 0;
    p.frames = spec.frames ?? null;
    const s = p.sprite;
    s.texture = spec.frames?.[0] ?? spec.texture;
    s.position.set(spec.x, spec.y);
    s.rotation = spec.rotation ?? 0;
    s.scale.set(p.scale0);
    s.alpha = p.alpha0;
    s.tint = spec.tint ?? 0xffffff;
    s.visible = true;
    this.live.push(p);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let write = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        p.active = false;
        p.sprite.visible = false;
        this.pool.push(p);
        continue;
      }
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      const s = p.sprite;
      s.x += p.vx * dt;
      s.y += p.vy * dt;
      s.rotation += p.spin * dt;
      s.scale.set(p.scale0 + (p.scale1 - p.scale0) * t);
      s.alpha = p.alpha0 + (p.alpha1 - p.alpha0) * t;
      if (p.frames) s.texture = p.frames[Math.min(p.frames.length - 1, Math.floor(t * p.frames.length))]!;
      this.live[write++] = p;
    }
    this.live.length = write;
  }

  clear(): void {
    for (const p of this.live) {
      p.active = false;
      p.sprite.visible = false;
      this.pool.push(p);
    }
    this.live.length = 0;
  }
}
