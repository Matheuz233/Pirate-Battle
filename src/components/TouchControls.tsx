import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { GameEngine } from '../game/engine/GameEngine';
import type { GameAction } from '../game/input/InputController';
import { Icon, type IconName } from './ui';

const LEFT: { action: GameAction; icon: IconName; label: string; cls: string }[] = [
  { action: 'turnLeft', icon: 'turn_left', label: 'Turn left', cls: 'tc-turn-left' },
  { action: 'forward', icon: 'forward', label: 'Sail forward', cls: 'tc-forward' },
  { action: 'turnRight', icon: 'turn_right', label: 'Turn right', cls: 'tc-turn-right' },
];

const RIGHT: { action: GameAction; icon: IconName; label: string; cls: string }[] = [
  { action: 'fireLeft', icon: 'fire_left', label: 'Fire port broadside', cls: 'tc-fire-left' },
  { action: 'fireFront', icon: 'fire_front', label: 'Fire bow cannon', cls: 'tc-fire-front' },
  { action: 'fireRight', icon: 'fire_right', label: 'Fire starboard broadside', cls: 'tc-fire-right' },
];

/**
 * Multi-touch on-screen controls. Each button tracks its own pointers, so steering and
 * firing can be held simultaneously with different fingers.
 */
export function TouchControls({ engine, disabled }: { engine: GameEngine; disabled: boolean }) {
  const handlers = (action: GameAction) => {
    const source = (e: ReactPointerEvent) => `ptr:${e.pointerId}:${action}`;
    const up = (e: ReactPointerEvent<HTMLButtonElement>) => {
      engine.release(action, source(e));
      e.currentTarget.classList.remove('is-pressed');
    };
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        try {
          // Keeps the press alive if the finger slides slightly off the button.
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic or already-released pointers cannot be captured */
        }
        e.currentTarget.classList.add('is-pressed');
        engine.press(action, source(e));
      },
      onPointerUp: up,
      onPointerCancel: up,
      onLostPointerCapture: up,
      onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
    };
  };

  const render = (b: (typeof LEFT)[number]) => (
    <button
      key={b.action}
      type="button"
      tabIndex={-1}
      className={`touch-btn ${b.cls}`}
      aria-label={b.label}
      disabled={disabled}
      data-testid={`touch-${b.action}`}
      {...handlers(b.action)}
    >
      <Icon name={b.icon} />
    </button>
  );

  return (
    <div className="touch-controls" role="group" aria-label="On-screen controls">
      <div className="touch-cluster touch-left">{LEFT.map(render)}</div>
      <div className="touch-cluster touch-right">{RIGHT.map(render)}</div>
    </div>
  );
}
