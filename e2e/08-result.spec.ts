import { test, expect, startMatch, advance, getState, NO_SPAWNS } from './fixtures';

test.describe('Result screen', () => {
  test('shows score, time, reason and record status, and survives a refresh', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 } });
    await startMatch(page, { overrides: NO_SPAWNS });
    await advance(page, 25_000);
    const matchId = await page.evaluate(() => (window as unknown as { __PIRATE__: { matchId(): string } }).__PIRATE__.matchId());
    expect((await getState(page)).phase).toBe('running');
    await advance(page, 35_100);

    await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
    await expect(page.getByTestId('result-score')).toContainText('0');
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('submission-status')).toHaveAttribute('data-state', 'saved');
    await expect(page.getByRole('button', { name: 'Play Again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Main Menu' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
    await expect(page.getByTestId('submission-status')).toHaveAttribute('data-state', 'saved');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.lastResult.v1') ?? 'null'));
    expect(stored.submission.matchId).toBe(matchId);

    await page.getByTestId('result-menu').click();
    await expect(page.getByTestId('menu-last-result')).toContainText('0 pts');
  });
});
