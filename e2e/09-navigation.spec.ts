import { test, expect, startMatch, getState, advance, waitForPhase, appUrl, NO_SPAWNS } from './fixtures';

test.describe('Navigation, abandonment and touch', () => {
  test('leaving or reloading a match abandons it without recording', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: NO_SPAWNS });
    await advance(page, 3000);
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu-button').click();
    await expect(page.getByTestId('play-button')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.getByTestId('play-button').click();
    await waitForPhase(page, 'running');
    await advance(page, 2000);
    await page.reload();
    await expect(page.getByTestId('play-button')).toBeVisible(); // reload never resumes a match
    expect(page.url()).not.toContain('#/play');

    const storage = await page.evaluate(() => ({
      last: localStorage.getItem('pb.lastResult.v1'),
      outbox: localStorage.getItem('pb.outbox.v1'),
      db: localStorage.getItem('pb.mock.db.v1'),
    }));
    expect(storage.last).toBeNull();
    expect(storage.outbox).toBeNull();
    expect(storage.db).toBeNull();

    await page.getByTestId('history-tab-button').click();
    await expect(page.getByTestId('log-empty')).toBeVisible();
  });

  test('repeated navigation between screens keeps a single game instance', async ({ page, setup }) => {
    await setup();
    await page.goto(appUrl({ overrides: NO_SPAWNS }));
    for (let i = 0; i < 4; i++) {
      await page.getByTestId('play-button').click();
      await waitForPhase(page, 'running');
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.goBack(); // browser back leaves the battle
      await expect(page.getByTestId('play-button')).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(0);
      await page.getByTestId('options-button').click();
      await page.getByTestId('back-to-menu').click();
      await page.getByTestId('ranking-tab-button').click();
      await page.getByTestId('log-menu').click();
    }
    const hasApi = await page.evaluate(() => '__PIRATE__' in window);
    expect(hasApi).toBe(false); // test hooks were released with the engine
  });

  test('touch controls move and fire simultaneously', async ({ page, setup, isMobile }) => {
    test.skip(!isMobile, 'touch controls are exercised on the mobile project');
    await setup();
    await startMatch(page, { overrides: NO_SPAWNS });
    const s0 = await getState(page);
    const forward = page.getByTestId('touch-forward');
    const fire = page.getByTestId('touch-fireFront');
    const turn = page.getByTestId('touch-turnRight');
    await expect(forward).toBeVisible();

    // Two fingers: sail + turn, a third taps the bow cannon.
    await forward.dispatchEvent('pointerdown', { pointerId: 11, pointerType: 'touch', isPrimary: true });
    await turn.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch' });
    await fire.dispatchEvent('pointerdown', { pointerId: 13, pointerType: 'touch' });
    await advance(page, 500);
    await fire.dispatchEvent('pointerup', { pointerId: 13, pointerType: 'touch' });
    await turn.dispatchEvent('pointerup', { pointerId: 12, pointerType: 'touch' });
    await forward.dispatchEvent('pointerup', { pointerId: 11, pointerType: 'touch' });

    const s1 = await getState(page);
    expect(Math.hypot(s1.player.x - s0.player.x, s1.player.y - s0.player.y)).toBeGreaterThan(10);
    expect(s1.player.heading).toBeGreaterThan(s0.player.heading);
    expect(s1.projectiles.some((p) => p.weapon === 'front')).toBe(true);

    // Released: no more thrust.
    await advance(page, 2000);
    const s2 = await getState(page);
    expect(s2.player.speed).toBe(0);

    // A real tap on the bow cannon fires once.
    await advance(page, 500);
    await fire.tap();
    await advance(page, 50);
    const s3 = await getState(page);
    expect(s3.projectiles.filter((p) => p.weapon === 'front')).toHaveLength(1);
  });
});
