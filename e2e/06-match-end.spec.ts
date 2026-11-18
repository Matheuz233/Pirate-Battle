import { test, expect, startMatch, getState, advance, hold, waitForPhase, NO_SPAWNS } from './fixtures';

test.describe('Match end and restart', () => {
  test('ends by time, freezes the simulation and shows the result', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 } });
    await startMatch(page, { overrides: { player: { maxHealth: 100000 } }, resultDelay: 6000, seed: 4 });
    await advance(page, 59_000);
    let s = await getState(page);
    expect(s.phase).toBe('running');
    await expect(page.getByTestId('hud-time')).toContainText('00:01');
    await advance(page, 1100);
    s = await getState(page);
    expect(s.phase).toBe('ended');
    expect(s.endReason).toBe('time_up');
    expect(s.elapsedSec).toBeCloseTo(60, 3);

    // Nothing moves, fires, spawns or scores after the end.
    const frozen = JSON.stringify({ p: s.player, e: s.enemies, score: s.score, steps: s.stepCount, spawned: s.spawned });
    await page.keyboard.down('KeyW');
    await page.keyboard.press('Space');
    expect(await advance(page, 1000)).toBe(0);
    await page.keyboard.up('KeyW');
    const after = await getState(page);
    expect(JSON.stringify({ p: after.player, e: after.enemies, score: after.score, steps: after.stepCount, spawned: after.spawned })).toBe(frozen);

    await expect(page.getByRole('heading', { name: 'Battle complete' })).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Time up');
    await expect(page.getByTestId('result-duration')).toHaveText('01:00');
  });

  test('ends when the player ship is destroyed', async ({ page, setup }) => {
    await setup();
    await startMatch(page, {
      seed: 11,
      overrides: {
        player: { maxHealth: 20 },
        spawn: { openingSequence: ['chaser'], distribution: { chaser: 1, shooter: 0 }, maxAlive: 1, initialDelaySec: 0.5 },
      },
    });
    let s = await getState(page);
    for (let i = 0; i < 40 && s.phase === 'running'; i++) {
      await advance(page, 250);
      s = await getState(page);
    }
    expect(s.phase).toBe('ended');
    expect(s.endReason).toBe('destroyed');
    expect(s.player.alive).toBe(false);
    expect(s.score).toBe(0);
    await expect(page.getByRole('heading', { name: 'Ship destroyed' })).toBeVisible();
    await expect(page.getByTestId('result-reason')).toHaveText('Ship destroyed');
  });

  test('restart creates a clean new match', async ({ page, setup }) => {
    await setup();
    await startMatch(page, { seed: 2 });
    await hold(page, 'KeyW', 1500);
    await page.keyboard.press('Space');
    await advance(page, 4000);
    const before = await getState(page);
    expect(before.stepCount).toBeGreaterThan(0);
    expect(before.spawned.chaser + before.spawned.shooter).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-dialog')).toBeVisible();
    await page.getByTestId('restart-button').click();
    await waitForPhase(page, 'running');
    const s = await getState(page);
    expect(s.stepCount).toBe(0);
    expect(s.score).toBe(0);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.timeLeftSec).toBe(s.config.session.durationSec);
    expect(s.enemies).toHaveLength(0);
    expect(s.projectiles).toHaveLength(0);
    expect(s.player.x).toBe(640);
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('play again from the result screen starts a fresh match', async ({ page, setup }) => {
    await setup({ options: { sessionTimeSec: 60, spawnIntervalSec: 3 } });
    await startMatch(page, { overrides: NO_SPAWNS });
    await advance(page, 60_100);
    await page.getByTestId('play-again').click();
    await waitForPhase(page, 'running');
    const s = await getState(page);
    expect(s.stepCount).toBe(0);
    expect(s.timeLeftSec).toBe(60);
  });
});
