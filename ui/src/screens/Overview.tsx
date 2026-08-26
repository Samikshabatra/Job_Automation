import { useApi } from '../lib/api';
import { ago } from '../lib/format';
import { Panel, StatTile, Button, Empty, ErrorState, Skeleton } from '../components/primitives';
import { StageRail, type Stage } from '../components/StageRail';

interface OverviewData {
  stats: {
    discovered: number; discoveredToday: number;
    qualified: number; qualifiedToday: number;
    applied: number; appliedToday: number;
    responses: number; responsesToday: number;
  };
  pipeline: Stage[];
  activity: { at: string; text: string }[];
  brief: string[];
  lastRun: { kind: string; started_at: string; finished_at: string | null; exit_code: number | null } | null;
}

const delta = (n: number) => (n > 0 ? `+${n} today` : null);

export function Overview({ onRun, running, logLines }: {
  onRun: (kind: 'daily' | 'track') => void;
  running: boolean;
  logLines: { line: string; stream: 'out' | 'err'; id: number }[];
}) {
  const { data, error, loading, reload } = useApi<OverviewData>('/api/overview');

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  const s = data.stats;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="mt-1 text-xs text-ink-dim">
            {data.lastRun
              ? `Last ${data.lastRun.kind} run ${ago(data.lastRun.finished_at ?? data.lastRun.started_at)}`
              : 'No pipeline run recorded yet.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onRun('track')} disabled={running}>Sync inbox</Button>
          <Button variant="primary" onClick={() => onRun('daily')} disabled={running}>
            {running ? 'Run in progress' : 'Run discovery'}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Jobs discovered" value={s.discovered.toLocaleString()} delta={delta(s.discoveredToday)} tone="violet" />
        <StatTile label="Qualified matches" value={s.qualified.toLocaleString()} delta={delta(s.qualifiedToday)} tone="info" />
        <StatTile label="Applications sent" value={s.applied.toLocaleString()} delta={delta(s.appliedToday)} tone="warn" />
        <StatTile label="Employer responses" value={s.responses.toLocaleString()} delta={delta(s.responsesToday)} tone="good" />
      </div>

      <Panel eyebrow="Pipeline" title="Stages">
        <StageRail stages={data.pipeline} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Summary" title="What the pipeline found">
          <ul className="space-y-2.5 p-5">
            {data.brief.map((line) => (
              <li key={line} className="flex gap-2.5 text-[13px] text-ink-dim">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet" />
                {line}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel eyebrow="Live" title={running ? 'Run output' : 'Recent activity'}>
          {running ? (
            <div className="h-56 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
              {logLines.length === 0
                ? <span className="text-ink-faint">Waiting for output...</span>
                : logLines.map((l) => (
                    <div key={l.id} className={`log-line ${l.stream === 'err' ? 'text-bad' : 'text-ink-dim'}`}>
                      {l.line}
                    </div>
                  ))}
            </div>
          ) : data.activity.length === 0 ? (
            <Empty
              title="No agent activity yet"
              hint="Step-by-step agent output appears here once an apply run has recorded events."
            />
          ) : (
            <ul className="max-h-56 overflow-y-auto p-4">
              {data.activity.map((a, i) => (
                <li key={i} className="flex gap-3 border-b border-hairline py-2 text-xs last:border-0">
                  <span className="tabular shrink-0 text-ink-faint">{ago(a.at)}</span>
                  <span className="text-ink-dim">{a.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
