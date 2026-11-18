import { test, expect, startMatch, getState, hold, advance, aimAt, NO_SPAWNS } from './fixtures';

test.describe('Movement and collisions', () => {
  test.beforeEach(async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: NO_SPAWNS });
  });

  test('sails forward and rotates both ways with the keyboard', async ({ page }) => {
    const s0 = await getState(page);
    expect(s0.timeLeftSec).toBe(120);
    await hold(page, 'KeyW', 600);
    const s1 = await getState(page);
    expect(s1.player.y).toBeLessThan(s0.player.y - 20); // heading north
    expect(Math.abs(s1.player.x - s0.player.x)).toBeLessThan(0.5);

    await hold(page, 'KeyD', 300);
    const s2 = await getState(page);
    const turned = s2.player.heading - s1.player.heading;
    expect(turned).toBeCloseTo((150 * 0.3 * Math.PI) / 180, 1);

    await hold(page, 'ArrowLeft', 600);
    const s3 = await getState(page);
    expect(Math.atan2(Math.sin(s3.player.heading - s2.player.heading), Math.cos(s3.player.heading - s2.player.heading))).toBeLessThan(0);

    // Simultaneous move + turn.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await advance(page, 400);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
    const s4 = await getState(page);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    expect(wrap(s4.player.heading - s3.player.heading)).toBeLessThan(0);
    expect(Math.hypot(s4.player.x - s3.player.x, s4.player.y - s3.player.y)).toBeGreaterThan(5);
  });

  test('stays inside the visible arena', async ({ page }) => {
    await hold(page, 'KeyW', 6000); // straight north into the edge
    const s = await getState(page);
    expect(s.player.y).toBeCloseTo(s.player.radius, 0);
    await aimAt(page, 0, s.player.y);
    await hold(page, 'KeyW', 8000);
    const s2 = await getState(page);
    expect(s2.player.x).toBeGreaterThanOrEqual(s2.player.radius - 0.01);
    expect(s2.player.y).toBeGreaterThanOrEqual(s2.player.radius - 0.01);
  });

  test('cannot sail through islands', async ({ page }) => {
    const s0 = await getState(page);
    // North-west island: aim at its centre and sail into it.
    const island = s0.islands.reduce((best, r) =>
      Math.hypot(r.x + r.w / 2 - s0.player.x, r.y + r.h / 2 - s0.player.y) <
      Math.hypot(best.x + best.w / 2 - s0.player.x, best.y + best.h / 2 - s0.player.y)
        ? r
        : best,
    );
    await aimAt(page, island.x + island.w / 2, island.y + island.h / 2);
    for (let i = 0; i < 10; i++) {
      await hold(page, 'KeyW', 500);
      const s = await getState(page);
      for (const r of s.islands) {
        const cx = Math.max(r.x, Math.min(s.player.x, r.x + r.w));
        const cy = Math.max(r.y, Math.min(s.player.y, r.y + r.h));
        expect(Math.hypot(s.player.x - cx, s.player.y - cy)).toBeGreaterThanOrEqual(s.player.radius - 0.5);
      }
    }
    const end = await getState(page);
    // It got stuck against the island instead of reaching the centre.
    expect(Math.hypot(end.player.x - (island.x + island.w / 2), end.player.y - (island.y + island.h / 2))).toBeGreaterThan(60);
  });
});
