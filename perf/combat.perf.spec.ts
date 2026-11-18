import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';

/**
 * Performance evidence:
 *  1. one 180 s match in real time (optimised build) with an autopilot that sails, turns and
 *     fires continuously → FPS, p95/p99 frame time, entity counts;
 *  2. five start → play → exit cycles → JS heap after forced GC and DOM/canvas counts.
 * Results go to reports/perf/perf-report.json.
 */

const OPTIONS = { sessionTimeSec: 180, spawnIntervalSec: 1.5, soundEnabled: false };
// Invulnerable player so the match lasts the full three minutes; maxAlive raised to stress.
const OVERRIDES = { player: { maxHealth: 1e9 }, spawn: { maxAlive: 14 } };

async function seed(page: Page) {
  await page.addInitScript((o) => {
    if (sessionStorage.getItem('__perf')) return;
    sessionStorage.setItem('__perf', '1');
    localStorage.setItem('pb.options.v1', JSON.stringify(o));
    localStorage.setItem('pb.mock.scenario.v1', JSON.stringify({ name: 'success', seed: 1, latencyScale: 0 }));
  }, OPTIONS);
}

async function autopilot(page: Page, ms: number) {
  const end = Date.now() + ms;
  await page.keyboard.down('KeyW');
  let i = 0;
  while (Date.now() < end) {
    const key = ['Space', 'KeyQ', 'KeyE'][i % 3]!;
    await page.keyboard.press(key);
    if (i % 4 === 0) await page.keyboard.down('KeyD');
    await page.waitForTimeout(350);
    await page.keyboard.up('KeyD');
    i++;
  }
  await page.keyboard.up('KeyW');
}

async function heapMB(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
  const dom = (await cdp.send('Memory.getDOMCounters')) as { documents: number; nodes: number; jsEventListeners: number };
  await cdp.detach();
  return { heapMB: +(usedSize / 1048576).toFixed(2), domNodes: dom.nodes, listeners: dom.jsEventListeners };
}

test('180 s combat and 5 lifecycle cycles', async ({ page, browserName }) => {
  await seed(page);
  const q = `test=1&seed=99&overrides=${encodeURIComponent(JSON.stringify(OVERRIDES))}`;
  await page.goto(`/?${q}#/`);
  await page.getByTestId('play-button').click();
  await page.waitForFunction(() => (window as any).__PIRATE__?.getState().phase === 'running');
  await page.evaluate(() => (window as any).__PIRATE__.resetPerf());

  const timeline: { t: number; fps: number; entities: number; enemies: number; projectiles: number }[] = [];
  const start = Date.now();
  for (let s = 0; s < 18; s++) {
    await autopilot(page, 10_000);
    const st = await page.evaluate(() => {
      const api = (window as any).__PIRATE__;
      const g = api.getState();
      return { enemies: g.enemies.length, projectiles: g.projectiles.length, particles: g.render?.particles ?? 0, phase: g.phase, elapsed: g.elapsedSec, perf: api.perf() };
    });
    timeline.push({ t: Math.round((Date.now() - start) / 1000), fps: +st.perf.avgFps.toFixed(1), entities: 1 + st.enemies + st.projectiles + st.particles, enemies: st.enemies, projectiles: st.projectiles });
    if (st.phase !== 'running') break;
  }
  const match = await page.evaluate(() => {
    const api = (window as any).__PIRATE__;
    return api ? { perf: api.perf(), elapsed: api.getState().elapsedSec } : null;
  });
  await expect(page.getByTestId('result-score')).toBeVisible({ timeout: 30_000 });

  // Lifecycle / memory: 5 × (start → play 10 s → leave).
  await page.getByTestId('result-menu').click();
  const baseline = await heapMB(page);
  const cycles: { cycle: number; heapMB: number; domNodes: number; listeners: number; canvases: number }[] = [];
  for (let c = 1; c <= 5; c++) {
    await page.getByTestId('play-button').click();
    await page.waitForFunction(() => (window as any).__PIRATE__?.getState().phase === 'running');
    await autopilot(page, 10_000);
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-menu-button').click();
    await expect(page.getByTestId('play-button')).toBeVisible();
    await page.waitForTimeout(500);
    const m = await heapMB(page);
    cycles.push({ cycle: c, ...m, canvases: await page.locator('canvas').count() });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      browser: `${browserName} ${page.context().browser()?.version()}`,
      renderer: process.env.PERF_GPU === '1' ? 'hardware GPU' : 'SwiftShader (software WebGL, headless)',
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      memoryGB: +(os.totalmem() / 1073741824).toFixed(1),
      viewport: '1280x720 @1x',
      match: { ...OPTIONS, overrides: OVERRIDES, seed: 99 },
    },
    match: match && {
      simulatedSec: +match.elapsed.toFixed(1),
      frames: match.perf.frames,
      avgFps: +match.perf.avgFps.toFixed(1),
      p95FrameMs: +match.perf.p95FrameMs.toFixed(2),
      p99FrameMs: +match.perf.p99FrameMs.toFixed(2),
      maxFrameMs: +match.perf.maxFrameMs.toFixed(2),
      maxEntities: match.perf.maxEntities,
      avgEntities: +match.perf.avgEntities.toFixed(1),
      avgWorkMs: +match.perf.avgWorkMs.toFixed(2),
      p95WorkMs: +match.perf.p95WorkMs.toFixed(2),
    },
    timeline,
    memory: { baseline, cycles },
  };
  mkdirSync('reports/perf', { recursive: true });
  writeFileSync('reports/perf/perf-report.json', JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report, null, 2));
  expect(cycles.every((c) => c.canvases === 0)).toBe(true);
});
