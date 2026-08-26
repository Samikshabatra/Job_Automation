import { useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { ago } from '../lib/format';
import {
  Panel, Score, StatusPill, Button, SearchInput, Select, Empty, ErrorState, Skeleton,
} from '../components/primitives';

interface JobRow {
  id: number; title: string; company: string; source: string;
  location: string | null; match_score: number | null; status: string;
  first_seen_at: string; url: string; ats_platform: string | null;
}

interface Facets {
  sources: string[];
  locations: { value: string; count: number }[];
  statuses: string[];
}

const PAGE = 50;

export function Jobs({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [location, setLocation] = useState('');
  const [status, setStatus] = useState('');
  const [minScore, setMinScore] = useState('');
  const [sort, setSort] = useState('score');
  const [page, setPage] = useState(0);

  const facets = useApi<Facets>('/api/jobs/facets');

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (source) p.set('source', source);
    if (location) p.set('location', location);
    if (status) p.set('status', status);
    if (minScore) p.set('minScore', minScore);
    p.set('sort', sort);
    p.set('limit', String(PAGE));
    p.set('offset', String(page * PAGE));
    return `/api/jobs?${p}`;
  }, [q, source, location, status, minScore, sort, page]);

  const { data, error, loading, reload } = useApi<{ rows: JobRow[]; total: number }>(path);

  const reset = (fn: () => void) => { fn(); setPage(0); };

  const exportCsv = () => {
    if (!data) return;
    const header = ['id', 'title', 'company', 'source', 'location', 'score', 'status', 'url'];
    const csv = [
      header.join(','),
      ...data.rows.map((r) => [
        r.id, r.title, r.company, r.source, r.location ?? '', r.match_score ?? '', r.status, r.url,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `jobs-page-${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE) - 1);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Jobs discovered</h1>
          <p className="tabular mt-1 text-xs text-ink-dim">
            {total.toLocaleString()} job{total === 1 ? '' : 's'} from every source the pipeline polls
          </p>
        </div>
        <Button onClick={exportCsv} disabled={!data || data.rows.length === 0}>Export this page</Button>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-4">
          <div className="min-w-56 flex-1">
            <SearchInput value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Search title or company" />
          </div>
          <Select
            value={source} onChange={(v) => reset(() => setSource(v))} placeholder="All sources"
            options={(facets.data?.sources ?? []).map((s) => ({ value: s, label: s }))}
          />
          <Select
            value={location} onChange={(v) => reset(() => setLocation(v))} placeholder="All locations"
            options={(facets.data?.locations ?? []).map((l) => ({
              value: l.value, label: `${l.value} (${l.count})`,
            }))}
          />
          <Select
            value={status} onChange={(v) => reset(() => setStatus(v))} placeholder="All statuses"
            options={(facets.data?.statuses ?? []).map((s) => ({ value: s, label: s }))}
          />
          <Select
            value={minScore} onChange={(v) => reset(() => setMinScore(v))} placeholder="Any score"
            options={[
              { value: '75', label: 'Score 75+' },
              { value: '50', label: 'Score 50+' },
              { value: '25', label: 'Score 25+' },
            ]}
          />
          <Select
            value={sort} onChange={(v) => reset(() => setSort(v))} placeholder="Sort"
            options={[
              { value: 'score', label: 'Best match' },
              { value: 'recent', label: 'Newest' },
              { value: 'company', label: 'Company A-Z' },
            ]}
          />
        </div>

        {error ? <ErrorState message={error} onRetry={reload} />
          : loading && !data ? <Skeleton rows={10} />
          : data && data.rows.length === 0 ? (
            <Empty
              title="No jobs match these filters"
              hint="Widen the score or clear a filter. If the pipeline has never run, start a discovery run from Overview."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[13px]">
                <thead>
                  <tr className="eyebrow border-b border-hairline">
                    <th className="px-5 py-2.5 font-normal">Role</th>
                    <th className="px-3 py-2.5 font-normal">Company</th>
                    <th className="px-3 py-2.5 font-normal">Source</th>
                    <th className="px-3 py-2.5 font-normal">Location</th>
                    <th className="px-3 py-2.5 font-normal">Score</th>
                    <th className="px-3 py-2.5 font-normal">Status</th>
                    <th className="px-5 py-2.5 text-right font-normal">Found</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((j) => (
                    <tr
                      key={j.id}
                      onClick={() => onOpenJob(j.id)}
                      className="cursor-pointer border-b border-hairline/60 transition-colors last:border-0 hover:bg-raised"
                    >
                      <td className="max-w-72 truncate px-5 py-2.5 font-medium text-ink">{j.title}</td>
                      <td className="px-3 py-2.5 text-ink-dim">{j.company}</td>
                      <td className="px-3 py-2.5 text-ink-faint">{j.source}</td>
                      <td className="max-w-40 truncate px-3 py-2.5 text-ink-faint">{j.location ?? '--'}</td>
                      <td className="px-3 py-2.5"><Score value={j.match_score} /></td>
                      <td className="px-3 py-2.5"><StatusPill status={j.status} /></td>
                      <td className="tabular px-5 py-2.5 text-right text-[11px] text-ink-faint">
                        {ago(j.first_seen_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
            <span className="tabular text-[11px] text-ink-faint">
              {(page * PAGE + 1).toLocaleString()}-{Math.min((page + 1) * PAGE, total).toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
              <Button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage}>Next</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
