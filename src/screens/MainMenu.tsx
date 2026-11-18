import { useSyncExternalStore } from 'react';
import { navigate } from '../app/router';
import { sounds } from '../game/audio/SoundManager';
import { CONTROL_HELP } from '../game/input/InputController';
import { outboxStore, lastResultStore } from '../storage/matches';
import { useSubmissions } from '../api/submissions';
import { Button, Panel, Scene, END_REASON_LABEL, formatDuration } from '../components/ui';

const ASSETS = `${import.meta.env.BASE_URL}assets`;

export function MainMenu() {
  const outbox = useSyncExternalStore(outboxStore.subscribe, outboxStore.get);
  const last = useSyncExternalStore(lastResultStore.subscribe, lastResultStore.get);
  const { retry } = useSubmissions();
  const pending = outbox.filter((e) => e.state !== 'sending').length;
  const sending = outbox.some((e) => e.state === 'sending');

  const play = () => {
    sounds.unlock();
    navigate({ name: 'play' });
  };

  return (
    <Scene>
      <Panel className="menu-panel">
        <h1 className="sr-only" tabIndex={-1} data-screen-heading>
          Pirate Battle — main menu
        </h1>
        <img className="title-art" src={`${ASSETS}/png/default/ui/menu/title_pirate_battle.png`} alt="Pirate Battle" />
        <p className="tagline">Set sail. Take command.</p>
        <nav className="menu-actions" aria-label="Main menu">
          <Button onClick={play} data-testid="play-button">
            Play
          </Button>
          <Button onClick={() => navigate({ name: 'options' })} data-testid="options-button">
            Options
          </Button>
        </nav>

        <details className="controls-help">
          <summary>How to play</summary>
          <p>Sink enemy ships before the clock runs out. Each ship you sink is worth 1 point. Chasers ram you; Shooters fire from range.</p>
          <table className="controls-table">
            <caption className="sr-only">Keyboard controls</caption>
            <tbody>
              {CONTROL_HELP.map((c) => (
                <tr key={c.action}>
                  <th scope="row">
                    <kbd>{c.keys}</kbd>
                  </th>
                  <td>{c.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>On touch screens use the on-screen buttons: steering on the left, cannons on the right. Landscape orientation is required on phones.</p>
        </details>

        {last && (
          <p className="last-result" data-testid="menu-last-result">
            Last battle: <strong>{last.submission.score} pts</strong> · {formatDuration(last.submission.durationMs)} ·{' '}
            {END_REASON_LABEL[last.submission.endReason]}
          </p>
        )}

        {outbox.length > 0 && (
          <div className="notice" role="status" data-testid="pending-banner">
            <span>
              {sending ? 'Uploading battle record…' : `${pending} battle record${pending === 1 ? '' : 's'} waiting to be saved.`}
            </span>
            {!sending && (
              <Button variant="secondary" size="sm" onClick={() => retry()}>
                Retry now
              </Button>
            )}
          </div>
        )}

        <nav className="menu-tabs" aria-label="Captain's log">
          <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'log', tab: 'ranking' })} data-testid="ranking-tab-button">
            Ranking
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate({ name: 'log', tab: 'history' })} data-testid="history-tab-button">
            Match History
          </Button>
        </nav>
      </Panel>
    </Scene>
  );
}
