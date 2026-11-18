# Pirate Battle

A top-down 2D naval shooter built with **React 19, TypeScript (strict), PixiJS 8, TanStack Query 5, Axios, MSW 2 and Playwright**.
Sail between islands, sink Chasers and Shooters, and climb the ranking before the clock runs out.

- **Live demo:** `<add your Vercel URL here>`
- Architecture and design decisions: [ARCHITECTURE.md](ARCHITECTURE.md)
- Performance evidence: [PERFORMANCE.md](PERFORMANCE.md)
- Original challenge brief: [docs/CHALLENGE.md](docs/CHALLENGE.md)

## Setup

Requirements: Node.js ≥ 20.19 and npm.

```bash
npm ci
npx playwright install chromium   # only needed for the E2E tests
npm run dev                        # http://localhost:5173
```

The mock API (MSW) runs in every build, including the published one, so no backend is needed.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Serve the production build on http://localhost:4173 |
| `npm run lint` | ESLint (TypeScript, React Hooks, TanStack Query rules) |
| `npm run typecheck` | TypeScript project build, no emit |
| `npm run test:unit` | Vitest unit tests of the simulation rules |
| `npm run test:e2e` | Playwright E2E + visual regression (desktop & mobile Chromium, builds and serves `dist/` automatically) |
| `npm run test:e2e:update` | Re-generate visual baselines |
| `npm run test:e2e:report` | Open the HTML report (`reports/playwright/`) |
| `npm run perf` | 3-minute combat profiling + 5 lifecycle cycles → `reports/perf/perf-report.json` |
| `npm run atlases` | Re-generate the PixiJS atlases from the original XML/tile sheets |

## Environment variables

All optional (see `.env.example`).

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_ENABLE_MOCKS` | `true` | Set to `false` to disable MSW (requires a real API at `VITE_API_BASE_URL`). |
| `VITE_API_BASE_URL` | `/api` | Base URL of the ranking/history API. |
| `VITE_API_TIMEOUT_MS` | `8000` | Axios timeout. Can also be overridden per page load with `?apiTimeout=1500`. |
| `PW_CHROMIUM_EXECUTABLE` | – | Use a local Chrome/Chromium binary for Playwright instead of the downloaded one. |
| `PW_PORT` | `4173` | Port used by Playwright's preview server. |
| `PERF_GPU` | – | `1` = run `npm run perf` with the hardware GPU instead of SwiftShader. |

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Sail forward | `W` / `↑` | ⬆ button (left cluster) |
| Turn left / right | `A` `D` / `←` `→` | ↶ ↷ buttons (left cluster) |
| Bow cannon (1 ball) | `Space` / `J` | centre button (right cluster) |
| Port broadside (3 balls, left) | `Q` | left button (right cluster) |
| Starboard broadside (3 balls, right) | `E` | right button (right cluster) |
| Pause / resume | `Esc` / `P`, pause button | pause button |

Movement and firing can be combined freely (several keys or several fingers at once). Gameplay keys are captured only while a battle is active.
On phones the game supports **landscape** orientation; in portrait the battle pauses and asks you to rotate the device.

## Gameplay configuration

Every balancing value is in [`src/game/config/gameConfig.ts`](src/game/config/gameConfig.ts) (`DEFAULT_GAME_CONFIG`, fully typed): session duration, spawn interval/initial delay/cap/distribution/opening sequence/minimum distances, health, speeds, acceleration, turn rates, damage, range, projectile speed, cooldowns, Chaser contact damage, Shooter range/preferred distance/aim tolerance, AI path refresh. Systems only read this object, so balancing never touches system code.

The **Options** screen exposes:

| Option | Range | Default |
| --- | --- | --- |
| Game session time | 60–180 s (whole seconds) | 120 s |
| Enemy spawn time | 0.5–10 s, step 0.5 s | 3 s |

Options (plus captain name and sound) are validated, saved to `localStorage` and survive refresh. Each match takes an immutable snapshot of the configuration when it starts.

## Mock API, network scenarios and reproducing failures

Ranking and history use REST endpoints mocked by MSW (contracts in [`src/api/contracts.ts`](src/api/contracts.ts)):

```
GET  /api/ranking?sessionTimeSec&spawnIntervalSec&configVersion&page&pageSize
GET  /api/ranking/buckets
GET  /api/players/:playerId/matches?page&pageSize
POST /api/matches          (Idempotency-Key: <matchId>)
```

**Selecting a scenario** — either:
- **Options → "Network lab (mock API scenarios)"**: pick a scenario, seed and latency multiplier, then *Apply*. *Reset all* restores the initial state (success scenario, no saved battles, empty outbox, last result cleared).
- **URL**: `/?scenario=<name>&mockSeed=<n>&latency=<multiplier>` (persisted for later loads).

| Scenario | Effect |
| --- | --- |
| `success` | Normal latency 200–600 ms (seeded) |
| `empty` | No fixture players (empty lists until you record a battle) |
| `many-pages` | 150 extra fixture matches in the 120 s / 3 s bucket |
| `slow` | Every response takes 2.5 s |
| `variable-latency` | 100 ms – 3 s, seeded |
| `out-of-order` | Odd requests 1.8 s, even 150 ms → newer requests answer first |
| `timeout` | Server never answers (Axios timeout) |
| `network-error` | Connection failure on every request |
| `server-error` / `client-error` | HTTP 500 / HTTP 400–422 everywhere |
| `flaky` | ~50 % of requests fail with 503 (seeded) |
| `ranking-error` / `history-error` | Only that query fails |
| `submit-timeout` | The match **is stored**, but the first POST response is lost → retry returns the existing record |
| `submit-offline` | Match submission fails (backend unavailable at match end) |

**Reproducing the main failure flows**
1. *Pending record after refresh*: Network lab → `submit-offline` → play a battle → result shows "not saved" → refresh → the menu shows the pending banner → Network lab → `success` → Apply → the record is sent and appears once in both tabs.
2. *Timeout without duplication*: open `/?scenario=submit-timeout&apiTimeout=1500` → finish a battle → first attempt times out, the automatic retry returns the stored record; History shows it once.
3. *Late responses*: `/?scenario=out-of-order&latency=1#/log/ranking` and page quickly back and forth.

Confirmed records and pending submissions are persisted in `localStorage` (`pb.mock.db.v1`, `pb.outbox.v1`), so they survive refreshes in dev, tests and the deployed demo.

## Testing

```bash
npm run test:unit
npm run test:e2e                         # both projects: chromium-desktop and chromium-mobile (Pixel 7 landscape)
npx playwright test --project=chromium-desktop e2e/04-combat.spec.ts
```

- Tests start the real app with `?test=1&seed=<n>&clock=manual` (see `src/app/testMode.ts`). The instrumentation (`window.__PIRATE__`) only **observes state and advances the simulation clock**; inputs are real key presses / pointer events, and rules, collisions and rendering run unchanged. Config overrides (`&overrides=<json>`) use the same typed config as the game.
- Each test gets a fresh browser context and seeds `localStorage` once (scenario with zero latency unless stated).
- Any unexpected console error fails the test.
- Reports: HTML at `reports/playwright/index.html`; traces and screenshots of failures in `test-results/`.
- Visual baselines (menu, stable arena, result) are versioned in `e2e/__screenshots__/` per project. They were generated on Linux with Chromium + SwiftShader; regenerate with `npm run test:e2e:update` if your platform renders fonts differently (or run in the official Playwright Docker image).

| # | Requirement | Spec |
| --- | --- | --- |
| 1 | Options navigation, validation, persistence | `01-options` |
| 2 | Asset loading, failure, retry | `02-assets` |
| 3 | Start, movement, rotation, arena limits, islands | `03-movement` |
| 4 | Front/side fire, damage, cooldown, scoring once | `04-combat` |
| 5 | Chaser, Shooter, spawn interval | `05-enemies` |
| 6 | End by time/death, frozen simulation, clean restart | `06-match-end` |
| 7 | Pause, focus loss, resume without clock drift | `07-pause` |
| 8 | Result and persistence after refresh | `08-result` |
| 9 | Abandonment, repeated navigation, touch controls | `09-navigation` |
| 10 | Ranking/history pagination, loading, empty, error | `10-log` |
| 11 | Registration, both tabs updated, pending recovery after refresh | `11-submission` |
| 12 | Timeout retry without duplicates, late responses | `12-resilience` |
| – | Visual regression | `13-visual` |

## Deployment (Vercel)

`vercel.json` is included: build `npm run build`, output `dist`, SPA rewrite and no-cache header for `mockServiceWorker.js`.

```bash
npm i -g vercel
vercel --prod
```

Netlify / Cloudflare Pages work the same way (build command `npm run build`, publish directory `dist`).

## Assets and licenses

Game art, UI and sounds come from the challenge pack in `public/assets` (vector sources kept in `assets-src/`). `public/assets/atlas/*.json` were generated from the provided XML atlas and tile sheet by `scripts/build-atlases.mjs`. Font: [Rubik](https://fonts.google.com/specimen/Rubik) via `@fontsource/rubik`, SIL Open Font License 1.1. No other third-party assets are used.
