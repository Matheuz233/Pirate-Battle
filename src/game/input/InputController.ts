import type { InputFrame } from '../sim/types';

export type GameAction = keyof InputFrame;

/** Keyboard bindings (KeyboardEvent.code → action). Shown in the UI from this single source. */
export const KEY_BINDINGS: Readonly<Record<string, GameAction>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyA: 'turnLeft',
  ArrowLeft: 'turnLeft',
  KeyD: 'turnRight',
  ArrowRight: 'turnRight',
  Space: 'fireFront',
  KeyJ: 'fireFront',
  KeyQ: 'fireLeft',
  KeyE: 'fireRight',
};

export const PAUSE_KEYS: readonly string[] = ['Escape', 'KeyP'];

export const CONTROL_HELP: readonly { keys: string; action: string }[] = [
  { keys: 'W / ↑', action: 'Sail forward' },
  { keys: 'A / ←', action: 'Turn left' },
  { keys: 'D / →', action: 'Turn right' },
  { keys: 'Space / J', action: 'Fire bow cannon' },
  { keys: 'Q', action: 'Port broadside (left)' },
  { keys: 'E', action: 'Starboard broadside (right)' },
  { keys: 'Esc / P', action: 'Pause' },
];

const ACTIONS: readonly GameAction[] = ['forward', 'turnLeft', 'turnRight', 'fireFront', 'fireLeft', 'fireRight'];

/**
 * Collects keyboard and touch input and exposes it as one `InputFrame` per simulation step.
 *
 * - Listeners are attached only while gameplay is active (`attach`/`detach`), so menu
 *   keyboard navigation is never captured.
 * - Presses are latched: a key tapped between two simulation steps still registers once.
 * - Multiple sources (several keys, several touch pointers) can hold the same action.
 */
export class InputController {
  private readonly held = new Map<GameAction, Set<string>>();
  private readonly latched = new Set<GameAction>();
  private enabled = false;
  private attached = false;
  private readonly frame: InputFrame = {
    forward: false,
    turnLeft: false,
    turnRight: false,
    fireFront: false,
    fireLeft: false,
    fireRight: false,
  };

  constructor(
    private readonly target: Window,
    private readonly onPauseKey: () => void,
  ) {
    for (const a of ACTIONS) this.held.set(a, new Set());
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.reset();
  }

  /** When disabled (paused, ended), gameplay keys are ignored and nothing accumulates. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    for (const set of this.held.values()) set.clear();
    this.latched.clear();
  }

  /** Touch / pointer API used by the on-screen controls. */
  press(action: GameAction, source: string): void {
    if (!this.enabled) return;
    const set = this.held.get(action);
    if (!set) return;
    if (!set.has(source)) this.latched.add(action);
    set.add(source);
  }

  release(action: GameAction, source: string): void {
    this.held.get(action)?.delete(source);
  }

  /** Returns the input for one simulation step and clears latched taps. */
  consume(): InputFrame {
    const f = this.frame;
    for (const a of ACTIONS) {
      f[a] = this.enabled && ((this.held.get(a)?.size ?? 0) > 0 || this.latched.has(a));
    }
    this.latched.clear();
    return f;
  }

  isHeld(action: GameAction): boolean {
    return (this.held.get(action)?.size ?? 0) > 0;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (PAUSE_KEYS.includes(e.code)) {
      if (this.enabled && !e.repeat) {
        e.preventDefault();
        this.onPauseKey();
      }
      return;
    }
    const action = KEY_BINDINGS[e.code];
    if (!action || !this.enabled) return;
    e.preventDefault();
    if (e.repeat) return;
    this.press(action, `key:${e.code}`);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const action = KEY_BINDINGS[e.code];
    if (!action) return;
    this.release(action, `key:${e.code}`);
  };

  private readonly onBlur = (): void => this.reset();
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}
