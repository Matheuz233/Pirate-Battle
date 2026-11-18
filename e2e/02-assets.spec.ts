import { test, expect, waitForPhase, appUrl } from './fixtures';

test.describe('Asset loading', () => {
  test('shows progress, reports failures and recovers on retry', async ({ page, setup }) => {
    await setup();
    let fail = true;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    // context.route also sees requests forwarded by the MSW service worker.
    await page.context().route('**/assets/atlas/ships.json', async (route) => {
      await gate; // hold the request so the loading state is observable
      if (fail) await route.abort('failed');
      else await route.continue();
    });

    await page.goto(appUrl());
    await page.getByTestId('play-button').click();
    const progress = page.getByTestId('asset-progress');
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('role', 'progressbar');
    release();

    const error = page.getByTestId('asset-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('could not be loaded');
    await expect(page.locator('canvas')).toHaveCount(0); // combat never started

    fail = false;
    await page.getByTestId('asset-retry').click();
    await waitForPhase(page, 'running');
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('reuses cached textures for the next match', async ({ page, setup }) => {
    await setup();
    const atlasRequests: string[] = [];
    page.on('request', (r) => {
      if (/\/assets\/(atlas|spritesheet)\/.*\.json$/.test(r.url())) atlasRequests.push(r.url());
    });
    await page.goto(appUrl());
    await page.getByTestId('play-button').click();
    await waitForPhase(page, 'running');
    const first = atlasRequests.length;
    expect(first).toBe(3);
    await page.keyboard.press('Escape');
    await page.getByTestId('restart-button').click();
    await waitForPhase(page, 'running');
    expect(atlasRequests.length).toBe(first);
  });
});
