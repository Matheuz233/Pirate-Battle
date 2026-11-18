import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SCENARIOS, readScenario, writeScenario, type ScenarioName } from '../mocks/scenarios';
import { resetMockState } from '../mocks/browser';
import { outboxStore, lastResultStore } from '../storage/matches';
import { useSubmissions } from '../api/submissions';
import { Button, Dialog } from './ui';
import { useAnnouncer } from './Announcer';

/** Developer/demo panel to select reproducible mock-API scenarios and reset mock state. */
export function NetworkLab({ onClose }: { onClose: () => void }) {
  const initial = readScenario();
  const [name, setName] = useState<ScenarioName>(initial.name);
  const [seed, setSeed] = useState(String(initial.seed));
  const [latency, setLatency] = useState(String(initial.latencyScale));
  const queryClient = useQueryClient();
  const { retry } = useSubmissions();
  const { announce } = useAnnouncer();
  const [message, setMessage] = useState('');

  const apply = () => {
    writeScenario({ name, seed: Number(seed) || 0, latencyScale: Math.max(0, Number(latency) || 0) });
    void queryClient.invalidateQueries();
    retry();
    setMessage(`Scenario “${name}” active.`);
    announce(`Network scenario ${name} applied.`);
  };

  const reset = () => {
    resetMockState();
    outboxStore.reset();
    lastResultStore.reset();
    queryClient.clear();
    setName('success');
    setSeed('42');
    setLatency('1');
    setMessage('Mock state restored: success scenario, no saved battles, empty outbox.');
    announce('Mock state reset.');
  };

  return (
    <Dialog labelledBy="lab-title" describedBy="lab-desc" onEscape={onClose} className="lab-dialog" testId="network-lab">
      <h2 id="lab-title" className="dialog-title">
        Network lab
      </h2>
      <p id="lab-desc" className="dialog-text">
        Simulates the ranking and match-history API (MSW). The selection persists across refreshes.
      </p>
      <div className="field">
        <label htmlFor="scenario" className="field-label">
          Scenario
        </label>
        <select id="scenario" value={name} onChange={(e) => setName(e.target.value as ScenarioName)} data-testid="scenario-select">
          {(Object.keys(SCENARIOS) as ScenarioName[]).map((k) => (
            <option key={k} value={k}>
              {SCENARIOS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="lab-row">
        <div className="field">
          <label htmlFor="seed" className="field-label">
            Seed
          </label>
          <input id="seed" className="text-input" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="latency" className="field-label">
            Latency ×
          </label>
          <input id="latency" className="text-input" inputMode="decimal" value={latency} onChange={(e) => setLatency(e.target.value)} />
        </div>
      </div>
      <p className="form-status" role="status">
        {message}
      </p>
      <div className="dialog-actions">
        <Button onClick={apply} data-testid="apply-scenario">
          Apply
        </Button>
        <Button variant="secondary" size="sm" onClick={reset} data-testid="reset-mocks">
          Reset all
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose} data-autofocus>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
