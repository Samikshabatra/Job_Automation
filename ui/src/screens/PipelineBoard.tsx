import { useApi } from '../lib/api';
import { ago } from '../lib/format';
import { Score, Empty, ErrorState, Skeleton } from '../components/primitives';

interface Card {
  id: number; company: string; title: string;
  match_score: number | null; status: string; first_seen_at: string;
}
interface Column { key: string; label: string; count: number; cards: Card[] }

export function PipelineBoard({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const { data, error, loading, reload } = useApi<Column[]>('/api/pipeline');

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  const empty = data.every((c) => c.count === 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Pipeline</h1>
        <p className="mt-1 text-xs text-ink-dim">
          Every job still moving through the pipeline. Filtered, expired and closed postings are not shown.
        </p>
      </div>

      {empty ? (
        <div className="panel">
          <Empty
            title="Nothing in the pipeline"
            hint="Jobs appear here as they are discovered and scored. Start a discovery run from Overview."
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {data.map((col) => (
            <section key={col.key} className="flex min-w-0 flex-col">
              <header className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[13px] font-semibold text-ink">{col.label}</h2>
                <span className="tabular text-xs text-ink-faint">{col.count.toLocaleString()}</span>
              </header>

              <div className="space-y-2">
                {col.cards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-hairline px-3 py-6 text-center text-[11px] text-ink-faint">
                    Empty
                  </div>
                ) : (
                  col.cards.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onOpenJob(c.id)}
                      className="panel w-full px-3 py-3 text-left transition-colors hover:border-hairline-strong hover:bg-raised"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-xs font-medium text-ink">{c.company}</span>
                        <Score value={c.match_score} />
                      </div>
                      <div className="mt-1 truncate text-[11px] text-ink-dim">{c.title}</div>
                      <div className="tabular mt-2 text-[10px] text-ink-faint">{ago(c.first_seen_at)}</div>
                    </button>
                  ))
                )}

                {col.count > col.cards.length && (
                  <p className="tabular px-1 pt-1 text-[10px] text-ink-faint">
                    + {(col.count - col.cards.length).toLocaleString()} more
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
