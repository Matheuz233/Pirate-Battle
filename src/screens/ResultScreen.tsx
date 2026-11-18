import { useSyncExternalStore } from 'react';
import { navigate } from '../app/router';
import { useSubmissions } from '../api/submissions';
import { sounds } from '../game/audio/SoundManager';
import { lastResultStore, type SubmissionState } from '../storage/matches';
import { Button, Panel, Scene, ScreenHeading, END_REASON_LABEL, formatDuration } from '../components/ui';

const STATE_TEXT: Record<SubmissionState, string> = {
  pending: 'Waiting to save this battle…',
  sending: 'Saving this battle to the captain’s log…',
  saved: 'Battle saved to ranking and match history.',
  failed: 'This battle is not saved yet. It is kept on this device and will be retried.',
};

export function ResultScreen() {
  const last = useSyncExternalStore(lastResultStore.subscribe, lastResultStore.get);
  const { retry } = useSubmissions();

  if (!last) {
    return (
      <Scene>
        <Panel className="result-panel">
          <ScreenHeading>No battle yet</ScreenHeading>
          <p className="dialog-text">Play a battle to see your result here.</p>
          <div className="dialog-actions stacked">
            <Button onClick={() => navigate({ name: 'play' })}>Play</Button>
            <Button onClick={() => navigate({ name: 'menu' })}>Main Menu</Button>
          </div>
        </Panel>
      </Scene>
    );
  }

  const { submission: s, state, error } = last;
  return (
    <Scene>
      <Panel className="result-panel">
        <ScreenHeading>{s.endReason === 'time_up' ? 'Battle complete' : 'Ship destroyed'}</ScreenHeading>
        <p className="result-score" data-testid="result-score">
          <span className="sr-only">Score: </span>
          {s.score}
        </p>
        <dl className="result-meta">
          <div>
            <dt>Points</dt>
            <dd data-testid="result-points">{s.score}</dd>
          </div>
          <div>
            <dt>Time played</dt>
            <dd data-testid="result-duration">{formatDuration(s.durationMs)}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd data-testid="result-reason">{END_REASON_LABEL[s.endReason]}</dd>
          </div>
        </dl>
        <div className={`submission submission-${state}`} role="status" data-testid="submission-status" data-state={state}>
          <span className="submission-dot" aria-hidden="true" />
          <span>
            {STATE_TEXT[state]}
            {state === 'failed' && error ? ` (${error})` : ''}
          </span>
          {state === 'failed' && (
            <Button variant="secondary" size="sm" onClick={() => retry(s.matchId)} data-testid="submission-retry">
              Retry
            </Button>
          )}
        </div>
        <div className="dialog-actions stacked">
          <Button
            onClick={() => {
              sounds.unlock();
              navigate({ name: 'play' });
            }}
            data-testid="play-again"
          >
            Play Again
          </Button>
          <Button onClick={() => navigate({ name: 'menu' })} data-testid="result-menu">
            Main Menu
          </Button>
        </div>
      </Panel>
    </Scene>
  );
}
