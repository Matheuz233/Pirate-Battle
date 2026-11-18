import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createQueryClient } from '../api/queries';
import { SubmissionProvider } from '../api/submissions';
import { sounds } from '../game/audio/SoundManager';
import { optionsStore } from '../storage/options';
import { AnnouncerProvider } from '../components/Announcer';
import { MainMenu } from '../screens/MainMenu';
import { OptionsScreen } from '../screens/OptionsScreen';
import { PlayScreen } from '../screens/PlayScreen';
import { ResultScreen } from '../screens/ResultScreen';
import { LogScreen } from '../screens/LogScreen';
import { normalizeInitialRoute, useRoute } from './router';
import { testFlags } from './testMode';

normalizeInitialRoute();

export function App() {
  const [queryClient] = useState(createQueryClient);
  const route = useRoute();
  const options = useSyncExternalStore(optionsStore.subscribe, optionsStore.get);

  useEffect(() => {
    sounds.setEnabled(options.soundEnabled && !testFlags.enabled);
  }, [options.soundEnabled]);

  // Move focus to the new screen's heading for keyboard and screen-reader users.
  useEffect(() => {
    const h = document.querySelector<HTMLElement>('[data-screen-heading]');
    h?.focus({ preventScroll: true });
  }, [route]);

  return (
    <QueryClientProvider client={queryClient}>
      <SubmissionProvider>
        <AnnouncerProvider>
          <div className={`app route-${route.name}`}>
            {route.name === 'menu' && <MainMenu />}
            {route.name === 'options' && <OptionsScreen />}
            {route.name === 'play' && <PlayScreen />}
            {route.name === 'result' && <ResultScreen />}
            {route.name === 'log' && <LogScreen tab={route.tab} />}
          </div>
        </AnnouncerProvider>
      </SubmissionProvider>
    </QueryClientProvider>
  );
}
