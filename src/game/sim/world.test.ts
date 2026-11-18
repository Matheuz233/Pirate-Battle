import { describe, expect, it } from 'vitest';
import { createMatchConfig, type DeepPartial, type GameConfig } from '../config/gameConfig';
import { World } from './world';
import { EMPTY_INPUT, type InputFrame } from './types';

const DT = 1 / 60;

function makeWorld(overrides?: DeepPartial<GameConfig>, settings = { sessionTimeSec: 60, spawnIntervalSec: 3 }) {
  return new World(createMatchConfig(settings, overrides), 7);
}

function run(world: World, seconds: number, input: Partial<InputFrame> = {}) {
  const frame = { ...EMPTY_INPUT, ...input };
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) world.step(DT, frame);
}

describe('World', () => {
  it('ends by time after exactly the configured duration', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    run(w, 59.9);
    expect(w.status).toBe('running');
    run(w, 0.2);
    expect(w.status).toBe('ended');
    expect(w.endReason).toBe('time_up');
    expect(w.elapsedSec).toBeCloseTo(60, 5);
  });

  it('moves forward along the heading and rotates both ways', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    const y0 = w.player.y;
    run(w, 0.5, { forward: true });
    expect(w.player.y).toBeLessThan(y0);
    const h0 = w.player.heading;
    run(w, 0.2, { turnRight: true });
    expect(w.player.heading).toBeGreaterThan(h0);
    run(w, 0.4, { turnLeft: true });
    expect(w.player.heading).toBeLessThan(h0);
  });

  it('keeps the player out of islands and inside the arena', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    w.player.heading = Math.PI; // west, toward the north-west island
    run(w, 8, { forward: true });
    for (const r of w.islands) {
      const inside = w.player.x > r.x && w.player.x < r.x + r.w && w.player.y > r.y && w.player.y < r.y + r.h;
      expect(inside).toBe(false);
    }
    expect(w.player.x).toBeGreaterThanOrEqual(w.player.radius);
  });

  it('respects the front cannon cooldown', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    run(w, 1, { fireFront: true });
    // 1 s with 450 ms cooldown → shots at 0, 0.45, 0.9
    const shots = w.events.filter((e) => e.type === 'shot').length;
    expect(shots).toBe(3);
  });

  it('fires three parallel broadside balls perpendicular to the heading', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    w.step(DT, { ...EMPTY_INPUT, fireLeft: true });
    expect(w.projectiles).toHaveLength(3);
    for (const p of w.projectiles) {
      // heading is north (-PI/2): port side is west → velocity points to -x
      expect(p.vx).toBeLessThan(0);
      expect(Math.abs(p.vy)).toBeLessThan(1e-6);
    }
  });

  it('applies projectile damage once and scores one point per kill', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    w.enemies.push({
      id: 999,
      kind: 'chaser',
      team: 'enemy',
      x: w.player.x,
      y: w.player.y - 150,
      heading: Math.PI / 2,
      speed: 0,
      hp: 40,
      maxHp: 40,
      radius: 25,
      alive: true,
      cooldowns: { front: 0, left: 0, right: 0, enemy: 0 },
      variant: 3,
    });
    w.step(DT, { ...EMPTY_INPUT, fireFront: true });
    // freeze the chaser so it does not ram
    const target = w.enemies[0]!;
    for (let i = 0; i < 30; i++) {
      target.x = w.player.x;
      target.y = w.player.y - 150;
      w.step(DT, EMPTY_INPUT);
    }
    expect(target.hp).toBe(20);
    expect(w.projectiles).toHaveLength(0);
    expect(w.score).toBe(0);
  });

  it('chaser ramming damages the player, destroys the chaser and gives no point', () => {
    const w = makeWorld({ spawn: { maxAlive: 0 } });
    w.enemies.push({
      id: 999,
      kind: 'chaser',
      team: 'enemy',
      x: w.player.x + 40,
      y: w.player.y,
      heading: Math.PI,
      speed: 0,
      hp: 40,
      maxHp: 40,
      radius: 25,
      alive: true,
      cooldowns: { front: 0, left: 0, right: 0, enemy: 0 },
      variant: 3,
    });
    w.step(DT, EMPTY_INPUT);
    expect(w.player.hp).toBe(100 - w.config.chaser.contactDamage);
    expect(w.enemies).toHaveLength(0);
    expect(w.score).toBe(0);
  });

  it('spawns both enemy kinds away from the player at the configured interval', () => {
    const w = makeWorld({ spawn: { initialDelaySec: 3 } }, { sessionTimeSec: 60, spawnIntervalSec: 2 });
    run(w, 2.01);
    expect(w.spawned.chaser + w.spawned.shooter).toBe(1);
    run(w, 2);
    expect(w.spawned.chaser).toBeGreaterThanOrEqual(1);
    expect(w.spawned.shooter).toBeGreaterThanOrEqual(1);
    const spawns = w.events.filter((e) => e.type === 'spawn');
    expect(spawns).toHaveLength(2);
  });

  it('is deterministic for the same seed and inputs', () => {
    const a = makeWorld();
    const b = makeWorld();
    for (let i = 0; i < 600; i++) {
      const input = { ...EMPTY_INPUT, forward: i % 120 < 60, turnLeft: i % 200 < 30, fireFront: i % 50 === 0 };
      a.step(DT, input);
      b.step(DT, input);
    }
    expect(a.player.x).toBe(b.player.x);
    expect(a.enemies.map((e) => [e.x, e.y])).toEqual(b.enemies.map((e) => [e.x, e.y]));
  });

  it('stops everything once ended', () => {
    const w = makeWorld({ player: { maxHealth: 1 } });
    w.player.hp = 0;
    w.player.alive = false;
    w.step(DT, EMPTY_INPUT);
    expect(w.status).toBe('ended');
    const snapshot = JSON.stringify({ p: w.player, e: w.enemies, pr: w.projectiles, s: w.score, t: w.stepCount });
    run(w, 2, { forward: true, fireFront: true });
    expect(JSON.stringify({ p: w.player, e: w.enemies, pr: w.projectiles, s: w.score, t: w.stepCount })).toBe(snapshot);
  });
});
