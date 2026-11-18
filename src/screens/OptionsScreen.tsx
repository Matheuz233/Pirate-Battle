import { useId, useState, useSyncExternalStore, type FormEvent } from 'react';
import { navigate } from '../app/router';
import { SESSION_LIMITS, SPAWN_LIMITS } from '../game/config/gameConfig';
import { DEFAULT_OPTIONS, optionsStore, validateOptions, type OptionsErrors } from '../storage/options';
import { playerStore } from '../storage/player';
import { Button, Panel, RoundButton, Scene, ScreenHeading } from '../components/ui';
import { useAnnouncer } from '../components/Announcer';
import { NetworkLab } from '../components/NetworkLab';

function Stepper({
  id,
  label,
  hint,
  value,
  onChange,
  step,
  min,
  max,
  unit,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  step: number;
  min: number;
  max: number;
  unit: string;
  error?: string;
}) {
  const num = Number(value);
  const bump = (dir: 1 | -1) => {
    const base = Number.isFinite(num) ? num : min;
    const next = Math.min(max, Math.max(min, Math.round((base + dir * step) / step) * step));
    onChange(String(Number(next.toFixed(2))));
  };
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="stepper">
        <RoundButton icon="minus" label={`Decrease ${label.toLowerCase()}`} onClick={() => bump(-1)} disabled={num <= min} />
        <div className="stepper-input">
          <input
            id={id}
            name={id}
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          />
          <span aria-hidden="true">{unit}</span>
        </div>
        <RoundButton icon="plus" label={`Increase ${label.toLowerCase()}`} onClick={() => bump(1)} disabled={num >= max} />
      </div>
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function OptionsScreen() {
  const saved = useSyncExternalStore(optionsStore.subscribe, optionsStore.get);
  const player = useSyncExternalStore(playerStore.subscribe, playerStore.get);
  const [session, setSession] = useState(String(saved.sessionTimeSec));
  const [spawn, setSpawn] = useState(String(saved.spawnIntervalSec));
  const [sound, setSound] = useState(saved.soundEnabled);
  const [name, setName] = useState(player.playerName);
  const [errors, setErrors] = useState<OptionsErrors & { name?: string }>({});
  const [status, setStatus] = useState<string>('');
  const [labOpen, setLabOpen] = useState(false);
  const { announce } = useAnnouncer();
  const soundId = useId();

  const dirty =
    session !== String(saved.sessionTimeSec) ||
    spawn !== String(saved.spawnIntervalSec) ||
    sound !== saved.soundEnabled ||
    name.trim() !== player.playerName;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateOptions({ sessionTimeSec: session, spawnIntervalSec: spawn, soundEnabled: sound });
    const trimmed = name.trim();
    const nameError = trimmed.length < 2 || trimmed.length > 20 ? 'Captain name must have 2 to 20 characters.' : undefined;
    if (!result.ok || nameError) {
      setErrors({ ...(result.ok ? {} : result.errors), name: nameError });
      setStatus('');
      announce('Options not saved. Please fix the highlighted fields.', 'assertive');
      const firstInvalid = !result.ok && result.errors.sessionTimeSec ? 'sessionTimeSec' : !result.ok && result.errors.spawnIntervalSec ? 'spawnIntervalSec' : 'playerName';
      document.getElementById(firstInvalid)?.focus();
      return;
    }
    setErrors({});
    optionsStore.set(result.value);
    playerStore.set({ ...player, playerName: trimmed });
    setSession(String(result.value.sessionTimeSec));
    setSpawn(String(result.value.spawnIntervalSec));
    setStatus('Options saved. They apply to your next battle.');
    announce('Options saved.');
  };

  const resetDefaults = () => {
    setSession(String(DEFAULT_OPTIONS.sessionTimeSec));
    setSpawn(String(DEFAULT_OPTIONS.spawnIntervalSec));
    setSound(DEFAULT_OPTIONS.soundEnabled);
    setErrors({});
    setStatus('Defaults restored — press Save to keep them.');
  };

  return (
    <Scene>
      <Panel className="options-panel">
        <ScreenHeading>Options</ScreenHeading>
        <form onSubmit={onSubmit} noValidate aria-describedby="options-status" data-testid="options-form">
          <Stepper
            id="sessionTimeSec"
            label="Game session time"
            hint={`${SESSION_LIMITS.min}–${SESSION_LIMITS.max} seconds of active play.`}
            value={session}
            onChange={(v) => {
              setSession(v);
              setStatus('');
            }}
            step={10}
            min={SESSION_LIMITS.min}
            max={SESSION_LIMITS.max}
            unit="s"
            error={errors.sessionTimeSec}
          />
          <Stepper
            id="spawnIntervalSec"
            label="Enemy spawn time"
            hint={`${SPAWN_LIMITS.min}–${SPAWN_LIMITS.max} seconds between enemy spawns, in ${SPAWN_LIMITS.step} s steps.`}
            value={spawn}
            onChange={(v) => {
              setSpawn(v);
              setStatus('');
            }}
            step={SPAWN_LIMITS.step}
            min={SPAWN_LIMITS.min}
            max={SPAWN_LIMITS.max}
            unit="s"
            error={errors.spawnIntervalSec}
          />
          <div className="field">
            <label htmlFor="playerName" className="field-label">
              Captain name
            </label>
            <input
              id="playerName"
              className="text-input"
              value={name}
              maxLength={24}
              autoComplete="nickname"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'playerName-error' : undefined}
            />
            {errors.name && (
              <p id="playerName-error" className="field-error" role="alert">
                {errors.name}
              </p>
            )}
          </div>
          <div className="field field-inline">
            <input id={soundId} type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
            <label htmlFor={soundId}>Sound effects</label>
          </div>
          <p id="options-status" className="form-status" role="status" data-testid="options-status">
            {status || (dirty ? 'You have unsaved changes.' : '')}
          </p>
          <div className="options-actions">
            <Button type="submit" data-testid="save-options">
              Save
            </Button>
            <Button variant="secondary" size="sm" onClick={resetDefaults}>
              Defaults
            </Button>
          </div>
        </form>
        <div className="options-footer">
          <Button onClick={() => navigate({ name: 'menu' })} data-testid="back-to-menu">
            Main Menu
          </Button>
          <button type="button" className="link-btn" onClick={() => setLabOpen(true)} data-testid="open-network-lab">
            Network lab (mock API scenarios)
          </button>
        </div>
      </Panel>
      {labOpen && <NetworkLab onClose={() => setLabOpen(false)} />}
    </Scene>
  );
}
