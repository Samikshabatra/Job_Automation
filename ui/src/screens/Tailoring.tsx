import { useState } from 'react';
import { useApi } from '../lib/api';
import { ago } from '../lib/format';
import { Panel, Tabs, Empty, ErrorState, Skeleton, Button } from '../components/primitives';

interface TailorRun {
  id: number; job_id: number; company: string | null; title: string | null;
  original_json: string; tailored_json: string;
  ai_confidence: number | null; similarity: number | null;
  verdict: string | null; resume_path: string | null; created_at: string;
}

type View = 'tailored' | 'original';

export function Tailoring({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<View>('tailored');
  const { data, error, loading, reload } = useApi<TailorRun[]>('/api/tailoring');

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;

  const runs = data ?? [];
  const current = runs.find((r) => r.id === selected) ?? runs[0] ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Resume tailoring</h1>
        <p className="mt-1 text-xs text-ink-dim">
          Every tailoring pass the pipeline ran, with the anti-fabrication check that approved or rejected it.
        </p>
      </div>

      {runs.length === 0 ? (
        <div className="panel">
          <Empty
            title="No tailoring runs recorded"
            hint="A record is written each time the pipeline tailors your resume for a posting. Run discovery to produce one."
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <Panel eyebrow="History" title="Tailoring runs">
            <ul className="max-h-[34rem] overflow-y-auto">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r.id)}
                    className={`w-full border-b border-hairline px-4 py-3 text-left transition-colors last:border-0 ${
                      current?.id === r.id ? 'bg-violet-wash' : 'hover:bg-raised'
                    }`}
                  >
                    <div className="truncate text-xs font-medium text-ink">{r.company ?? 'Unknown company'}</div>
                    <div className="truncate text-[11px] text-ink-dim">{r.title ?? '--'}</div>
                    <div className="tabular mt-1 flex items-center gap-2 text-[10px] text-ink-faint">
                      <span>{ago(r.created_at)}</span>
                      {r.verdict && (
                        <span className={r.verdict === 'pass' ? 'text-good' : 'text-bad'}>{r.verdict}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {current && (
            <Panel
              eyebrow="Comparison"
              title={`${current.title ?? 'Resume'} at ${current.company ?? 'unknown'}`}
              action={
                <Button onClick={() => onOpenJob(current.job_id)}>Open job</Button>
              }
            >
              {/*
                No "AI confidence" tile: the tailoring step produces no such
                number, and a figure invented to fill a slot would be read as
                a measurement. Everything here is measured.
              */}
              <div className="grid grid-cols-2 gap-3 border-b border-hairline p-5 sm:grid-cols-4">
                <Metric
                  label="Similarity"
                  value={current.similarity?.toFixed(2) ?? '--'}
                  hint="1.00 means nothing was reworded"
                />
                <Metric
                  label="Bullets rewritten"
                  value={String(rewrittenCount(current.original_json, current.tailored_json))}
                  hint="Reworded from your own text"
                />
                <Metric
                  label="Fabrication check"
                  value={current.verdict === 'pass' ? 'Passed' : current.verdict === 'fail' ? 'Rejected' : '--'}
                />
                <Metric label="Resume rendered" value={current.resume_path ? 'Yes' : 'No'} />
              </div>

              {offendingOf(current.tailored_json).length > 0 && (
                <div className="border-b border-hairline p-5">
                  <div className="eyebrow mb-2 text-bad">Why this pass was rejected</div>
                  <ul className="space-y-1 text-xs text-bad">
                    {offendingOf(current.tailored_json).map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}

              <div className="px-5 pt-3">
                <Tabs<View>
                  active={view}
                  onChange={setView}
                  tabs={[
                    { key: 'tailored', label: 'Side by side' },
                    { key: 'original', label: 'Raw JSON' },
                  ]}
                />
              </div>

              {view === 'original' ? (
                <pre className="max-h-[26rem] overflow-auto p-5 font-mono text-[11px] leading-relaxed text-ink-faint">
                  {safePretty(current.tailored_json)}
                </pre>
              ) : (
                <SideBySide original={current.original_json} tailored={current.tailored_json} />
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function SideBySide({ original, tailored }: { original: string; tailored: string }) {
  const o = flatten(original);
  const t = flatten(tailored);
  const before = new Set(o);

  return (
    <div className="grid max-h-[26rem] gap-4 overflow-y-auto p-5 md:grid-cols-2">
      <div>
        <div className="eyebrow mb-2">Original</div>
        <ul className="space-y-1.5 rounded-lg border border-hairline p-3 text-xs text-ink-faint">
          {o.length === 0 ? <li>Nothing recorded</li> : o.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      </div>
      <div>
        <div className="eyebrow mb-2">Tailored</div>
        <ul className="space-y-1.5 rounded-lg border border-violet/30 bg-violet-wash p-3 text-xs text-ink-dim">
          {t.length === 0 ? <li>Nothing recorded</li> : t.map((l, i) => (
            <li key={i} className={before.has(l) ? '' : 'text-violet'}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="tabular mt-0.5 text-sm font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-ink-faint">{hint}</div>}
    </div>
  );
}

/** What the anti-fabrication check objected to, stored alongside the pass. */
function offendingOf(tailoredJson: string): string[] {
  try {
    const v = JSON.parse(tailoredJson) as { offending?: unknown };
    return Array.isArray(v.offending) ? v.offending.map(String) : [];
  } catch {
    return [];
  }
}

/** Tailored bullets whose text differs from the bullet they came from. */
function rewrittenCount(originalJson: string, tailoredJson: string): number {
  try {
    const source = new Map<string, string>();
    for (const e of (JSON.parse(originalJson).entries ?? []) as { bullets?: { id: string; text: string }[] }[]) {
      for (const b of e.bullets ?? []) source.set(b.id, b.text);
    }
    const tailored = (JSON.parse(tailoredJson).entries ?? []) as { bullets?: { id: string; text: string }[] }[];
    return tailored
      .flatMap((e) => e.bullets ?? [])
      .filter((b) => source.get(b.id) !== undefined && source.get(b.id) !== b.text)
      .length;
  } catch {
    return 0;
  }
}

function safePretty(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

/** Flattens whatever shape the tailor stored into displayable lines. */
function flatten(json: string): string[] {
  try {
    const v = JSON.parse(json);
    const out: string[] = [];
    const walk = (node: unknown) => {
      if (typeof node === 'string') { if (node.trim()) out.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(v);
    return out;
  } catch {
    return [];
  }
}
