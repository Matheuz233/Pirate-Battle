import { test, expect } from './fixtures';

test.describe('Ranking and match history tabs', () => {
  test('ranking paginates fixtures sorted by score, with tabs', async ({ page, setup }) => {
    await setup({ scenario: 'many-pages' });
    await page.goto('/');
    await page.getByTestId('ranking-tab-button').click();
    await expect(page.getByRole('tab', { name: 'Ranking' })).toHaveAttribute('aria-selected', 'true');
    const rows = page.getByTestId('ranking-row');
    await expect(rows).toHaveCount(5);
    await expect(page.getByTestId('page-label')).toContainText(/Page 1 of \d+/);
    const total = Number((await page.getByTestId('page-label').textContent())!.match(/of (\d+)/)![1]);
    expect(total).toBeGreaterThan(3);

    const scores = await rows.locator('.col-score').allTextContents();
    const nums = scores.map(Number);
    expect([...nums].sort((a, b) => b - a)).toEqual(nums);
    await expect(rows.first().locator('.col-rank')).toHaveText('01');

    await page.getByTestId('page-next').click();
    await expect(page.getByTestId('page-label')).toContainText('Page 2 of');
    await expect(rows.first().locator('.col-rank')).toHaveText('06');
    await page.getByTestId('page-prev').click();
    await expect(rows.first().locator('.col-rank')).toHaveText('01');

    // Keyboard navigation between tabs (arrow keys).
    await page.getByRole('tab', { name: 'Ranking' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Match History' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Match History' })).toBeFocused();
  });

  test('shows loading, then empty states', async ({ page, setup }) => {
    await setup({ scenario: 'empty', latencyScale: 0.3 });
    await page.goto('/');
    await page.getByTestId('ranking-tab-button').click();
    await expect(page.getByTestId('log-loading')).toBeVisible();
    await expect(page.getByTestId('log-empty')).toContainText('No battles recorded');
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('log-empty')).toContainText('No battles recorded yet');
  });

  test('shows errors for failing queries and recovers on retry', async ({ page, setup }) => {
    await setup({ scenario: 'ranking-error' });
    await page.goto('/');
    await page.getByTestId('ranking-tab-button').click();
    const error = page.getByTestId('log-error');
    await expect(error).toBeVisible({ timeout: 15_000 }); // after automatic retries
    await expect(error).toContainText('Ranking service is unavailable');
    await expect(error).toHaveAttribute('role', 'alert');

    // History is independent from the ranking failure.
    await page.getByTestId('tab-history').click();
    await expect(page.getByTestId('log-empty')).toBeVisible();

    // Recover: the backend comes back; showing the tab again refetches it.
    await page.evaluate(() =>
      localStorage.setItem('pb.mock.scenario.v1', JSON.stringify({ name: 'success', seed: 1, latencyScale: 0 })),
    );
    await page.getByTestId('tab-ranking').click();
    await expect(page.getByTestId('ranking-row').first()).toBeVisible();
  });

  test('history query errors are reported', async ({ page, setup }) => {
    await setup({ scenario: 'history-error' });
    await page.goto('/#/log/history');
    await expect(page.getByTestId('log-error')).toContainText('Match history service failed', { timeout: 15_000 });
    // Manual retry after the service recovers.
    await page.evaluate(() =>
      localStorage.setItem('pb.mock.scenario.v1', JSON.stringify({ name: 'success', seed: 1, latencyScale: 0 })),
    );
    await page.getByTestId('log-retry').click();
    await expect(page.getByTestId('log-empty')).toBeVisible();
    await page.getByTestId('tab-ranking').click();
    await expect(page.getByTestId('ranking-row').first()).toBeVisible();
  });

  test('a network failure does not block the game or the options', async ({ page, setup }) => {
    await setup({ scenario: 'network-error' });
    await page.goto('/#/log/ranking');
    await expect(page.getByTestId('log-error')).toContainText('Could not reach the server', { timeout: 15_000 });
    await page.getByTestId('log-menu').click();
    await page.getByTestId('options-button').click();
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
    await page.getByTestId('back-to-menu').click();
    await page.getByTestId('play-button').click();
    await expect(page.getByTestId('hud')).toBeVisible();
  });
});
