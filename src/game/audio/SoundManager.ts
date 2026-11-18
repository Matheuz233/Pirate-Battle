import { ASSET_BASE } from '../assets/gameAssets';

export type SoundName =
  | 'cannon_fire_1'
  | 'cannon_fire_2'
  | 'cannon_fire_3'
  | 'cannon_broadside'
  | 'cannonball_water_hit_1'
  | 'cannonball_water_hit_2'
  | 'ship_wood_hit_1'
  | 'ship_wood_hit_2'
  | 'ship_explosion_1'
  | 'ship_explosion_2'
  | 'ship_collision'
  | 'ship_sinking'
  | 'score_point'
  | 'health_low'
  | 'time_warning'
  | 'game_start'
  | 'game_over'
  | 'game_complete'
  | 'game_pause'
  | 'game_resume'
  | 'ui_click'
  | 'ui_hover'
  | 'ui_open'
  | 'ui_close'
  | 'ui_back';

type LoopName = 'ocean_ambience_loop';

/**
 * Minimal Web Audio sound player. Sounds are optional: decoding or playback failures are
 * swallowed so audio can never block the menus or the match.
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private loop: { name: LoopName; source: AudioBufferSourceNode } | null = null;
  private enabled = true;
  private lastPlayed = new Map<string, number>();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.6 : 0;
  }

  /** Must be called from a user gesture (e.g. the Play button) to unlock audio. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.6 : 0;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.ctx = null;
    }
  }

  preload(names: readonly (SoundName | LoopName)[]): void {
    names.forEach((n) => void this.buffer(n));
  }

  play(name: SoundName, opts: { volume?: number; rate?: number; throttleMs?: number } = {}): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const now = performance.now();
    const throttle = opts.throttleMs ?? 40;
    if (now - (this.lastPlayed.get(name) ?? -Infinity) < throttle) return;
    this.lastPlayed.set(name, now);
    const ctx = this.ctx;
    const master = this.master;
    void this.buffer(name).then((buf) => {
      if (!buf || ctx.state === 'closed') return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = opts.rate ?? 1;
        const gain = ctx.createGain();
        gain.gain.value = opts.volume ?? 1;
        src.connect(gain).connect(master);
        src.start();
      } catch {
        /* ignore */
      }
    });
  }

  startLoop(name: LoopName, volume = 0.35): void {
    if (!this.ctx || !this.master || this.loop?.name === name) return;
    this.stopLoop();
    const ctx = this.ctx;
    const master = this.master;
    void this.buffer(name).then((buf) => {
      if (!buf || this.loop || ctx.state === 'closed') return;
      try {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        src.connect(gain).connect(master);
        src.start();
        this.loop = { name, source: src };
      } catch {
        /* ignore */
      }
    });
  }

  stopLoop(): void {
    if (!this.loop) return;
    try {
      this.loop.source.stop();
      this.loop.source.disconnect();
    } catch {
      /* ignore */
    }
    this.loop = null;
  }

  suspend(): void {
    if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  private buffer(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (!p) {
      p = fetch(`${ASSET_BASE}/sounds/${name}.wav`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((data) => {
          const ctx = this.ctx ?? new OfflineAudioContext(1, 1, 44100);
          return ctx.decodeAudioData(data);
        })
        // Failures are cached as "no sound" so a missing file is requested only once.
        .catch(() => null);
      this.buffers.set(name, p);
    }
    return p;
  }
}

export const sounds = new SoundManager();
