/** Versioned localStorage keys used by the app. */
export const STORAGE_KEYS = {
  options: 'pb.options.v1',
  player: 'pb.player.v1',
  lastResult: 'pb.lastResult.v1',
  outbox: 'pb.outbox.v1',
  mockDb: 'pb.mock.db.v1',
  mockScenario: 'pb.mock.scenario.v1',
} as const;

export function readJson<T>(key: string, validate: (v: unknown) => v is T): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type Listener = () => void;

/**
 * A localStorage-backed value with a subscribe API for `useSyncExternalStore`.
 * Also reacts to `storage` events, so several tabs stay consistent.
 */
export class PersistentStore<T> {
  private value: T;
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly key: string,
    private readonly validate: (v: unknown) => v is T,
    private readonly fallback: () => T,
  ) {
    this.value = readJson(key, validate) ?? fallback();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === this.key) this.reload();
      });
    }
  }

  get = (): T => this.value;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  set(next: T | ((prev: T) => T)): void {
    this.value = typeof next === 'function' ? (next as (prev: T) => T)(this.value) : next;
    writeJson(this.key, this.value);
    this.listeners.forEach((l) => l());
  }

  reload(): void {
    this.value = readJson(this.key, this.validate) ?? this.fallback();
    this.listeners.forEach((l) => l());
  }

  reset(): void {
    removeKey(this.key);
    this.reload();
  }
}
