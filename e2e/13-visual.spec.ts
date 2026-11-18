import { test, expect, startMatch, advance, hold, NO_SPAWNS } from './fixtures';

/** Visual regression baselines (versioned under e2e/__screenshots__). */
test.describe('Visual regression', () => {
  test('main menu', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await expect(page.getByTestId('play-button')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('menu.png');
  });

  test('arena in a stable state', async ({ page, setup }) => {
    await setup();
    await startMatch(page, {
      seed: 8,
      overrides: { spawn: { maxAlive: 2, initialDelaySec: 0.2 }, shooter: { cannon: { cooldownMs: 1e9 } } },
    });
    await advance(page, 1500);
    await hold(page, 'KeyW', 700);
    await page.keyboard.press('KeyE');
    await advance(page, 200);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('arena.png', { maxDiffPixelRatio: 0.03 });
  });

  test('result screen', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 } });
    await startMatch(page, { overrides: NO_SPAWNS });
    await advance(page, 60_100);
    await expect(page.getByTestId('submission-status')).toHaveAttribute('data-state', 'saved');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('result.png');
  });
});
