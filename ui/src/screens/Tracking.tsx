import { useApi } from '../lib/api';
import { ago } from '../lib/format';
import { Panel, StatTile, StatusPill, Empty, ErrorState, Skeleton } from '../components/primitives';

interface TrackingData {
  stats: { total: number; positive: number; interviews: number; offers: number };
  recent: {
    id: number; application_id: number | null; company: string | null; title: string | null;
    subject: string | null; classified_as: string | null; confidence: number; received_at: string;
  }[];
}

export function Tracking({ onSync, running }: { onSync: () => void; running: boolean }) {
  const { data, error, loading, reload } = useApi<TrackingData>('/api/tracking');

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tracking</h1>
          <p className="mt-1 text-xs text-ink-dim">
            What employers wrote back, read from your inbox and matched to the application it belongs to.
          </p>
        </div>
        <button
          onClick={onSync}
          disabled={running}
          className="rounded-lg border border-hairline bg-raised px-3 py-1.5 text-xs text-ink-dim transition-colors hover:text-ink disabled:opacity-40"
        >
          {running ? 'Sync running' : 'Sync inbox'}
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Replies received" value={data.stats.total} tone="violet" />
        <StatTile label="Moved forward" value={data.stats.positive} tone="info" />
        <StatTile label="Interviews" value={data.stats.interviews} tone="warn" />
        <StatTile label="Offers" value={data.stats.offers} tone="good" />
      </div>

      <Panel eyebrow="Inbox" title="Recent responses">
        {data.recent.length === 0 ? (
          <Empty
            title="No employer mail matched yet"
            hint="Connect Gmail and run a sync. Only mail that matches an application you actually sent is recorded."
          />
        ) : (
          <ul>
            {data.recent.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{e.subject ?? '(no subject)'}</div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {e.company ? `${e.company}${e.title ? ` — ${e.title}` : ''}` : 'Not matched to an application'}
                  </div>
                </div>
                {e.classified_as && <StatusPill status={e.classified_as} />}
                <span className="tabular w-16 text-right text-[11px] text-ink-faint">{ago(e.received_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
