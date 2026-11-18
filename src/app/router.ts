import { useSyncExternalStore } from 'react';

export type LogTab = 'ranking' | 'history';

export type Route =
  | { name: 'menu' }
  | { name: 'options' }
  | { name: 'play' }
  | { name: 'result' }
  | { name: 'log'; tab: LogTab };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [a, b] = path.split('/');
  switch (a) {
    case 'options':
      return { name: 'options' };
    case 'play':
      return { name: 'play' };
    case 'result':
      return { name: 'result' };
    case 'log':
      return { name: 'log', tab: b === 'history' ? 'history' : 'ranking' };
    default:
      return { name: 'menu' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'menu':
      return '#/';
    case 'log':
      return `#/log/${route.tab}`;
    default:
      return `#/${route.name}`;
  }
}

let current = parseHash(window.location.hash);
const listeners = new Set<() => void>();

window.addEventListener('hashchange', () => {
  current = parseHash(window.location.hash);
  listeners.forEach((l) => l());
});

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeToHash(route);
  if (window.location.hash === hash) return;
  if (opts.replace) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    current = parseHash(hash);
    listeners.forEach((l) => l());
  } else {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * A reload must never resume a battle: if the app boots on the play route, the match is
 * considered abandoned and the player lands on the main menu.
 */
export function normalizeInitialRoute(): void {
  if (current.name === 'play') navigate({ name: 'menu' }, { replace: true });
}
