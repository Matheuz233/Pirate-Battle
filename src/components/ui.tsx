import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { sounds } from '../game/audio/SoundManager';

type Variant = 'primary' | 'secondary';

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  onClick,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' }) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className}`}
      onClick={(e) => {
        sounds.play('ui_click', { volume: 0.5 });
        onClick?.(e);
      }}
      {...rest}
    >
      <span className="btn-label">{children}</span>
    </button>
  );
}

export type IconName =
  | 'turn_left'
  | 'turn_right'
  | 'forward'
  | 'fire_front'
  | 'fire_left'
  | 'fire_right'
  | 'pause'
  | 'play'
  | 'plus'
  | 'minus'
  | 'home'
  | 'close'
  | 'restart'
  | 'settings';

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <span aria-hidden="true" className={`icon icon-${name} ${className}`} />;
}

export function RoundButton({
  icon,
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className={`round-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Panel({ children, className = '', wide = false }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={`panel ${wide ? 'panel-wide' : ''} ${className}`}>{children}</div>;
}

export function Scene({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <main className={`scene ${dim ? 'scene-dim' : ''}`}>
      {children}
      <img className="brand" src={`${import.meta.env.BASE_URL}assets/logo_jungle_gaming.svg`} alt="" aria-hidden="true" />
    </main>
  );
}

export function ScreenHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h1 className="screen-title" tabIndex={-1} data-screen-heading id={id}>
      {children}
    </h1>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: focus moves inside on open, Tab is trapped, Escape triggers
 * `onEscape`, and focus returns to the previously focused element on close.
 */
export function Dialog({
  labelledBy,
  describedBy,
  children,
  onEscape,
  className = '',
  testId,
}: {
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
  onEscape?: () => void;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    sounds.play('ui_open', { volume: 0.4 });

    const onKey = (e: KeyboardEvent) => {
      if (!root) return;
      if (e.key === 'Escape' && onEscapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (!root.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={`panel dialog ${className}`}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  );
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  return formatClock(Math.floor(ms / 1000));
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${day} ${month} · ${time}`;
}

export const END_REASON_LABEL = { time_up: 'Time up', destroyed: 'Ship destroyed' } as const;
