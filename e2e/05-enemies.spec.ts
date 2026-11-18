import { test, expect, startMatch, getState, advance } from './fixtures';

const CHASER_ONLY = {
  spawn: { openingSequence: ['chaser'], distribution: { chaser: 1, shooter: 0 }, maxAlive: 1, initialDelaySec: 0.5 },
};
const SHOOTER_ONLY = {
  spawn: { openingSequence: ['shooter'], distribution: { chaser: 0, shooter: 1 }, maxAlive: 1, initialDelaySec: 0.5 },
};

test.describe('Enemies and spawning', () => {
  test('chaser pursues, rams, explodes and gives no point', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: CHASER_ONLY, seed: 11 });
    await advance(page, 600);
    let s = await getState(page);
    expect(s.enemies).toHaveLength(1);
    expect(s.enemies[0]!.kind).toBe('chaser');
    const dist = (st: typeof s) => Math.hypot(st.enemies[0]!.x - st.player.x, st.enemies[0]!.y - st.player.y);
    const d0 = dist(s);
    expect(d0).toBeGreaterThanOrEqual(s.config.spawn.minDistanceFromPlayer);
    await advance(page, 1500);
    s = await getState(page);
    expect(dist(s)).toBeLessThan(d0);

    const hp0 = s.player.hp;
    let rammed = false;
    for (let i = 0; i < 30 && !rammed; i++) {
      await advance(page, 250);
      s = await getState(page);
      rammed = s.player.hp < hp0;
    }
    expect(rammed).toBe(true);
    expect(s.player.hp).toBe(hp0 - s.config.chaser.contactDamage);
    expect(s.score).toBe(0);
    expect(s.enemies.filter((e) => e.kind === 'chaser' && Math.hypot(e.x - s.player.x, e.y - s.player.y) < 60)).toHaveLength(0);
  });

  test('shooter approaches and fires when in range', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: SHOOTER_ONLY, seed: 5 });
    await advance(page, 600);
    let s = await getState(page);
    expect(s.enemies[0]?.kind).toBe('shooter');
    const range = s.config.shooter.attackRange;
    let sawEnemyFire = false;
    let closest = Infinity;
    for (let i = 0; i < 60 && !sawEnemyFire; i++) {
      await advance(page, 250);
      s = await getState(page);
      const e = s.enemies[0];
      if (!e) break;
      closest = Math.min(closest, Math.hypot(e.x - s.player.x, e.y - s.player.y));
      sawEnemyFire = s.projectiles.some((p) => p.team === 'enemy');
    }
    expect(sawEnemyFire).toBe(true);
    expect(closest).toBeLessThanOrEqual(range + 1);
    // Enemy fire hurts the player.
    const hp0 = s.player.hp;
    let hurt = false;
    for (let i = 0; i < 40 && !hurt; i++) {
      await advance(page, 250);
      s = await getState(page);
      hurt = s.player.hp < hp0;
    }
    expect(hurt).toBe(true);
    expect((hp0 - s.player.hp) % s.config.shooter.cannon.damage).toBe(0);
  });

  test('spawns follow the configured interval and both types appear', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 120, spawnIntervalSec: 2 } });
    await startMatch(page, { seed: 21, overrides: { player: { maxHealth: 100000 } } });
    const total = async () => {
      const s = await getState(page);
      return s.spawned.chaser + s.spawned.shooter;
    };
    // initial delay = min(1.5, interval) → spawns at 1.5 s, 3.5 s, 5.5 s …
    await advance(page, 1400);
    expect(await total()).toBe(0);
    await advance(page, 200);
    expect(await total()).toBe(1);
    await advance(page, 1800);
    expect(await total()).toBe(1);
    await advance(page, 200);
    expect(await total()).toBe(2);
    await advance(page, 2000);
    expect(await total()).toBe(3);
    const s = await getState(page);
    expect(s.spawned.chaser).toBeGreaterThanOrEqual(1);
    expect(s.spawned.shooter).toBeGreaterThanOrEqual(1);
  });
});
