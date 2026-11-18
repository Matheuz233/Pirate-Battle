import { test, expect, startMatch, getState, advance, waitForPhase, NO_SPAWNS } from './fixtures';

test.describe('Pause', () => {
  test('manual pause suspends the real-time clock and resumes on player action', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { manual: false, overrides: NO_SPAWNS });
    await page.waitForFunction(() => (window as unknown as { __PIRATE__: { getState(): { elapsedSec: number } } }).__PIRATE__.getState().elapsedSec > 0.5);
    await page.getByTestId('pause-button').click();
    await waitForPhase(page, 'paused');
    const dialog = page.getByTestId('pause-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Paused' })).toBeFocused(); // focus moved into the dialog
    const t0 = (await getState(page)).elapsedSec;
    await page.waitForTimeout(1500);
    const t1 = (await getState(page)).elapsedSec;
    expect(t1).toBe(t0);

    // Focus is trapped inside the dialog.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);

    await page.getByTestId('resume-button').click();
    await waitForPhase(page, 'running');
    await page.waitForTimeout(600);
    const t2 = (await getState(page)).elapsedSec;
    expect(t2).toBeGreaterThan(t1);
    expect(t2 - t1).toBeLessThan(2); // no catch-up of the paused period
  });

  test('auto-pauses on focus loss and hidden tab; no input accumulates while paused', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { overrides: NO_SPAWNS });
    await advance(page, 500);

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitForPhase(page, 'paused');
    await expect(page.getByTestId('pause-dialog')).toContainText('lost focus');
    const s0 = await getState(page);

    // Keys pressed during the pause are ignored and the clock does not move.
    await page.keyboard.down('KeyW');
    await page.keyboard.press('Space');
    expect(await advance(page, 2000)).toBe(0);
    await page.keyboard.up('KeyW');

    await page.getByTestId('resume-button').click();
    await waitForPhase(page, 'running');
    await advance(page, 500);
    const s1 = await getState(page);
    expect(s1.elapsedSec - s0.elapsedSec).toBeCloseTo(0.5, 2);
    expect(s1.player.y).toBe(s0.player.y);
    expect(s1.projectiles).toHaveLength(0);
    expect(s1.player.cooldowns.front).toBe(0);

    // Hidden tab.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitForPhase(page, 'paused');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Becoming visible again does not resume by itself.
    await page.waitForTimeout(300);
    expect((await getState(page)).phase).toBe('paused');
    await page.keyboard.press('Escape'); // explicit action from the player
    await waitForPhase(page, 'running');
  });
});
