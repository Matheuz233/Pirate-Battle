import { setupWorker } from 'msw/browser';
import { handlers, resetHandlerState } from './handlers';
import { resetDb } from './db';
import { DEFAULT_SCENARIO, applyScenarioFromUrl, writeScenario } from './scenarios';

/**
 * Starts the MSW service worker. Mocks run in every build (dev, tests and the published
 * demo) because the ranking/history backend is simulated by design.
 */
export async function startMocks(): Promise<void> {
  applyScenarioFromUrl(window.location.search);
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: 'bypass',
    quiet: true,
  });
}

/** Restores the initial mock state: default scenario and no confirmed records. */
export function resetMockState(): void {
  resetDb();
  resetHandlerState();
  writeScenario(DEFAULT_SCENARIO);
}
