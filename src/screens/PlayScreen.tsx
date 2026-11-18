import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { navigate } from '../app/router';
import { testFlags } from '../app/testMode';
import { useSubmissions } from '../api/submissions';
import type { MatchSubmission } from '../api/contracts';
import { loadGameTextures, type AtlasDensity, type GameTextures } from '../game/assets/gameAssets';
import { createMatchConfig } from '../game/config/gameConfig';
import { randomSeed } from '../game/core/rng';
import { GameEngine } from '../game/engine/GameEngine';
import { GameStore, initialHud, type HudSnapshot } from '../game/engine/GameStore';
import { optionsStore } from '../storage/options';
import { playerStore, uuid } from '../storage/player';
import { Button, Dialog, Scene, Panel } from '../components/ui';
import { useAnnouncer } from '../components/Announcer';
import { Hud } from '../components/Hud';
import { TouchControls } from '../components/TouchControls';

type LoadState =
  | { state: 'loading'; progress: number }
  | { state: 'error'; message: string }
  | { state: 'ready'; textures: GameTextures };

export function PlayScreen() {
  // Changing the key creates a brand-new match (engine, world, timers, entities).
  const [matchKey, setMatchKey] = useState(0);
  return <Match key={matchKey} onRestart={() => setMatchKey((k) => k + 1)} />;
}

function Match({ onRestart }: { onRestart: () => void }) {
  const density: AtlasDensity = (testFlags.resolution ?? window.devicePixelRatio ?? 1) > 1 ? 2 : 1;
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<LoadState>({ state: 'loading', progress: 0 });

  useEffect(() => {
    let cancelled = false;
    loadGameTextures(density, (p) => {
      if (!cancelled) setLoad((s) => (s.state === 'loading' ? { state: 'loading', progress: Math.max(s.progress, p) } : s));
    })
      .then((textures) => {
        if (!cancelled) setLoad({ state: 'ready', textures });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ state: 'error', message: err instanceof Error ? err.message : 'Failed to load assets.' });
      });
    return () => {
      cancelled = true;
    };
  }, [density, attempt]);

  if (load.state === 'ready') return <GameView textures={load.textures} onRestart={onRestart} />;

  return (
    <Scene dim>
      <Panel className="loading-panel">
        {load.state === 'loading' ? (
          <>
            <h1 className="screen-title" tabIndex={-1} data-screen-heading>
              Preparing the fleet…
            </h1>
            <div
              className="progress"
              role="progressbar"
              aria-label="Loading game assets"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(load.progress * 100)}
              data-testid="asset-progress"
            >
              <div className="progress-fill" style={{ width: `${Math.round(load.progress * 100)}%` }} />
            </div>
            <p className="dialog-text">{Math.round(load.progress * 100)}%</p>
          </>
        ) : (
          <>
            <h1 className="screen-title" tabIndex={-1} data-screen-heading>
              Could not load the battle
            </h1>
            <p className="field-error" role="alert" data-testid="asset-error">
              {load.message} Check your connection and try again.
            </p>
            <div className="dialog-actions">
              <Button
                onClick={() => {
                  setLoad({ state: 'loading', progress: 0 });
                  setAttempt((a) => a + 1);
                }}
                data-testid="asset-retry"
              >
                Retry
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'menu' })}>
                Main Menu
              </Button>
            </div>
          </>
        )}
      </Panel>
    </Scene>
  );
}

const fallbackStore = new GameStore(initialHud(100, 120));

function usePortraitBlock(): boolean {
  const query = '(orientation: portrait) and (pointer: coarse)';
  const [portrait, setPortrait] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setPortrait(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return portrait;
}

function GameView({ textures, onRestart }: { textures: GameTextures; onRestart: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const matchIdRef = useRef<string>(uuid());
  const recordedRef = useRef(false);
  const { record } = useSubmissions();
  const { announce } = useAnnouncer();
  const portrait = usePortraitBlock();

  // Config snapshot taken once when the match starts; later option changes apply to new matches.
  const config = useMemo(() => createMatchConfig(optionsStore.get(), testFlags.overrides), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const eng = new GameEngine({
      container: host,
      config,
      seed: testFlags.seed ?? randomSeed(),
      textures,
      manualClock: testFlags.manualClock,
      resolution: testFlags.resolution,
    });
    let cancelled = false;
    eng
      .mount()
      .then(() => {
        if (cancelled) return;
        setEngine(eng);
        eng.start();
        host.focus({ preventScroll: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[game] Failed to start the renderer', err);
        setFatal('Your browser could not start the game renderer (WebGL).');
      });
    if (testFlags.enabled) {
      (window as unknown as Record<string, unknown>).__PIRATE__ = {
        getState: () => eng.getDebugState(),
        advance: (ms: number) => eng.advance(ms),
        setManualClock: (m: boolean) => eng.setManualClock(m),
        perf: () => eng.perf.sample(),
        resetPerf: () => eng.perf.reset(),
        matchId: () => matchIdRef.current,
      };
    }
    return () => {
      cancelled = true;
      eng.destroy();
      if (testFlags.enabled) delete (window as unknown as Record<string, unknown>).__PIRATE__;
    };
  }, [config, textures]);

  const store = engine?.store ?? fallbackStore;
  const hud: HudSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Discrete accessibility announcements (never per frame).
  useEffect(() => {
    if (hud.phase === 'running') announce('Battle in progress.');
    if (hud.phase === 'paused') announce('Game paused.');
  }, [hud.phase, announce]);
  useEffect(() => {
    if (hud.phase === 'running' && [60, 30, 10].includes(hud.timeLeftSec)) announce(`${hud.timeLeftSec} seconds left.`);
  }, [hud.timeLeftSec, hud.phase, announce]);

  // Orientation lock for phones: portrait pauses the match.
  useEffect(() => {
    if (portrait) engine?.pause('orientation');
  }, [portrait, engine]);

  // Match completion: persist + submit exactly once, then show the result.
  useEffect(() => {
    if (hud.phase !== 'ended' || !hud.summary || recordedRef.current) return;
    recordedRef.current = true;
    const player = playerStore.get();
    const submission: MatchSubmission = {
      matchId: matchIdRef.current,
      playerId: player.playerId,
      playerName: player.playerName,
      playedAt: new Date().toISOString(),
      score: hud.summary.score,
      durationMs: hud.summary.durationMs,
      endReason: hud.summary.endReason,
      config: { sessionTimeSec: config.session.durationSec, spawnIntervalSec: config.spawn.intervalSec, configVersion: config.version },
    };
    record(submission);
    announce(hud.summary.endReason === 'time_up' ? 'Time up! Battle complete.' : 'Your ship was destroyed.', 'assertive');
    const t = window.setTimeout(() => navigate({ name: 'result' }), testFlags.resultDelayMs);
    return () => window.clearTimeout(t);
  }, [hud.phase, hud.summary, record, announce, config]);

  // If the effect above was cleaned up before navigating (Strict Mode), still navigate.
  useEffect(() => {
    if (hud.phase !== 'ended') return;
    const t = window.setTimeout(() => navigate({ name: 'result' }), testFlags.resultDelayMs + 50);
    return () => window.clearTimeout(t);
  }, [hud.phase]);

  if (fatal) {
    return (
      <Scene dim>
        <Panel>
          <h1 className="screen-title" tabIndex={-1} data-screen-heading>
            Renderer unavailable
          </h1>
          <p className="field-error" role="alert">
            {fatal}
          </p>
          <Button onClick={() => navigate({ name: 'menu' })}>Main Menu</Button>
        </Panel>
      </Scene>
    );
  }

  return (
    <main className="play-screen" data-phase={hud.phase} data-testid="play-screen">
      <h1 className="sr-only" tabIndex={-1} data-screen-heading>
        Battle
      </h1>
      <div
        ref={hostRef}
        className="arena-host"
        tabIndex={0}
        role="application"
        aria-roledescription="game"
        aria-label="Battle arena. W or up arrow sails forward, A and D turn, Space fires the bow cannon, Q and E fire broadsides, Escape pauses."
        data-testid="arena"
      />
      <Hud hud={hud} onPause={() => engine?.pause('manual')} />
      {engine && <TouchControls engine={engine} disabled={hud.phase !== 'running'} />}
      <p className="keys-hint" aria-hidden="true">
        W/↑ sail · A/D turn · Space bow · Q/E broadsides · Esc pause
      </p>
      {hud.phase === 'paused' && !portrait && (
        <PauseDialog
          reason={hud.pauseReason}
          onResume={() => engine?.resume()}
          onRestart={onRestart}
          onMenu={() => navigate({ name: 'menu' })}
        />
      )}
      {portrait && (
        <div className="rotate-overlay" role="alertdialog" aria-labelledby="rotate-title">
          <p id="rotate-title">Rotate your device to landscape to keep playing.</p>
        </div>
      )}
      {hud.phase === 'ended' && hud.summary && (
        <div className="end-banner" aria-hidden="true">
          {hud.summary.endReason === 'time_up' ? 'Time up!' : 'Ship destroyed!'}
        </div>
      )}
    </main>
  );
}

function PauseDialog({
  reason,
  onResume,
  onRestart,
  onMenu,
}: {
  reason: HudSnapshot['pauseReason'];
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const text =
    reason === 'focus' || reason === 'hidden'
      ? 'Paused because the game lost focus. Ready when you are.'
      : reason === 'orientation'
        ? 'Paused while the device was in portrait mode.'
        : 'Ready when you are.';
  return (
    <Dialog labelledBy="pause-title" describedBy="pause-desc" onEscape={onResume} testId="pause-dialog">
      {/* Focus lands on the title, not on Resume, so a gameplay key (e.g. Space) pressed
          right after an automatic pause cannot resume the match by accident. */}
      <h2 id="pause-title" className="dialog-title" tabIndex={-1} data-autofocus>
        Paused
      </h2>
      <p id="pause-desc" className="dialog-text">
        {text}
      </p>
      <div className="dialog-actions stacked">
        <Button onClick={onResume} data-testid="resume-button">
          Resume
        </Button>
        <Button onClick={onRestart} data-testid="restart-button">
          Restart
        </Button>
        <Button onClick={onMenu} data-testid="pause-menu-button">
          Main Menu
        </Button>
      </div>
    </Dialog>
  );
}
