import { useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { ago, shortDate } from '../lib/format';
import {
  Panel, StatusPill, SearchInput, Select, Empty, ErrorState, Skeleton,
} from '../components/primitives';

interface AppRow {
  id: number; job_id: number; company: string; title: string;
  applied_at: string; method: string; outcome: string;
  last_email_at: string | null; latest_subject: string | null; url: string | null;
}

export function Applications({ onOpenJob }: { onOpenJob: (id: number) => void }) {
  const [q, setQ] = useState('');
  const [outcome, setOutcome] = useState('');

  const path = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (outcome) p.set('outcome', outcome);
    return `/api/applications?${p}`;
  }, [q, outcome]);

  const { data, error, loading, reload } = useApi<{ rows: AppRow[]; total: number; companies: string[] }>(path);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Applications</h1>
        <p className="tabular mt-1 text-xs text-ink-dim">
          {(data?.total ?? 0).toLocaleString()} application{data?.total === 1 ? '' : 's'} sent
        </p>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-4">
          <div className="min-w-56 flex-1">
            <SearchInput value={q} onChange={setQ} placeholder="Search company or role" />
          </div>
          <Select
            value={outcome} onChange={setOutcome} placeholder="All outcomes"
            options={[
              { value: 'awaiting', label: 'Awaiting reply' },
              { value: 'acknowledged', label: 'Acknowledged' },
              { value: 'screening', label: 'Screening' },
              { value: 'interview', label: 'Interview' },
              { value: 'offer', label: 'Offer' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        </div>

        {error ? <ErrorState message={error} onRetry={reload} />
          : loading && !data ? <Skeleton rows={8} />
          : data && data.rows.length === 0 ? (
            <Empty
              title="No applications yet"
              hint="The pipeline records an application here the moment one is actually submitted. Nothing is recorded during a dry run."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead>
                  <tr className="eyebrow border-b border-hairline">
                    <th className="px-5 py-2.5 font-normal">Role</th>
                    <th className="px-3 py-2.5 font-normal">Company</th>
                    <th className="px-3 py-2.5 font-normal">Sent via</th>
                    <th className="px-3 py-2.5 font-normal">Outcome</th>
                    <th className="px-3 py-2.5 font-normal">Latest reply</th>
                    <th className="px-5 py-2.5 text-right font-normal">Applied</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => onOpenJob(a.job_id)}
                      className="cursor-pointer border-b border-hairline/60 transition-colors last:border-0 hover:bg-raised"
                    >
                      <td className="max-w-64 truncate px-5 py-2.5 font-medium text-ink">{a.title}</td>
                      <td className="px-3 py-2.5 text-ink-dim">{a.company}</td>
                      <td className="px-3 py-2.5 text-ink-faint">{a.method}</td>
                      <td className="px-3 py-2.5"><StatusPill status={a.outcome} /></td>
                      <td className="max-w-64 truncate px-3 py-2.5 text-ink-faint">
                        {a.latest_subject ?? <span className="text-ink-faint">No reply yet</span>}
                      </td>
                      <td className="tabular px-5 py-2.5 text-right text-[11px] text-ink-faint" title={shortDate(a.applied_at)}>
                        {ago(a.applied_at)}
                      </td>
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
