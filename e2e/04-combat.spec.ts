import { test, expect, startMatch, getState, advance, tap, aimAt, hold, NO_SPAWNS, STATIC_SHOOTER } from './fixtures';

test.describe('Combat', () => {
  test('front cannon fires one ball and respects its cooldown', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: NO_SPAWNS });
    await tap(page, 'Space');
    let s = await getState(page);
    expect(s.projectiles).toHaveLength(1);
    const ball = s.projectiles[0]!;
    expect(ball.team).toBe('player');
    expect(ball.vy).toBeLessThan(0); // heading north
    expect(Math.abs(ball.vx)).toBeLessThan(1e-6);

    // Pressing again during the cooldown does nothing.
    await tap(page, 'Space');
    s = await getState(page);
    expect(s.projectiles).toHaveLength(1);
    expect(s.player.cooldowns.front).toBeGreaterThan(0);

    await advance(page, s.config.player.frontCannon.cooldownMs);
    await tap(page, 'Space');
    s = await getState(page);
    expect(s.projectiles.filter((p) => p.weapon === 'front').length).toBeGreaterThanOrEqual(1);
    expect(s.player.cooldowns.front).toBeGreaterThan(0.4);

    // Balls expire after their range.
    await advance(page, 2000);
    s = await getState(page);
    expect(s.projectiles).toHaveLength(0);
  });

  test('side cannons fire three parallel balls to each side with their own cooldown', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: NO_SPAWNS });
    await tap(page, 'KeyQ');
    let s = await getState(page);
    const left = s.projectiles.filter((p) => p.weapon === 'left');
    expect(left).toHaveLength(3);
    for (const p of left) {
      expect(p.vx).toBeLessThan(0);
      expect(Math.abs(p.vy)).toBeLessThan(1e-6);
    }
    const ys = left.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeCloseTo(ys[2]! - ys[1]!, 3); // evenly spaced, parallel

    await tap(page, 'KeyQ'); // still cooling down
    s = await getState(page);
    expect(s.projectiles.filter((p) => p.weapon === 'left')).toHaveLength(3);

    await tap(page, 'KeyE'); // independent cooldown
    s = await getState(page);
    const right = s.projectiles.filter((p) => p.weapon === 'right');
    expect(right).toHaveLength(3);
    for (const p of right) expect(p.vx).toBeGreaterThan(0);

    // Move and fire at the same time.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await advance(page, 300);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    s = await getState(page);
    expect(s.player.speed).toBeGreaterThan(0);
    expect(s.projectiles.some((p) => p.weapon === 'front')).toBe(true);
  });

  test('hits apply damage once, kills score exactly one point', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: STATIC_SHOOTER, seed: 3 });
    await advance(page, 200);
    let s = await getState(page);
    expect(s.enemies).toHaveLength(1);
    const target = s.enemies[0]!;

    // Close in with the real controls until within cannon range.
    for (let i = 0; i < 12; i++) {
      s = await getState(page);
      const d = Math.hypot(target.x - s.player.x, target.y - s.player.y);
      if (d < 260) break;
      await aimAt(page, target.x, target.y);
      await hold(page, 'KeyW', 400);
    }
    await advance(page, 800); // coast to a stop
    await aimAt(page, target.x, target.y, 1);

    const dmg = s.config.player.frontCannon.damage;
    const expectedHp = [target.maxHp - dmg, target.maxHp - 2 * dmg];
    for (const hp of expectedHp) {
      await tap(page, 'Space');
      await advance(page, 900); // flight time + cooldown
      s = await getState(page);
      expect(s.enemies[0]?.hp).toBe(hp);
      expect(s.score).toBe(0);
    }
    await tap(page, 'Space');
    await advance(page, 900);
    s = await getState(page);
    expect(s.enemies).toHaveLength(0);
    expect(s.score).toBe(1);
    expect(s.kills.shooter).toBe(1);
    await expect(page.getByTestId('hud-score')).toContainText('1');

    // Firing at the wreck position never scores again.
    await tap(page, 'Space');
    await advance(page, 1200);
    s = await getState(page);
    expect(s.score).toBe(1);
  });
});
