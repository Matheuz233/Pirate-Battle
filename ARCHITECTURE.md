# Architecture

## Overview

```
src/
  game/                 framework-agnostic game code (no React)
    config/             typed GameConfig + arena map
    core/               math, seeded RNG
    sim/                World (rules, AI, collisions, spawns), navigation flow field, types
    input/              InputController (keyboard + touch → InputFrame)
    render/             ArenaRenderer (PixiJS scene), pooled particle effects
    assets/             texture loading/validation/caching
    audio/              Web Audio sound manager (optional, never blocking)
    engine/             GameEngine (lifecycle, ticker, pause), GameStore (HUD bridge), PerfMonitor
  screens/ components/  React UI (menus, HUD, dialogs, touch controls, tabs)
  api/                  contracts, Axios client, TanStack Query options, submission outbox provider
  mocks/                MSW handlers, scenarios, mock DB + fixtures
  storage/              typed localStorage stores (options, player, last result, outbox)
```

Responsibilities are separated as **rules** (`sim/World`), **rendering** (`render/ArenaRenderer`), **input** (`input/InputController`) and **UI state** (React + `GameStore`). `GameEngine` is the only place that wires them together.

## React ↔ PixiJS integration

- `PlayScreen` loads the textures first (progress bar, error + Retry). Only when every required texture is present and valid does it render `GameView`, which creates a `GameEngine` inside a `useEffect` and destroys it in the cleanup.
- `GameEngine.mount()` is async (PixiJS `Application.init`). If the component unmounts while it is still initialising — which React **Strict Mode** does on purpose (mount → unmount → mount) — `destroy()` sets a flag and `mount()` disposes the freshly created application as soon as `init` resolves. The second mount then creates a clean instance. Every match is a new engine; "Restart" simply remounts it with a new React `key`.
- React never renders per frame. The engine pushes values into `GameStore` (an external store read with `useSyncExternalStore`); `patch()` only notifies when a displayed value changes (score, whole seconds left, HP, phase). The HUD therefore re-renders about once per second.
- The HUD is DOM (semantic: `meter`, `timer`, status text). In-world indicators (health bars above every ship, effects) are PixiJS.
- Accessibility announcements are discrete (start, pause, 60/30/10 s left, end, saved) through one shared live region.

## Simulation loop

- `World.step(dt, input)` is pure TypeScript, deterministic for a seed and a sequence of inputs, and knows nothing about DOM/PixiJS/timers. Unit-tested with Vitest.
- **Fixed timestep** (1/60 s) driven by an accumulator in the PixiJS ticker: `accumulator += min(frameDelta, 250 ms)`; at most 6 steps per frame, extra backlog is dropped (no spiral of death). Movement, cooldowns, spawns, projectile lifetimes and the match clock all advance only in `step`, so they are frame-rate independent. The match clock is `stepCount × dt` (no float drift); a match of N seconds ends after exactly `N/dt` steps.
- Order per step: player (turn, thrust, move, fire) → spawner → enemy AI and movement → ship contacts (ram / separation) → projectiles (move, islands, bounds, hits, expiry) → remove dead → end check (death has priority over time-up).
- Side effects for presentation are emitted as `SimEvent`s (shot, hit, splash, destroyed, ram, score, ended). The renderer turns them into particles/shake, the engine into sounds and HUD state.
- **Pause** (manual, `blur`, `visibilitychange` hidden, portrait orientation) stops stepping, disables input (held keys and latched taps are cleared, new key presses are ignored) and resets the accumulator; cooldowns and timers live in the simulation, so they freeze too. Resume requires an explicit action (button or Esc in the dialog). The dialog focuses its title, not the Resume button, so a stray Space cannot resume by accident.
- Ending stops everything: `step` returns immediately once `status === 'ended'`, input is disabled, and the result is persisted/submitted exactly once (guarded by a ref and by the idempotent outbox).

### Input

`InputController` attaches window listeners only while a match is mounted and only acts while the match is running. Presses are *latched*, so a tap shorter than one step still fires once; each source (key code, pointer id) is tracked separately, enabling simultaneous move + turn + fire on keyboard and multi-touch.

## Enemies and combat

- **Chaser**: steers toward the player; on contact it damages the player (`contactDamage`), explodes and is removed without scoring.
- **Shooter**: approaches, slows inside `attackRange` and nearly stops at `preferredDistance`, turns to aim and fires its bow cannon when the aim error is below `aimToleranceDeg`, with its own cooldown and line of sight.
- **Navigation**: if the player is visible (segment vs inflated island rects) enemies steer directly; otherwise they follow a **flow field** (Dijkstra on a 32 px grid with islands inflated by the enemy radius, rebuilt at most every 0.25 s and only when the player changes cell). Turn rate limits steering and speed is reduced while turning sharply.
- **Projectiles** carry team, damage, speed and a lifetime of `range / speed`. Each one is removed on its first hit (damage applied once), on islands, when leaving the arena or when it expires. Only player projectiles hit enemies and vice versa. Each weapon has its own cooldown. Destroyed enemies are removed from all lists in the same step, so they cannot deal damage, fire or collide.
- **Spawns** happen every `intervalSec` (first after `min(initialDelaySec, intervalSec)`) until the match ends. Candidate points lie along the arena edges, outside islands; a point is rejected if closer than `minDistanceFromPlayer` (360) to the player or `minDistanceFromShips` to another enemy. The opening sequence (`chaser`, `shooter`) guarantees both types appear in a standard match; afterwards the weighted distribution is used. At `maxAlive` enemies, the spawn for that interval is skipped (performance and readability cap).

## Collisions

- Ships are circles; islands are axis-aligned rects inset by 10 px (the sand edges are rounded). Circle-vs-rect push-out (two passes) keeps ships out of islands; the arena clamp keeps the whole hull visible. Contacts cap speed so ships slide along coasts.
- Ship-vs-ship: Chaser contact triggers the ram; other overlaps are separated symmetrically and re-resolved against islands.
- Projectiles are small circles tested against padded island rects and ship circles.

## Rendering and resources

- **Atlases**: the XML ship atlas and the fixed-grid tile sheet were converted to PixiJS JSON (`scripts/build-atlases.mjs`); the UI atlas is used as delivered. Three textures in total; retina tiles/UI are used when `devicePixelRatio > 1`.
- **Loading**: `loadGameTextures` loads the bundle once with progress, validates that every frame used by the game exists, pre-cuts health-bar fill textures, and caches the result for later matches. Failures are not cached, so *Retry* performs fresh requests.
- **Scene**: water is one `TilingSprite`; static tiles (shallows, islands, props) are baked with `cacheAsTexture` (one draw call, no seams at fractional scale). Ships are views keyed by entity id, cannonballs come from a sprite pool, and short-lived effects (muzzle flash, smoke, splash rings, debris, explosions, wakes) use a pooled particle system with its own seeded RNG (reproducible screenshots). Damage is shown with the 4 hull stages from the art (intact → damaged → heavily damaged → wreck), flames, hit flash and screen shake on player hits.
- **Resize / DPI**: a `ResizeObserver` resizes the renderer to its container; `autoDensity` + `resolution = min(devicePixelRatio, 2)` keeps it crisp. The logical arena (1280 × 768) is scaled uniformly and letterboxed below a band reserved for the DOM HUD, so proportions, collision limits and the HUD never change with the window size. Rules use world units only; touch controls are DOM buttons, so no screen↔world conversion is needed for input.
- **Teardown** (`GameEngine.destroy`, idempotent): input listeners, `visibilitychange`/`blur` listeners, ResizeObserver, ticker callback, sound loop, all display objects and generated textures, the PixiJS application and its WebGL context. Shared atlas textures are intentionally kept for reuse. The perf run shows a flat heap and constant listener/DOM counts over 5 start/exit cycles.

## Local persistence

| Key | Content |
| --- | --- |
| `pb.options.v1` | Validated options (session time, spawn interval, sound) |
| `pb.player.v1` | Player id (UUID) and captain name |
| `pb.lastResult.v1` | Last completed match + submission state |
| `pb.outbox.v1` | Pending submissions (transactional outbox) |
| `pb.mock.db.v1` / `pb.mock.scenario.v1` | Mock server records / selected scenario |

Stores are typed, validated on read (corrupt data falls back to defaults) and synchronise across tabs via `storage` events. A refresh on the battle route lands on the menu: abandoned matches are never recorded.

## Ranking and history integration

- **Contracts** (`src/api/contracts.ts`) are shared by the client, the MSW handlers and the tests. Each record carries `matchId`, `playerId`, `playerName`, `playedAt`, `score`, `durationMs` (active play time), `endReason` and the `config` snapshot (`sessionTimeSec`, `spawnIntervalSec`, `configVersion`).
- **Ranking buckets**: only matches with the same config are compared. Order: score ↓, duration ↓ (survived longer), `playedAt` ↑ (first to reach it), `matchId` ↑ — fully deterministic. One ranking entry per match. The tab defaults to the player's current settings and lets them pick other buckets.
- **Axios** client with timeout, error normalisation (`timeout | network | client | server`), `AbortSignal` support.
- **TanStack Query**: paginated queries with `placeholderData: keepPreviousData`, `staleTime` 15 s, `refetchOnMount: 'always'` (tabs refetch in the background every time they are shown, keeping cached data visible with an "Updating…" indicator), retries (2, exponential backoff) only for retryable errors, explicit loading / empty / error / stale-refresh states.
- **Late responses**: TanStack cancels superseded fetches through the abort signal; additionally every page carries the server `revision`, and a response with an older revision than the cached data for the same key is discarded.
- **Submission (exactly-once on the server, at-least-once delivery)**:
  1. At match end the submission is written to the **outbox** and `lastResult` *before* any network call.
  2. A single `useMutation` (in `SubmissionProvider`) sends it with `Idempotency-Key = matchId`; an in-flight set prevents parallel duplicates from repeated clicks.
  3. The server stores a match once; re-sends return the existing record (`created: false`), different payloads with the same id get 409.
  4. Success removes the outbox entry, marks the result *saved* and invalidates both `ranking` and `history`, so both tabs update.
  5. Failures keep the entry (*failed*, with a Retry button on the result screen and a banner on the menu). Pending entries are retried on startup (covers refresh mid-request), on the `online` event, after applying a network scenario and on demand. New matches can be played meanwhile.
- API failures never block the game or the options; the battle doesn't depend on the network at all.

## MSW

Handlers in `src/mocks/handlers.ts` are started before React renders (dev, tests and production build — the service worker file is in `public/`). Scenarios are read from `localStorage` on every request, so they can be switched live from the Network lab, the URL or tests. Latency and flaky failures use a seeded RNG; tests use `latencyScale: 0`. Fixtures (48 base + 150 optional) are generated deterministically and never persisted; confirmed records are.

## Balancing decisions

| | Player | Chaser | Shooter |
| --- | --- | --- | --- |
| HP | 100 | 40 | 60 |
| Max speed | 165 | 120 | 85 |
| Turn rate | 150°/s | 110°/s | 95°/s |
| Weapon | bow 20 dmg / 450 ms / 440 range; broadside 3×15 dmg / 1.2 s / 300 range | ram 25 dmg (dies) | bow 10 dmg / 1.7 s / 360 range, fires within 320 |

- The player is the fastest and most agile ship: survival is about positioning, not tanking.
- A Chaser dies to 2 bow shots or one full broadside, so broadsides reward letting Chasers come alongside.
- Shooters keep ~230 units away and fire slowly; they are the main threat over time and take 3 bow shots.
- Four ram hits kill the player, so a default 3 s spawn interval is survivable but not idle.
- Enemies wait one full cannon cooldown after spawning before firing; spawn points are ≥ 360 units from the player — no unavoidable damage on spawn.

## Limitations

- Island collision uses inset rectangles; at the rounded sand corners ships can come a few pixels closer to the art than on straight edges.
- The AI is intentionally simple (flow field + direct pursuit); enemies may bunch up near island corners for a moment.
- Mobile is landscape-only; very small phones (< 360 px tall) get a smaller arena.
- Performance numbers in this repository come from a 2-vCPU container with software WebGL (see PERFORMANCE.md); real GPUs are far faster.
- Visual baselines are platform-specific (fonts/rasterisation).
- The mock "server" lives in the browser's `localStorage`: data is per-browser and cleared with *Reset all* in the Network lab.
