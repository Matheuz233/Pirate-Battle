import { useQuery } from '@tanstack/react-query';
import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { navigate, type LogTab } from '../app/router';
import { errorMessage, historyPageQuery, rankingBucketsQuery, rankingPageQuery } from '../api/queries';
import type { MatchConfigSnapshot } from '../api/contracts';
import { DEFAULT_GAME_CONFIG } from '../game/config/gameConfig';
import { optionsStore } from '../storage/options';
import { playerStore } from '../storage/player';
import { outboxStore } from '../storage/matches';
import { Button, Panel, RoundButton, Scene, ScreenHeading, END_REASON_LABEL, formatDate, formatDuration } from '../components/ui';

const TABS: { id: LogTab; label: string }[] = [
  { id: 'ranking', label: 'Ranking' },
  { id: 'history', label: 'Match History' },
];

export function LogScreen({ tab }: { tab: LogTab }) {
  const tabRefs = useRef<Record<LogTab, HTMLButtonElement | null>>({ ranking: null, history: null });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (idx + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const t = TABS[next]!;
    navigate({ name: 'log', tab: t.id }, { replace: true });
    requestAnimationFrame(() => tabRefs.current[t.id]?.focus());
  };

  return (
    <Scene>
      <Panel wide className="log-panel">
        <ScreenHeading>Captain&apos;s Log</ScreenHeading>
        <div className="tabs" role="tablist" aria-label="Captain's log" onKeyDown={onKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => navigate({ name: 'log', tab: t.id }, { replace: true })}
              data-testid={`tab-${t.id}`}
            >
              <span className="btn-label">{t.label}</span>
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel" tabIndex={0}>
          {tab === 'ranking' ? <RankingPanel /> : <HistoryPanel />}
        </div>
        <div className="log-footer">
          <Button onClick={() => navigate({ name: 'menu' })} data-testid="log-menu">
            Main Menu
          </Button>
        </div>
      </Panel>
    </Scene>
  );
}

function bucketLabel(b: MatchConfigSnapshot): string {
  return `${b.sessionTimeSec} second battles · ${b.spawnIntervalSec} second spawn interval`;
}

function bucketValue(b: MatchConfigSnapshot): string {
  return `${b.sessionTimeSec}|${b.spawnIntervalSec}|${b.configVersion}`;
}

function QueryState({
  isPending,
  isError,
  error,
  isEmpty,
  emptyText,
  onRetry,
  isFetching,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
  onRetry: () => void;
  isFetching: boolean;
  children: ReactNode;
}) {
  if (isPending) {
    return (
      <div className="state state-loading" role="status" data-testid="log-loading">
        <span className="spinner" aria-hidden="true" /> Loading…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="state state-error" role="alert" data-testid="log-error">
        <p>Could not load this tab. {errorMessage(error)}</p>
        <Button variant="secondary" size="sm" onClick={onRetry} disabled={isFetching} data-testid="log-retry">
          {isFetching ? 'Retrying…' : 'Try again'}
        </Button>
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="state state-empty" role="status" data-testid="log-empty">
        {emptyText}
      </div>
    );
  }
  return <>{children}</>;
}

function Pager({
  page,
  totalPages,
  onPage,
  busy,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  busy: boolean;
}) {
  return (
    <nav className="pager" aria-label="Pagination">
      <RoundButton icon="turn_left" label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} data-testid="page-prev" />
      <span className="pager-label" aria-live="polite" data-testid="page-label">
        Page {page} of {totalPages}
        {busy ? ' · updating' : ''}
      </span>
      <RoundButton icon="turn_right" label="Next page" disabled={page >= totalPages} onClick={() => onPage(page + 1)} data-testid="page-next" />
    </nav>
  );
}

function RankingPanel() {
  const options = useSyncExternalStore(optionsStore.subscribe, optionsStore.get);
  const player = useSyncExternalStore(playerStore.subscribe, playerStore.get);
  const mine: MatchConfigSnapshot = {
    sessionTimeSec: options.sessionTimeSec,
    spawnIntervalSec: options.spawnIntervalSec,
    configVersion: DEFAULT_GAME_CONFIG.version,
  };
  const [bucket, setBucket] = useState<MatchConfigSnapshot>(mine);
  const [page, setPage] = useState(1);
  const buckets = useQuery(rankingBucketsQuery());
  const q = useQuery(rankingPageQuery(bucket, page));

  const options_ = [...(buckets.data ?? [])];
  if (!options_.some((b) => bucketValue(b) === bucketValue(mine))) options_.unshift({ ...mine, matches: 0 });
  if (!options_.some((b) => bucketValue(b) === bucketValue(bucket))) options_.unshift({ ...bucket, matches: 0 });

  const data = q.data;
  const totalPages = data?.totalPages ?? 1;
  const updating = q.isFetching && !q.isPending;

  return (
    <div className="log-content" data-testid="ranking-panel" aria-busy={q.isFetching}>
      <div className="log-toolbar">
        <label htmlFor="bucket" className="sr-only">
          Battle settings
        </label>
        <select
          id="bucket"
          className="bucket-select"
          value={bucketValue(bucket)}
          onChange={(e) => {
            const [s, i, v] = e.target.value.split('|').map(Number);
            setBucket({ sessionTimeSec: s!, spawnIntervalSec: i!, configVersion: v! });
            setPage(1);
          }}
          data-testid="bucket-select"
        >
          {options_.map((b) => (
            <option key={bucketValue(b)} value={bucketValue(b)}>
              {bucketLabel(b)}
              {bucketValue(b) === bucketValue(mine) ? ' (your settings)' : ''}
            </option>
          ))}
        </select>
        {updating && (
          <span className="refreshing" role="status" data-testid="log-refreshing">
            Updating…
          </span>
        )}
      </div>
      <QueryState
        isPending={q.isPending}
        isError={q.isError && !data}
        error={q.error}
        isEmpty={!!data && data.totalItems === 0}
        emptyText="No battles recorded with these settings yet. Be the first!"
        onRetry={() => void q.refetch()}
        isFetching={q.isFetching}
      >
        {q.isError && data && (
          <p className="inline-error" role="alert">
            Showing saved data — refresh failed: {errorMessage(q.error)}
          </p>
        )}
        <table className={`log-table ${q.isPlaceholderData ? 'is-stale' : ''}`} data-testid="ranking-table">
          <caption className="sr-only">Ranking — {bucketLabel(bucket)}</caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Captain</th>
              <th scope="col">Points</th>
              <th scope="col">Played</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((r) => {
              const isMe = r.playerId === player.playerId;
              return (
                <tr key={r.matchId} className={isMe ? 'is-me' : ''} data-testid="ranking-row" data-match-id={r.matchId}>
                  <td className="col-rank">{String(r.rank).padStart(2, '0')}</td>
                  <td>
                    {r.rank === 1 && <span className="star" aria-hidden="true" />}
                    {r.playerName}
                    {isMe && <span className="you-badge">You</span>}
                  </td>
                  <td className="col-score">{r.score}</td>
                  <td className="col-date">{formatDate(r.playedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pager page={page} totalPages={totalPages} onPage={setPage} busy={q.isPlaceholderData} />
      </QueryState>
    </div>
  );
}

function HistoryPanel() {
  const player = useSyncExternalStore(playerStore.subscribe, playerStore.get);
  const outbox = useSyncExternalStore(outboxStore.subscribe, outboxStore.get);
  const [page, setPage] = useState(1);
  const q = useQuery(historyPageQuery(player.playerId, page));
  const data = q.data;
  const updating = q.isFetching && !q.isPending;

  return (
    <div className="log-content" data-testid="history-panel" aria-busy={q.isFetching}>
      <div className="log-toolbar">
        <p className="log-subtitle">Battles of {player.playerName}</p>
        {updating && (
          <span className="refreshing" role="status" data-testid="log-refreshing">
            Updating…
          </span>
        )}
      </div>
      {outbox.length > 0 && (
        <p className="notice" data-testid="history-pending">
          {outbox.length} battle{outbox.length === 1 ? '' : 's'} waiting to be saved — they will appear here once confirmed.
        </p>
      )}
      <QueryState
        isPending={q.isPending}
        isError={q.isError && !data}
        error={q.error}
        isEmpty={!!data && data.totalItems === 0}
        emptyText="No battles recorded yet. Finish a battle to fill your log."
        onRetry={() => void q.refetch()}
        isFetching={q.isFetching}
      >
        {q.isError && data && (
          <p className="inline-error" role="alert">
            Showing saved data — refresh failed: {errorMessage(q.error)}
          </p>
        )}
        <table className={`log-table ${q.isPlaceholderData ? 'is-stale' : ''}`} data-testid="history-table">
          <caption className="sr-only">Match history</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Points</th>
              <th scope="col">Duration</th>
              <th scope="col">Reason</th>
              <th scope="col">Settings</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((m) => (
              <tr key={m.matchId} data-testid="history-row" data-match-id={m.matchId}>
                <td className="col-date">{formatDate(m.playedAt)}</td>
                <td className="col-score">{m.score}</td>
                <td>{formatDuration(m.durationMs)}</td>
                <td>{END_REASON_LABEL[m.endReason]}</td>
                <td className="col-date">
                  {m.config.sessionTimeSec}s · {m.config.spawnIntervalSec}s
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager page={page} totalPages={data?.totalPages ?? 1} onPage={setPage} busy={q.isPlaceholderData} />
      </QueryState>
    </div>
  );
}
