import type { HudSnapshot } from '../game/engine/GameStore';
import { RoundButton, formatClock } from './ui';

/**
 * DOM HUD rendered by React from the low-frequency store snapshot. Doubles as the semantic
 * representation of the match state (score, time, health, phase) for assistive tech.
 */
export function Hud({ hud, onPause }: { hud: HudSnapshot; onPause: () => void }) {
  const frac = hud.maxHp > 0 ? Math.max(0, hud.hp / hud.maxHp) : 0;
  const color = frac > 0.5 ? 'green' : frac > 0.25 ? 'amber' : 'red';
  const warn = hud.phase === 'running' && hud.timeLeftSec <= 10;
  const phaseLabel = { loading: 'Loading', ready: 'Starting', running: 'In progress', paused: 'Paused', ended: 'Ended', error: 'Error' }[hud.phase];

  return (
    <section className="hud" aria-label="Battle status" data-testid="hud">
      <div className="hud-health">
        <span className="hud-heart" aria-hidden="true" />
        <div
          className="hud-bar"
          role="meter"
          aria-label="Ship health"
          aria-valuemin={0}
          aria-valuemax={hud.maxHp}
          aria-valuenow={hud.hp}
          aria-valuetext={`${hud.hp} of ${hud.maxHp}`}
          data-testid="hud-health"
        >
          <div className={`hud-bar-fill fill-${color}`} style={{ width: `${frac * 79}%` }} />
          <span className="hud-bar-text">
            {hud.hp} / {hud.maxHp}
          </span>
        </div>
      </div>
      <div className="hud-right">
        <div className="counter" data-testid="hud-score">
          <span className="counter-icon icon-score" aria-hidden="true" />
          <span className="sr-only">Score</span>
          <span className="counter-value">{hud.score}</span>
        </div>
        <div className={`counter ${warn ? 'counter-warn' : ''}`} role="timer" aria-live="off" data-testid="hud-time">
          <span className="counter-icon icon-time" aria-hidden="true" />
          <span className="sr-only">Time left</span>
          <span className="counter-value">{formatClock(hud.timeLeftSec)}</span>
        </div>
        <RoundButton
          icon="pause"
          label="Pause game"
          onClick={onPause}
          disabled={hud.phase !== 'running'}
          data-testid="pause-button"
          className="hud-pause"
        />
      </div>
      <p className="sr-only" data-testid="hud-phase">
        Match status: {phaseLabel}
      </p>
    </section>
  );
}
