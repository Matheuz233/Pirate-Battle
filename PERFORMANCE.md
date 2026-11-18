# Performance

Raw data: [`reports/perf/perf-report.json`](reports/perf/perf-report.json) — reproduce with `npm run perf` (optimised `vite build` + `vite preview`; `PERF_GPU=1` uses the real GPU instead of SwiftShader).

## Method

- **Combat run**: one 180 s match in real time, seed 99, spawn interval 1.5 s, `maxAlive` 14 (stress, default is 10), invulnerable player so the match lasts the full three minutes. A Playwright autopilot holds forward, turns periodically and fires bow + both broadsides continuously. The engine's `PerfMonitor` records the **real wall-clock interval between frames**, the **JS work per frame** (simulation steps + scene update + render submission) and the entity count (player + enemies + projectiles + live particles) every frame.
- **Lifecycle run**: 5 × (start match → play 10 s with the autopilot → pause → Main Menu). After each cycle: forced GC via CDP (`HeapProfiler.collectGarbage`), then `Runtime.getHeapUsage` and `Memory.getDOMCounters`, plus a canvas count.

## Reference environment of the recorded run

| | |
| --- | --- |
| Hardware | Cloud container, Intel Xeon @ 2.10 GHz, **2 vCPU**, 7.8 GB RAM, **no GPU** |
| Browser | Chromium 153 (headless), WebGL through **SwiftShader** (software rasteriser) |
| Resolution | 1280 × 720 viewport, DPR 1 |
| Match config | 180 s, spawn 1.5 s, maxAlive 14, seed 99 |

## Results

| Metric | Value |
| --- | --- |
| Simulated time | 173.3 s of 180 s wall (sim keeps real time; the cap of 6 steps/frame dropped ~4 % at the slowest frames) |
| Average FPS | **9.6** (software WebGL) |
| p95 / p99 / max frame interval | 127 ms / 147.5 ms / 196 ms |
| **JS work per frame** (sim + scene + submit) | **1.13 ms avg, 3.4 ms p95** |
| Entities | avg 112, max 215 (≤ 14 enemies, particles dominate) |

Lifecycle (heap after GC):

| | Heap | DOM nodes | JS listeners | Canvases |
| --- | --- | --- | --- | --- |
| Baseline (menu) | 8.44 MB | 142 | 194 | 0 |
| After cycle 1 | 8.61 MB | 145 | 194 | 0 |
| After cycle 2 | 8.79 MB | 145 | 194 | 0 |
| After cycle 3 | 8.87 MB | 145 | 194 | 0 |
| After cycle 4 | 8.97 MB | 145 | 194 | 0 |
| After cycle 5 | 9.01 MB | 145 | 194 | 0 |

## Analysis

- **Frame rate in this environment is bound by software rasterisation, not by the game code.** The JS cost of a frame is ~1.1 ms on average and 3.4 ms at p95 — about 7–20 % of the 16.7 ms budget for 60 FPS — while each frame takes ~100 ms wall time because SwiftShader rasterises 1280 × 720 on two shared vCPUs (one also running the test driver). On any hardware-accelerated browser the same build is GPU-light: 3 texture atlases, a single `TilingSprite` for water, the static map baked into one texture, pooled sprites and particles — a handful of draw calls per frame. To reproduce on real hardware run `PERF_GPU=1 npm run perf` (headed GPU recommended); the 60 FPS target is expected there given the measured JS budget.
- The simulation stays correct under low FPS: it is fixed-step, the clock is step-based, frame deltas are clamped and the per-frame step cap avoids a spiral of death (the only effect is the match lasting slightly longer in wall time than in game time).
- **Memory**: no listener, DOM-node or canvas growth across cycles; every engine destroys its PixiJS app, WebGL context, observers and listeners. The heap rises by ~0.6 MB over five cycles with a shrinking increment (0.17 → 0.04 MB), consistent with warm caches (TanStack Query cache, JIT, pooled objects inside PixiJS) rather than a leak. Atlas textures are cached on purpose and reused by every match.

## Limitations observed

- No GPU was available in the delivery environment, so absolute FPS figures are not representative of real devices; the JS work time is the meaningful number here.
- Headless Chromium + SwiftShader and the Playwright driver share the same two vCPUs.
- Particles are the largest entity count; the pools are capped (600 effects, 300 wakes) so worst cases stay bounded.
