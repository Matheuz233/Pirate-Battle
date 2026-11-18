import { test, expect, startMatch, advance, NO_SPAWNS, type MatchSetup } from './fixtures';
import type { Page } from '@playwright/test';

async function playShortMatch(page: Page, m: MatchSetup = {}) {
  await startMatch(page, { overrides: NO_SPAWNS, ...m });
  const matchId = await page.evaluate(() => (window as unknown as { __PIRATE__: { matchId(): string } }).__PIRATE__.matchId());
  await advance(page, 60_100);
  await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
  return matchId;
}

test.describe('Match registration', () => {
  test('records once and updates both tabs', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 }, playerName: 'Captain Jack' });
    const matchId = await playShortMatch(page);
    await expect(page.getByTestId('submission-status')).toHaveAttribute('data-state', 'saved');

    await page.getByTestId('result-menu').click();
    await page.getByTestId('history-tab-button').click();
    const historyRows = page.locator(`[data-testid="history-row"][data-match-id="${matchId}"]`);
    await expect(historyRows).toHaveCount(1);
    await expect(historyRows).toContainText('Time up');

    await page.getByTestId('tab-ranking').click();
    // Ranking defaults to the player's own settings bucket (60 s / 3 s).
    await expect(page.getByTestId('bucket-select')).toHaveValue('60|3|1');
    const mine = page.locator(`[data-testid="ranking-row"][data-match-id="${matchId}"]`);
    // Score 0 may be on a later page: walk pages until found.
    for (let i = 0; i < 10 && (await mine.count()) === 0; i++) {
      const next = page.getByTestId('page-next');
      if (await next.isDisabled()) break;
      await next.click();
      await expect(page.getByTestId('ranking-table')).not.toHaveClass(/is-stale/);
    }
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('You');

    // Server holds exactly one record.
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.mock.db.v1') ?? '{}'));
    expect(db.records.filter((r: { matchId: string }) => r.matchId === matchId)).toHaveLength(1);
  });

  test('keeps a pending record across refresh and sends it after recovery', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 }, scenario: 'submit-offline' });
    const matchId = await playShortMatch(page);
    const status = page.getByTestId('submission-status');
    await expect(status).toHaveAttribute('data-state', 'failed', { timeout: 15_000 });
    await expect(page.getByTestId('submission-retry')).toBeVisible();

    // The player can start another match while the record is pending.
    await page.getByTestId('play-again').click();
    await expect(page.getByTestId('hud')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu-button').click();

    await page.reload();
    await expect(page.getByTestId('pending-banner')).toBeVisible();
    const outbox = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.outbox.v1') ?? '[]'));
    expect(outbox.map((e: { submission: { matchId: string } }) => e.submission.matchId)).toEqual([matchId]);

    // Backend comes back: select the success scenario in the network lab (also retries).
    await page.getByTestId('options-button').click();
    await page.getByTestId('open-network-lab').click();
    await page.getByTestId('scenario-select').selectOption('success');
    await page.getByLabel('Latency ×').fill('0');
    await page.getByTestId('apply-scenario').click();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByTestId('back-to-menu').click();
    await expect(page.getByTestId('pending-banner')).toHaveCount(0, { timeout: 15_000 });

    await page.getByTestId('history-tab-button').click();
    await expect(page.locator(`[data-testid="history-row"][data-match-id="${matchId}"]`)).toHaveCount(1);
  });
});
