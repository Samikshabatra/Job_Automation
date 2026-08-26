import { useState } from 'react';
import { useApi } from '../lib/api';
import { Panel, Score, Button, Empty, ErrorState, Skeleton } from '../components/primitives';

interface ReviewCard {
  id: number; company: string; title: string; url: string;
  ats_platform: string | null; match_score: number | null;
  location: string | null; resume_path: string | null; status: string;
  blocked: string | null;
}

interface ReviewData { queue: ReviewCard[]; command: string; note: string }

export function ReviewQueue({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const { data, error, loading, reload } = useApi<ReviewData>('/api/review');
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  const current = data.queue.find((c) => c.id === selected) ?? data.queue[0] ?? null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Review queue</h1>
        <p className="mt-1 max-w-3xl text-xs text-ink-dim">
          Postings whose forms ask questions no profile can answer. The agent pre-fills everything it can and
          hands you the keyboard for the rest.
        </p>
      </div>

      {/*
        Honest about a real constraint: the reviewer waits at a terminal prompt
        and checks stdin.isatty, so it cannot be launched from a web request. A
        button that silently did nothing would be worse than this instruction.
      */}
      <Panel eyebrow="How to run this" title="Finish these in a terminal">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <code className="rounded-lg border border-hairline bg-ground px-3 py-2 font-mono text-xs text-violet">
            {data.command}
          </code>
          <Button onClick={() => copy(data.command)}>{copied ? 'Copied' : 'Copy command'}</Button>
          <p className="max-w-md text-[11px] text-ink-faint">{data.note}</p>
        </div>
      </Panel>

      {data.queue.length === 0 ? (
        <div className="panel">
          <Empty
            title="Nothing waiting for review"
            hint="Jobs arrive here after they have been tailored. Run discovery to fill the queue."
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
          <Panel eyebrow={`${data.queue.length} waiting`} title="Queue">
            <ul className="max-h-[32rem] overflow-y-auto">
              {data.queue.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setSelected(c.id)}
                    className={`flex w-full items-start gap-3 border-b border-hairline px-4 py-3 text-left transition-colors last:border-0 ${
                      current?.id === c.id ? 'bg-violet-wash' : 'hover:bg-raised'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ink">{c.company}</div>
                      <div className="truncate text-[11px] text-ink-dim">{c.title}</div>
                      {c.blocked && <div className="mt-1 text-[10px] text-warn">{c.blocked}</div>}
                    </div>
                    <Score value={c.match_score} />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {current && (
            <Panel
              eyebrow={current.ats_platform ?? 'Application'}
              title={`${current.title} at ${current.company}`}
              action={<Button onClick={() => onOpenJob(current.id)}>Open job</Button>}
            >
              <div className="space-y-5 p-5">
                {current.blocked ? (
                  <p className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-xs text-warn">
                    The guards would stop this one: {current.blocked}. It stays in the queue but the reviewer
                    will skip it.
                  </p>
                ) : (
                  <p className="rounded-lg border border-good/30 bg-good/10 px-4 py-2.5 text-xs text-good">
                    Clear to open. The guards allow this posting right now.
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Detail label="Location" value={current.location ?? 'Not stated'} />
                  <Detail label="Match score" value={current.match_score === null ? '--' : String(Math.round(current.match_score))} />
                  <Detail label="Pipeline status" value={current.status} />
                  <Detail label="Tailored resume" value={current.resume_path ? 'Ready' : 'Not rendered'} />
                  <Detail label="Job id" value={`#${current.id}`} />
                  <Detail label="Platform" value={current.ats_platform ?? 'Unknown'} />
                </dl>

                {current.resume_path && (
                  <div>
                    <div className="eyebrow mb-1.5">Resume the agent will attach</div>
                    <code className="block truncate rounded-lg border border-hairline bg-ground px-3 py-2 font-mono text-[11px] text-ink-faint">
                      {current.resume_path}
                    </code>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
                  <a href={current.url} target="_blank" rel="noreferrer">
                    <Button variant="primary">Open the posting</Button>
                  </a>
                  <Button onClick={() => copy(`npm run review ${current.id}`)}>
                    Copy command for this job
                  </Button>
                </div>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-ink-dim">{value}</dd>
    </div>
  );
}
