import { useState } from 'react';
import { api, ApiError, useApi } from '../lib/api';
import { ago, duration } from '../lib/format';
import { Panel, StatTile, Button, Empty, ErrorState, Skeleton } from '../components/primitives';

interface AgentData {
  stats: { successRate: number; applicationsToday: number; avgSecondsPerApp: number | null; totalRuns: number };
  current: { job_id: number | null; company: string | null; step: string; detail: string | null } | null;
  recent: {
    id: number; job_id: number | null; company: string | null; title: string | null;
    step: string; detail: string | null; confidence: number | null; created_at: string;
  }[];
  runs: { id: number; kind: string; started_at: string; finished_at: string | null; exit_code: number | null; dry_run: number }[];
  runner: { running: boolean; kind: string | null; runId: number | null };
  dryRun: boolean;
}

export function ApplyAgent({ running, logLines }: {
  running: boolean;
  logLines: { line: string; stream: 'out' | 'err'; id: number }[];
}) {
  const { data, error, loading, reload } = useApi<AgentData>('/api/agent');
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  const start = async (confirm: boolean) => {
    setNotice(null);
    try {
      await api.post('/api/runs', { kind: 'agent', confirm });
      setConfirming(false);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'live_submission_requires_confirmation') {
        setConfirming(true);
        return;
      }
      setNotice(err instanceof Error ? err.message : 'Could not start the agent');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Apply agent</h1>
          <p className="mt-1 text-xs text-ink-dim">
            Opens each queued posting in a browser, fills the form, and submits only when the guards allow it.
          </p>
        </div>
        <Button variant={data.dryRun ? 'primary' : 'danger'} onClick={() => start(false)} disabled={running}>
          {running ? 'Agent running' : data.dryRun ? 'Start agent (dry run)' : 'Start agent (live)'}
        </Button>
      </div>

      {notice && (
        <p className="rounded-lg border border-bad/30 bg-bad/10 px-4 py-2.5 text-xs text-bad">{notice}</p>
      )}

      {/*
        The live-submission gate. The server refuses an unconfirmed live run and
        the UI has to ask in plain words, because this is the one button in the
        product that reaches a real employer.
      */}
      {confirming && (
        <div className="rounded-xl border border-bad/40 bg-bad/5 p-5">
          <h2 className="text-sm font-semibold text-bad">This run will send real applications</h2>
          <p className="mt-1.5 max-w-2xl text-xs text-ink-dim">
            Dry run is switched off in your settings, so the agent will submit forms to real employers on your
            behalf. It still obeys the daily cap, the per-company limit and the duplicate check, and it stops at
            any posting it is not confident about.
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" onClick={() => start(true)}>Yes, submit real applications</Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Mode" value={data.dryRun ? 'Dry run' : 'Live'} tone={data.dryRun ? 'good' : 'warn'} />
        <StatTile label="Clean runs" value={`${data.stats.successRate}%`} tone="info" />
        <StatTile label="Applications today" value={data.stats.applicationsToday} tone="violet" />
        <StatTile label="Average run length" value={duration(data.stats.avgSecondsPerApp)} tone="warn" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Now" title="Current activity">
          {running ? (
            <div className="space-y-3 p-5">
              {data.current ? (
                <>
                  <p className="text-sm text-ink">
                    {data.current.step}
                    {data.current.company ? ` at ${data.current.company}` : ''}
                  </p>
                  {data.current.detail && <p className="text-xs text-ink-dim">{data.current.detail}</p>}
                </>
              ) : (
                <p className="text-sm text-ink-dim">Agent started. Waiting for the first step.</p>
              )}
              <div className="h-40 overflow-y-auto rounded-lg border border-hairline bg-ground p-3 font-mono text-[11px]">
                {logLines.length === 0
                  ? <span className="text-ink-faint">No output yet...</span>
                  : logLines.map((l) => (
                      <div key={l.id} className={`log-line ${l.stream === 'err' ? 'text-bad' : 'text-ink-dim'}`}>
                        {l.line}
                      </div>
                    ))}
              </div>
            </div>
          ) : (
            <Empty
              title="The agent is idle"
              hint="Start a run to work through the queue. In dry run it fills every form and submits none."
            />
          )}
        </Panel>

        <Panel eyebrow="History" title="Recent steps">
          {data.recent.length === 0 ? (
            <Empty
              title="No agent steps recorded"
              hint="Each field the agent maps and every submission decision is logged here once it runs."
            />
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {data.recent.map((e) => (
                <li key={e.id} className="flex items-baseline gap-3 border-b border-hairline px-5 py-2.5 text-xs last:border-0">
                  <span className="tabular shrink-0 text-ink-faint">{ago(e.created_at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink-dim">{e.step}</span>
                    {e.detail && <span className="text-ink-faint"> — {e.detail}</span>}
                  </span>
                  {e.confidence !== null && (
                    <span className="tabular shrink-0 text-[11px] text-ink-faint">
                      {Math.round(e.confidence * 100)}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel eyebrow="Runs" title="Run history">
        {data.runs.length === 0 ? (
          <Empty title="No runs yet" hint="Every pipeline run started from this dashboard is recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead>
                <tr className="eyebrow border-b border-hairline">
                  <th className="px-5 py-2.5 font-normal">Run</th>
                  <th className="px-3 py-2.5 font-normal">Kind</th>
                  <th className="px-3 py-2.5 font-normal">Mode</th>
                  <th className="px-3 py-2.5 font-normal">Result</th>
                  <th className="px-5 py-2.5 text-right font-normal">Started</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-b border-hairline/60 last:border-0">
                    <td className="tabular px-5 py-2.5 text-ink-faint">#{r.id}</td>
                    <td className="px-3 py-2.5 text-ink-dim">{r.kind}</td>
                    <td className="px-3 py-2.5 text-ink-faint">{r.dry_run ? 'Dry run' : 'Live'}</td>
                    <td className="px-3 py-2.5">
                      {r.finished_at === null ? <span className="text-violet">Running</span>
                        : r.exit_code === 0 ? <span className="text-good">Finished</span>
                        : <span className="text-bad">Exit {r.exit_code ?? '--'}</span>}
                    </td>
                    <td className="tabular px-5 py-2.5 text-right text-[11px] text-ink-faint">{ago(r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
