import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import './styles/global.css';
import { App } from './app/App';

async function bootstrap() {
  if (import.meta.env.VITE_ENABLE_MOCKS !== 'false') {
    try {
      const { startMocks } = await import('./mocks/browser');
      await startMocks();
    } catch (err) {
      // The game must stay playable even if the mock backend cannot start.
      console.warn('[mocks] Mock API failed to start; ranking and history will be unavailable.', err);
    }
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
