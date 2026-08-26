import { useState } from 'react';
import { useApi } from '../lib/api';
import { shortDate } from '../lib/format';
import {
  Panel, Score, StatusPill, Button, Tabs, Bar, ErrorState, Skeleton, Empty,
} from '../components/primitives';

interface JobDetailData {
  job: {
    id: number; title: string; company: string; source: string; url: string;
    location: string | null; match_score: number | null; status: string;
    status_reason: string | null; min_years: number | null; jd_text: string | null;
    posted_at: string | null; first_seen_at: string; ats_platform: string | null;
    resume_path: string | null; submitted_at: string | null;
  };
  tailor: {
    ai_confidence: number | null; similarity: number | null; verdict: string | null;
    created_at: string;
    sections: { heading: string; original: string[]; tailored: string[]; added: string[] }[];
  } | null;
}

/** Skills the scorer knows about, matched against this job's description. */
const SKILLS = [
  'Python', 'SQL', 'AWS', 'Kubernetes', 'Docker', 'Spark', 'Airflow',
  'Pandas', 'PyTorch', 'TensorFlow', 'Django', 'FastAPI', 'React', 'TypeScript',
];

type Tab = 'description' | 'analysis';

export function JobDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('description');
  const { data, error, loading, reload } = useApi<JobDetailData>(`/api/jobs/${id}`);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={10} />;
  if (!data) return null;

  const { job } = data;
  const jd = (job.jd_text ?? '').toLowerCase();
  const present = SKILLS.filter((s) => jd.includes(s.toLowerCase()));
  const missing = SKILLS.filter((s) => !jd.includes(s.toLowerCase())).slice(0, 4);

  return (
    <div className="space-y-5">
      <Button onClick={onBack}>Back to jobs</Button>

      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-5 p-5">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{job.title}</h1>
            <p className="mt-1 text-sm text-ink-dim">{job.company}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
              <StatusPill status={job.status} />
              <span>{job.location ?? 'Location not stated'}</span>
              <span aria-hidden>·</span>
              <span>{job.source}{job.ats_platform ? ` / ${job.ats_platform}` : ''}</span>
              <span aria-hidden>·</span>
              <span>Posted {shortDate(job.posted_at)}</span>
              {job.min_years !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span>Wants {job.min_years}+ years</span>
                </>
              )}
            </div>
            {job.status_reason && (
              <p className="mt-3 rounded-lg border border-hairline bg-raised px-3 py-2 text-xs text-ink-dim">
                Pipeline note: {job.status_reason}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="text-center">
              <Score value={job.match_score} size="lg" />
              <div className="eyebrow mt-2">Match score</div>
            </div>
            <a href={job.url} target="_blank" rel="noreferrer">
              <Button variant="primary">Open posting</Button>
            </a>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel>
          <div className="px-5 pt-3">
            <Tabs<Tab>
              active={tab}
              onChange={setTab}
              tabs={[
                { key: 'description', label: 'Description' },
                { key: 'analysis', label: 'Tailoring' },
              ]}
            />
          </div>

          {tab === 'description' ? (
            <div className="max-h-[32rem] overflow-y-auto p-5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-dim">
              {job.jd_text ?? 'No description was captured for this posting.'}
            </div>
          ) : data.tailor ? (
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap gap-3">
                <Metric label="AI confidence" value={pctOf(data.tailor.ai_confidence)} />
                <Metric label="Similarity to your real resume" value={data.tailor.similarity?.toFixed(2) ?? '--'} />
                <Metric label="Verdict" value={data.tailor.verdict ?? '--'} />
              </div>
              {data.tailor.sections.map((s) => (
                <div key={s.heading}>
                  <div className="eyebrow mb-2">{s.heading}</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ul className="space-y-1.5 rounded-lg border border-hairline p-3 text-xs text-ink-faint">
                      {s.original.map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                    <ul className="space-y-1.5 rounded-lg border border-violet/30 bg-violet-wash p-3 text-xs text-ink-dim">
                      {s.tailored.map((l, i) => (
                        <li key={i} className={s.added.includes(l) ? 'text-violet' : ''}>{l}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="This job has not been tailored"
              hint="A tailoring record is written when the pipeline generates a resume for this posting."
            />
          )}
        </Panel>

        <Panel eyebrow="Match" title="Why this score">
          <div className="space-y-4 p-5">
            <div>
              <div className="eyebrow mb-2.5">Skills named in this posting</div>
              <div className="space-y-2">
                {present.length === 0
                  ? <p className="text-xs text-ink-faint">No tracked skills found in the description.</p>
                  : present.slice(0, 8).map((s) => <Bar key={s} label={s} pct={100} value="yes" />)}
              </div>
            </div>

            {missing.length > 0 && (
              <div>
                <div className="eyebrow mb-2">Not mentioned</div>
                <div className="flex flex-wrap gap-1.5">
                  {missing.map((s) => (
                    <span key={s} className="rounded border border-hairline px-2 py-0.5 text-[11px] text-ink-faint">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-hairline pt-4">
              <div className="eyebrow mb-2">Experience gate</div>
              <p className="text-xs text-ink-dim">
                {job.min_years === null
                  ? 'The posting does not state a minimum, so the experience filter let it through.'
                  : `The posting asks for ${job.min_years}+ years.`}
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-raised px-3 py-2">
      <div className="eyebrow">{label}</div>
      <div className="tabular mt-0.5 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

const pctOf = (v: number | null) => (v === null ? '--' : `${Math.round(v * 100)}%`);
