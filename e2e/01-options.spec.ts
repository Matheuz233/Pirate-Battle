import { test, expect } from './fixtures';

test.describe('Options', () => {
  test('navigates, validates, saves and persists after refresh', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await page.getByTestId('options-button').click();
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();

    const session = page.getByLabel('Game session time', { exact: true });
    const spawn = page.getByLabel('Enemy spawn time', { exact: true });
    await expect(session).toHaveValue('120');
    await expect(spawn).toHaveValue('3');

    // Invalid values show accessible errors and are not saved.
    await session.fill('30');
    await spawn.fill('0');
    await page.getByTestId('save-options').click();
    await expect(page.getByText('Session time must be between 60 and 180 seconds.')).toBeVisible();
    await expect(page.getByText('Spawn interval must be greater than zero.')).toBeVisible();
    await expect(session).toHaveAttribute('aria-invalid', 'true');
    await expect(session).toBeFocused();

    await session.fill('200');
    await spawn.fill('0.3');
    await page.getByTestId('save-options').click();
    await expect(page.getByText('Session time must be between 60 and 180 seconds.')).toBeVisible();
    await expect(page.getByText('Spawn interval must be between 0.5 and 10 seconds.')).toBeVisible();

    await spawn.fill('2.25');
    await page.getByTestId('save-options').click();
    await expect(page.getByText('Spawn interval must use steps of 0.5 seconds.')).toBeVisible();

    // Stepper buttons and a valid save.
    await session.fill('90');
    await page.getByRole('button', { name: 'Increase game session time' }).click();
    await expect(session).toHaveValue('100');
    await spawn.fill('2');
    await page.getByRole('button', { name: 'Decrease enemy spawn time' }).click();
    await expect(spawn).toHaveValue('1.5');
    await page.getByTestId('save-options').click();
    await expect(page.getByTestId('options-status')).toHaveText(/Options saved/);

    await page.reload();
    await expect(page.getByLabel('Game session time', { exact: true })).toHaveValue('100');
    await expect(page.getByLabel('Enemy spawn time', { exact: true })).toHaveValue('1.5');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pb.options.v1') ?? 'null'));
    expect(stored).toMatchObject({ sessionTimeSec: 100, spawnIntervalSec: 1.5 });

    await page.getByTestId('back-to-menu').click();
    await expect(page.getByTestId('play-button')).toBeVisible();
  });

  test('menus are keyboard navigable with visible focus', async ({ page, setup }) => {
    await setup();
    await page.goto('/');
    await expect(page.getByTestId('play-button')).toBeVisible();
    await page.keyboard.press('Tab');
    const play = page.getByTestId('play-button');
    await expect(play).toBeFocused();
    const outline = await play.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('solid');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('options-button')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Options' })).toBeVisible();
    // Game keys are not captured outside gameplay: typing in a field works.
    const name = page.getByLabel('Captain name');
    await name.fill('');
    await name.pressSequentially('Wade Q');
    await expect(name).toHaveValue('Wade Q');
  });

  test('a match uses the options snapshot taken when it starts', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 75, spawnIntervalSec: 4 } });
    await page.goto('/?test=1&clock=manual#/');
    await page.getByTestId('play-button').click();
    await page.waitForFunction(() => (window as unknown as { __PIRATE__?: { getState(): { phase: string } } }).__PIRATE__?.getState().phase === 'running');
    const cfg = await page.evaluate(() => (window as unknown as { __PIRATE__: { getState(): { config: { session: { durationSec: number }; spawn: { intervalSec: number } } } } }).__PIRATE__.getState().config);
    expect(cfg.session.durationSec).toBe(75);
    expect(cfg.spawn.intervalSec).toBe(4);
    await expect(page.getByTestId('hud-time')).toContainText('01:15');
  });
});
