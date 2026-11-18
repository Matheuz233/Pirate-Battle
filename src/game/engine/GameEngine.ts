import { Application, type Ticker } from 'pixi.js';
import type { GameConfig } from '../config/gameConfig';
import type { GameTextures } from '../assets/gameAssets';
import { sounds } from '../audio/SoundManager';
import { InputController, type GameAction } from '../input/InputController';
import { ArenaRenderer } from '../render/ArenaRenderer';
import type { SimEvent } from '../sim/types';
import { World } from '../sim/world';
import { GameStore, initialHud, type PauseReason } from './GameStore';
import { PerfMonitor } from './PerfMonitor';

export interface EngineOptions {
  container: HTMLElement;
  config: Readonly<GameConfig>;
  seed: number;
  textures: GameTextures;
  /** When true the simulation advances only through `advance()` (tests). */
  manualClock?: boolean;
  /** Override the device pixel ratio (tests, perf runs). */
  resolution?: number;
}

/**
 * Owns one match: the simulation, the PixiJS application, input and the HUD store.
 *
 * Lifecycle: `new` → `mount()` (async, safe to `destroy()` mid-way, e.g. React Strict Mode)
 * → `start()` → `pause()/resume()` → `destroy()`. Every listener, ticker callback, observer,
 * display object and GPU resource created here is released in `destroy()`.
 */
export class GameEngine {
  readonly store: GameStore;
  readonly input: InputController;
  readonly perf = new PerfMonitor();
  world: World;

  private app: Application | null = null;
  private view: ArenaRenderer | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private accumulator = 0;
  private manualClock: boolean;
  private readonly eventBuffer: SimEvent[] = [];
  private lastWarnSecond = -1;
  private lowHealthWarned = false;
  private lastFrameAt = 0;

  constructor(private readonly opts: EngineOptions) {
    this.world = new World(opts.config, opts.seed);
    this.manualClock = opts.manualClock ?? false;
    this.store = new GameStore(initialHud(opts.config.player.maxHealth, opts.config.session.durationSec));
    this.input = new InputController(window, () => this.pause('manual'));
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  async mount(): Promise<void> {
    const { container } = this.opts;
    const app = new Application();
    const resolution = this.opts.resolution ?? Math.min(window.devicePixelRatio || 1, 2);
    await app.init({
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
      background: '#16496b',
      antialias: false,
      autoDensity: true,
      resolution,
      preference: 'webgl',
      autoStart: false,
    });
    if (this.destroyed) {
      // Unmounted while initialising (e.g. Strict Mode double effect): release immediately.
      app.destroy({ removeView: true }, { children: true });
      return;
    }
    this.app = app;
    app.canvas.setAttribute('aria-hidden', 'true');
    app.canvas.dataset.testid = 'game-canvas';
    container.appendChild(app.canvas);

    this.view = new ArenaRenderer(app.renderer, this.opts.textures, this.world.map);
    app.stage.addChild(this.view.root);
    this.layout();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);

    app.ticker.add(this.tick);
    app.ticker.start();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onWindowBlur);
    this.input.attach();
    this.renderFrame(0);
    this.store.patch({ phase: 'ready', loadProgress: 1 });
  }

  start(): void {
    if (this.destroyed || this.store.getSnapshot().phase !== 'ready') return;
    this.accumulator = 0;
    this.input.reset();
    this.input.setEnabled(true);
    this.store.patch({ phase: 'running' });
    sounds.play('game_start', { volume: 0.7 });
    sounds.startLoop('ocean_ambience_loop', 0.25);
  }

  pause(reason: PauseReason): void {
    if (this.store.getSnapshot().phase !== 'running') return;
    this.input.setEnabled(false);
    this.accumulator = 0;
    this.store.patch({ phase: 'paused', pauseReason: reason });
    sounds.play('game_pause', { volume: 0.6 });
  }

  /** Resuming always requires an explicit player action (button / key in the dialog). */
  resume(): void {
    if (this.store.getSnapshot().phase !== 'paused') return;
    this.accumulator = 0;
    this.input.reset();
    this.input.setEnabled(true);
    this.store.patch({ phase: 'running', pauseReason: null });
    sounds.play('game_resume', { volume: 0.6 });
  }

  /** On-screen touch controls. */
  press(action: GameAction, source: string): void {
    this.input.press(action, source);
  }

  release(action: GameAction, source: string): void {
    this.input.release(action, source);
  }

  setManualClock(manual: boolean): void {
    this.manualClock = manual;
    this.accumulator = 0;
  }

  /**
   * Test instrumentation: advances the real simulation by `ms` using fixed steps and the
   * current input state, then renders. Only works while running.
   */
  advance(ms: number): number {
    if (this.destroyed) return 0;
    const step = this.world.config.simulation.fixedStepSec;
    const steps = Math.round(ms / 1000 / step);
    let done = 0;
    for (let i = 0; i < steps; i++) {
      if (this.store.getSnapshot().phase !== 'running') break;
      this.world.step(step, this.input.consume());
      done++;
      // Drain per step so end-of-match is detected exactly when it happens.
      this.processEvents();
    }
    this.renderFrame((done * step));
    return done;
  }

  private readonly tick = (ticker: Ticker): void => {
    if (this.destroyed) return;
    const cfg = this.world.config.simulation;
    const frameMs = Math.min(ticker.deltaMS, cfg.maxFrameDeltaMs);
    const phase = this.store.getSnapshot().phase;
    const workStart = performance.now();
    // Real wall-clock frame interval (PixiJS clamps ticker.deltaMS to 100 ms).
    const realFrameMs = this.lastFrameAt ? workStart - this.lastFrameAt : ticker.deltaMS;
    this.lastFrameAt = workStart;
    if (phase === 'running' && !this.manualClock) {
      this.accumulator += frameMs / 1000;
      let steps = 0;
      while (this.accumulator >= cfg.fixedStepSec && steps < cfg.maxStepsPerFrame) {
        this.world.step(cfg.fixedStepSec, this.input.consume());
        this.accumulator -= cfg.fixedStepSec;
        steps++;
        if (this.world.status !== 'running') break;
      }
      // Drop backlog instead of spiralling when the device cannot keep up.
      if (steps >= cfg.maxStepsPerFrame) this.accumulator = 0;
    }
    const animate = !this.manualClock && (phase === 'running' || phase === 'ended');
    this.renderFrame(animate ? frameMs / 1000 : 0);
    if (phase === 'running' && !this.manualClock) {
      this.perf.record(realFrameMs, this.entityCount(), performance.now() - workStart);
    }
  };

  private entityCount(): number {
    const w = this.world;
    return 1 + w.enemies.length + w.projectiles.length + (this.view?.counts.particles ?? 0);
  }

  private processEvents(): void {
    const events = this.world.drainEvents(this.eventBuffer);
    if (events.length === 0) return;
    this.view?.handleEvents(events);
    for (const e of events) this.playSound(e);
    const ended = events.find((e): e is Extract<SimEvent, { type: 'ended' }> => e.type === 'ended');
    if (ended) {
      this.input.setEnabled(false);
      sounds.stopLoop();
      this.store.patch({
        phase: 'ended',
        summary: {
          score: this.world.score,
          durationMs: Math.round(this.world.elapsedSec * 1000),
          endReason: ended.reason,
        },
      });
    }
    events.length = 0;
  }

  private renderFrame(dt: number): void {
    if (!this.app || !this.view) return;
    this.processEvents();
    this.view.sync(this.world, dt);
    const w = this.world;
    const timeLeft = Math.ceil(w.timeLeftSec - 1e-6);
    this.store.patch({
      score: w.score,
      timeLeftSec: timeLeft,
      hp: Math.ceil(w.player.hp),
      enemies: w.enemies.length,
    });
    const snap = this.store.getSnapshot();
    if (snap.phase === 'running') {
      if (timeLeft <= w.config.session.warningAtSec && timeLeft > 0 && timeLeft !== this.lastWarnSecond) {
        this.lastWarnSecond = timeLeft;
        sounds.play('time_warning', { volume: 0.5 });
      }
      if (!this.lowHealthWarned && w.player.hp > 0 && w.player.hp / w.player.maxHp <= 0.3) {
        this.lowHealthWarned = true;
        sounds.play('health_low', { volume: 0.7 });
      }
    }
    this.app.render();
  }

  private playSound(e: SimEvent): void {
    const rng = Math.random;
    switch (e.type) {
      case 'shot':
        if (e.team === 'player') {
          if (e.weapon === 'front') sounds.play(`cannon_fire_${1 + Math.floor(rng() * 3)}` as 'cannon_fire_1', { volume: 0.6 });
          else sounds.play('cannon_broadside', { volume: 0.7, throttleMs: 120 });
        } else sounds.play('cannon_fire_2', { volume: 0.35, rate: 1.1 });
        break;
      case 'hit':
        sounds.play(rng() < 0.5 ? 'ship_wood_hit_1' : 'ship_wood_hit_2', { volume: 0.6 });
        break;
      case 'splash':
        if (!e.onLand) sounds.play(rng() < 0.5 ? 'cannonball_water_hit_1' : 'cannonball_water_hit_2', { volume: 0.25, throttleMs: 90 });
        break;
      case 'destroyed':
        sounds.play(e.kind === 'player' ? 'ship_sinking' : rng() < 0.5 ? 'ship_explosion_1' : 'ship_explosion_2', { volume: 0.7 });
        break;
      case 'ram':
        sounds.play('ship_collision', { volume: 0.7 });
        break;
      case 'score':
        sounds.play('score_point', { volume: 0.45 });
        break;
      case 'ended':
        sounds.play(e.reason === 'time_up' ? 'game_complete' : 'game_over', { volume: 0.8 });
        break;
      default:
        break;
    }
  }

  private layout(): void {
    if (!this.app || !this.view) return;
    const { container } = this.opts;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    this.app.renderer.resize(w, h);
    // Reserve a band for the DOM HUD so it never covers the arena.
    const hudBand = Math.round(Math.min(64, Math.max(40, h * 0.08)));
    this.view.layout(w, h, hudBand);
    if (this.manualClock || this.store.getSnapshot().phase !== 'running') this.renderFrame(0);
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.pause('hidden');
  };

  private readonly onWindowBlur = (): void => this.pause('focus');

  /** Plain, serialisable view of the simulation for tests and debugging. */
  getDebugState() {
    const w = this.world;
    const p = w.player;
    return {
      phase: this.store.getSnapshot().phase,
      status: w.status,
      endReason: w.endReason,
      score: w.score,
      stepCount: w.stepCount,
      elapsedSec: w.elapsedSec,
      timeLeftSec: w.timeLeftSec,
      spawned: { ...w.spawned },
      kills: { ...w.kills },
      arena: { width: w.map.width, height: w.map.height },
      islands: w.islands.map((r) => ({ ...r })),
      player: { id: p.id, x: p.x, y: p.y, heading: p.heading, speed: p.speed, hp: p.hp, maxHp: p.maxHp, radius: p.radius, alive: p.alive, cooldowns: { ...p.cooldowns } },
      enemies: w.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, heading: e.heading, speed: e.speed, hp: e.hp, maxHp: e.maxHp, radius: e.radius })),
      projectiles: w.projectiles.map((pr) => ({ id: pr.id, team: pr.team, weapon: pr.weapon, x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy, damage: pr.damage })),
      config: w.config,
      render: this.view?.counts ?? null,
      viewport: this.view?.viewport ?? null,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.detach();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onWindowBlur);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    sounds.stopLoop();
    if (this.app) {
      this.app.ticker.remove(this.tick);
      this.app.ticker.stop();
      this.view?.destroy();
      this.view = null;
      this.app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
      this.app = null;
    }
    this.store.clear();
  }
}
