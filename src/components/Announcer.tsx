import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface AnnouncerApi {
  announce(message: string, politeness?: 'polite' | 'assertive'): void;
}

const Ctx = createContext<AnnouncerApi>({ announce: () => undefined });

/**
 * Single pair of live regions for the whole app. Components announce discrete events
 * (match started, paused, 30 s left, saved…) — never per-frame values.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const toggle = useRef(false);

  const announce = useCallback((message: string, politeness: 'polite' | 'assertive' = 'polite') => {
    // Alternate a zero-width suffix so repeating the same message is still announced.
    toggle.current = !toggle.current;
    const text = toggle.current ? message : `${message}\u200b`;
    if (politeness === 'assertive') setAssertive(text);
    else setPolite(text);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </Ctx.Provider>
  );
}

export function useAnnouncer(): AnnouncerApi {
  return useContext(Ctx);
}
