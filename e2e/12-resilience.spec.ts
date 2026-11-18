import { test, expect, startMatch, advance, NO_SPAWNS } from './fixtures';

test.describe('Network resilience', () => {
  test('timeout after the server stored the match: retry recovers without duplicates', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 }, scenario: 'submit-timeout' });
    const posts: number[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/matches')) posts.push(Date.now());
    });
    await startMatch(page, { overrides: NO_SPAWNS, apiTimeout: 1200 });
    const matchId = await page.evaluate(() => (window as unknown as { __PIRATE__: { matchId(): string } }).__PIRATE__.matchId());
    await advance(page, 60_100);

    const status = page.getByTestId('submission-status');
    await expect(status).toHaveAttribute('data-state', 'saved', { timeout: 15_000 });
    expect(posts.length).toBeGreaterThanOrEqual(2); // first attempt timed out, retry succeeded

    // Repeated manual retries / clicks do not duplicate the record either.
    await page.evaluate(async (id) => {
      const body = JSON.parse(localStorage.getItem('pb.lastResult.v1')!).submission;
      for (let i = 0; i < 3; i++) {
        await fetch('/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(body) });
      }
    }, matchId);
    const db = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.mock.db.v1') ?? '{}'));
    expect(db.records.filter((r: { matchId: string }) => r.matchId === matchId)).toHaveLength(1);

    await page.getByTestId('result-menu').click();
    await page.getByTestId('history-tab-button').click();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('late responses never overwrite newer data', async ({ page, setup }) => {
    // Odd requests take 1.8 s, even ones 150 ms: page 1 answers after page 2 was requested.
    await setup({ scenario: 'out-of-order', latencyScale: 1 });
    await page.goto('/#/log/ranking');
    // Wait for the first page (request #1 buckets, #2 page 1 → fast)
    await expect(page.getByTestId('ranking-row').first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('page-next').click(); // slow request
    await page.getByTestId('page-prev').click(); // back to page 1 (cached + background refetch)
    await page.getByTestId('page-next').click();
    await expect(page.getByTestId('page-label')).toContainText('Page 2 of', { timeout: 10_000 });
    await expect(page.getByTestId('ranking-table')).not.toHaveClass(/is-stale/, { timeout: 10_000 });
    await expect(page.getByTestId('ranking-row').first().locator('.col-rank')).toHaveText('06');
    // After every slow response has landed, the view still shows page 2.
    await page.waitForTimeout(2500);
    await expect(page.getByTestId('page-label')).toContainText('Page 2 of');
    await expect(page.getByTestId('ranking-row').first().locator('.col-rank')).toHaveText('06');
  });

  test('slow responses show a background refresh while keeping data', async ({ page, setup }) => {
    await setup({ scenario: 'success' });
    await page.goto('/#/log/ranking');
    await expect(page.getByTestId('ranking-row').first()).toBeVisible();
    await page.evaluate(() =>
      localStorage.setItem('pb.mock.scenario.v1', JSON.stringify({ name: 'slow', seed: 1, latencyScale: 1 })),
    );
    await page.getByTestId('log-menu').click();
    await page.getByTestId('ranking-tab-button').click(); // re-entering the tab refetches
    await expect(page.getByTestId('ranking-row').first()).toBeVisible(); // cached data shown immediately
    await expect(page.getByTestId('log-refreshing')).toBeVisible();
    await expect(page.getByTestId('log-refreshing')).toHaveCount(0, { timeout: 10_000 });
  });
});
