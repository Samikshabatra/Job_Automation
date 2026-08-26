/** How long ago, in the shortest form that is still unambiguous. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '--';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '--';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '--';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '--' : new Date(t).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function duration(seconds: number | null): string {
  if (seconds === null) return '--';
  if (seconds < 90) return `${seconds}s`;
  return `${(seconds / 60).toFixed(1)} min`;
}

/**
 * Score bands. The cut points are the ones the pipeline itself uses: 50 is the
 * configured threshold below which a job is never applied to, so the colour
 * change happens exactly where the behaviour changes.
 */
export function scoreTone(score: number | null | undefined): 'good' | 'warn' | 'bad' | 'none' {
  if (score === null || score === undefined) return 'none';
  if (score >= 75) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

export const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'muted'> = {
  new: 'info',
  scored: 'info',
  tailored: 'warn',
  queued: 'warn',
  deferred: 'warn',
  held: 'warn',
  submitted: 'good',
  failed: 'bad',
  skipped: 'muted',
  stale: 'muted',
  closed: 'muted',

  awaiting: 'muted',
  acknowledged: 'info',
  screening: 'warn',
  interview: 'good',
  offer: 'good',
  rejected: 'bad',
};

/** Human labels for the pipeline's internal status vocabulary. */
export const STATUS_LABEL: Record<string, string> = {
  new: 'Discovered',
  scored: 'Scored',
  tailored: 'Tailored',
  queued: 'Queued',
  deferred: 'Deferred',
  held: 'Needs review',
  submitted: 'Applied',
  failed: 'Failed',
  skipped: 'Filtered out',
  stale: 'Expired',
  closed: 'Posting closed',
};

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
