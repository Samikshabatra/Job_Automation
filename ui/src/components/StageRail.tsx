export interface Stage {
  key: string;
  label: string;
  state: 'complete' | 'active' | 'waiting';
  count: number;
}

/**
 * The stage rail: the six things this pipeline does, in the order it does
 * them.
 *
 * The stages are numbered because they genuinely are a sequence -- a job
 * cannot be tailored before it is scored -- so the numerals carry real
 * information rather than decorating the panel. The rail is the one place
 * violet is allowed to move: the filled track shows how far the pipeline
 * actually got, which is the single question this screen exists to answer.
 */
export function StageRail({ stages, compact = false }: { stages: Stage[]; compact?: boolean }) {
  const lastComplete = stages.reduce((acc, s, i) => (s.state === 'complete' ? i : acc), -1);
  const progress = stages.length < 2 ? 0 : (Math.max(lastComplete, 0) / (stages.length - 1)) * 100;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5" aria-label="Pipeline stages">
        {stages.map((s) => (
          <span
            key={s.key}
            title={`${s.label}: ${s.count}`}
            className={`h-1 w-6 rounded-full ${
              s.state === 'complete' ? 'bg-violet'
                : s.state === 'active' ? 'animate-pulse bg-violet/60'
                : 'bg-hairline'
            }`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="px-5 py-6">
      <div className="relative">
        <div className="absolute top-3 right-3 left-3 h-px bg-hairline" aria-hidden />
        <div
          className="absolute top-3 left-3 h-px bg-violet transition-[width] duration-700"
          style={{ width: `calc(${progress}% - ${progress > 0 ? '0px' : '0px'})` }}
          aria-hidden
        />
        <ol className="relative flex justify-between">
          {stages.map((s, i) => (
            <li key={s.key} className="flex flex-1 flex-col items-center gap-2.5">
              <span
                className={`tabular grid h-6 w-6 place-items-center rounded-full border text-[10px] font-bold transition-colors ${
                  s.state === 'complete'
                    ? 'border-violet bg-violet text-white'
                    : s.state === 'active'
                      ? 'animate-pulse border-violet bg-ground text-violet'
                      : 'border-hairline bg-ground text-ink-faint'
                }`}
              >
                {i + 1}
              </span>
              <span className={`text-[11px] font-medium ${s.state === 'waiting' ? 'text-ink-faint' : 'text-ink'}`}>
                {s.label}
              </span>
              <span className="tabular text-[10px] text-ink-faint">
                {s.count.toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
