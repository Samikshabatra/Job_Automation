import type { ReactNode } from 'react';
import { scoreTone, STATUS_TONE, STATUS_LABEL, titleCase } from '../lib/format';

const TONE_CLASS: Record<string, string> = {
  good: 'text-good border-good/30 bg-good/10',
  warn: 'text-warn border-warn/30 bg-warn/10',
  bad: 'text-bad border-bad/30 bg-bad/10',
  info: 'text-info border-info/30 bg-info/10',
  muted: 'text-ink-faint border-hairline bg-raised',
  none: 'text-ink-faint border-hairline bg-raised',
};

export function Panel({ title, eyebrow, action, children, className = '' }: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || eyebrow || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div>
            {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, delta, tone = 'violet' }: {
  label: string;
  value: number | string;
  delta?: string | null;
  tone?: 'violet' | 'good' | 'warn' | 'info';
}) {
  const ring: Record<string, string> = {
    violet: 'text-violet bg-violet-wash',
    good: 'text-good bg-good/10',
    warn: 'text-warn bg-warn/10',
    info: 'text-info bg-info/10',
  };
  return (
    <div className="panel px-5 py-4">
      <div className="flex items-center gap-3">
        <span className={`grid h-9 w-9 place-items-center rounded-lg ${ring[tone]}`}>
          <span className="h-2 w-2 rounded-full bg-current" />
        </span>
        <div className="min-w-0">
          <div className="tabular text-2xl leading-none font-bold text-ink">{value}</div>
          <div className="mt-1.5 truncate text-xs text-ink-dim">{label}</div>
        </div>
      </div>
      {delta && <div className="tabular mt-3 text-[11px] text-good">{delta}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? 'muted';
  const label = STATUS_LABEL[status] ?? titleCase(status);
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}>
      {label}
    </span>
  );
}

/** A score reads as a measurement, so it is always mono and always banded. */
export function Score({ value, size = 'sm' }: { value: number | null | undefined; size?: 'sm' | 'lg' }) {
  const tone = scoreTone(value);
  if (value === null || value === undefined) {
    return <span className="tabular text-ink-faint">--</span>;
  }
  if (size === 'lg') {
    return (
      <div className={`grid h-16 w-16 place-items-center rounded-full border-2 ${TONE_CLASS[tone]}`}>
        <span className="tabular text-xl font-bold leading-none">{Math.round(value)}</span>
      </div>
    );
  }
  return (
    <span className={`tabular inline-flex min-w-9 justify-center rounded border px-1.5 py-0.5 text-[11px] font-bold ${TONE_CLASS[tone]}`}>
      {Math.round(value)}
    </span>
  );
}

export function Bar({ pct, label, value }: { pct: number; label: string; value?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-xs text-ink-dim">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <span
          className="block h-full rounded-full bg-violet transition-[width] duration-500"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
      <span className="tabular w-10 shrink-0 text-right text-[11px] text-ink-dim">
        {value ?? `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

export function Button({ children, onClick, variant = 'ghost', disabled, type = 'button', title }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const styles = {
    primary: 'bg-violet text-white hover:bg-violet-dim border-transparent',
    ghost: 'bg-raised text-ink-dim hover:text-ink border-hairline hover:border-hairline-strong',
    danger: 'bg-bad/10 text-bad hover:bg-bad/20 border-bad/30',
  }[variant];

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="eyebrow">{label}</span>
      {children}
    </label>
  );
}

const CONTROL = 'rounded-lg border border-hairline bg-raised px-3 py-1.5 text-xs text-ink '
  + 'placeholder:text-ink-faint focus:border-violet focus:outline-none';

export function Select({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={CONTROL}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function SearchInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${CONTROL} w-full`}
    />
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; label: string; count?: number }[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-hairline">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
            active === t.key
              ? 'border-violet text-ink'
              : 'border-transparent text-ink-faint hover:text-ink-dim'
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="tabular ml-1.5 text-ink-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Empty states say what to do next. This pipeline legitimately starts with
 * nothing applied to and nothing tracked, so these screens are the normal
 * first experience, not an error -- they must read as an invitation.
 */
export function Empty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="h-8 w-8 rounded-lg border border-dashed border-hairline-strong" />
      <p className="mt-1 text-sm font-medium text-ink-dim">{title}</p>
      <p className="max-w-sm text-xs text-ink-faint">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <p className="text-sm font-medium text-bad">Could not load this screen</p>
      <p className="max-w-md font-mono text-xs text-ink-faint">{message}</p>
      {onRetry && <Button onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-7 animate-pulse rounded bg-raised" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}
