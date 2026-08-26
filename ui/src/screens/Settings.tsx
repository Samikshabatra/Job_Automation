import { useState } from 'react';
import { api, useApi } from '../lib/api';
import { Panel, Button, Tabs, ErrorState, Skeleton, Field } from '../components/primitives';

interface SettingsData {
  values: Record<string, Record<string, unknown>>;
  editable: string[];
  dangerous: string[];
  integrations: { key: string; label: string; connected: boolean; hint: string }[];
  dryRun: boolean;
}

type Tab = 'pipeline' | 'limits' | 'submission' | 'integrations';

const NUMBER_FIELDS: { tab: Tab; path: string; label: string; hint: string }[] = [
  { tab: 'pipeline', path: 'scoring.threshold', label: 'Minimum match score', hint: 'Jobs below this are never applied to. 0-100.' },
  { tab: 'pipeline', path: 'experience.max_years_required', label: 'Maximum years demanded', hint: 'A posting asking for more than this is filtered out.' },
  { tab: 'pipeline', path: 'freshness.max_posted_age_days', label: 'Oldest posting to consider', hint: 'In days.' },
  { tab: 'limits', path: 'limits.daily_cap', label: 'Applications per day', hint: 'The agent stops once it hits this.' },
  { tab: 'limits', path: 'limits.per_company_open_applications', label: 'Open applications per company', hint: 'Stops you flooding one employer.' },
  { tab: 'limits', path: 'limits.min_delay_seconds', label: 'Minimum delay between applications', hint: 'In seconds.' },
  { tab: 'limits', path: 'limits.max_delay_seconds', label: 'Maximum delay between applications', hint: 'In seconds.' },
  { tab: 'submission', path: 'submission.confidence_threshold', label: 'Field-mapping confidence needed', hint: 'Between 0 and 1. Below this the agent hands the form to you.' },
];

export function Settings() {
  const { data, error, loading, reload } = useApi<SettingsData>('/api/settings');
  const [tab, setTab] = useState<Tab>('pipeline');
  const [pending, setPending] = useState<Record<string, number | boolean>>({});
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [armingLive, setArmingLive] = useState(false);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  const read = (path: string): unknown => {
    const [section, key] = path.split('.');
    return data.values[section!]?.[key!];
  };

  const save = async (patch: Record<string, unknown>) => {
    setMessage(null);
    try {
      await api.patch('/api/settings', patch);
      setPending({});
      setArmingLive(false);
      reload();
      setMessage({ kind: 'ok', text: 'Settings saved.' });
    } catch (err) {
      setMessage({ kind: 'bad', text: err instanceof Error ? err.message : 'Could not save' });
    }
  };

  const fields = NUMBER_FIELDS.filter((f) => f.tab === tab);
  const dirty = Object.keys(pending).length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-xs text-ink-dim">
          These write straight to <code className="font-mono text-ink-faint">config/criteria.yaml</code>, the same
          file the pipeline reads.
        </p>
      </div>

      {message && (
        <p className={`rounded-lg border px-4 py-2.5 text-xs ${
          message.kind === 'ok' ? 'border-good/30 bg-good/10 text-good' : 'border-bad/30 bg-bad/10 text-bad'
        }`}>
          {message.text}
        </p>
      )}

      <Panel>
        <div className="px-5 pt-3">
          <Tabs<Tab>
            active={tab}
            onChange={(t) => { setTab(t); setPending({}); }}
            tabs={[
              { key: 'pipeline', label: 'Matching' },
              { key: 'limits', label: 'Limits' },
              { key: 'submission', label: 'Submission' },
              { key: 'integrations', label: 'Integrations' },
            ]}
          />
        </div>

        {tab === 'integrations' ? (
          <ul className="p-5">
            {data.integrations.map((i) => (
              <li key={i.key} className="flex items-center gap-4 border-b border-hairline py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink">{i.label}</div>
                  <div className="text-[11px] text-ink-faint">{i.hint}</div>
                </div>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] ${
                  i.connected ? 'border-good/30 bg-good/10 text-good' : 'border-hairline bg-raised text-ink-faint'
                }`}>
                  {i.connected ? 'Connected' : 'Not configured'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-5 p-5">
            {tab === 'submission' && (
              <div className="space-y-4">
                <Toggle
                  label="Dry run"
                  description="On: the agent fills every form and never submits. Off: it sends real applications to real employers."
                  checked={read('submission.dry_run') !== false}
                  danger={read('submission.dry_run') === false}
                  onChange={(next) => {
                    // Turning dry run OFF arms real submissions, so it never
                    // takes effect on the click that requested it.
                    if (!next) { setArmingLive(true); return; }
                    save({ 'submission.dry_run': true });
                  }}
                />

                {armingLive && (
                  <div className="rounded-xl border border-bad/40 bg-bad/5 p-4">
                    <h3 className="text-sm font-semibold text-bad">Turn off dry run?</h3>
                    <p className="mt-1.5 max-w-2xl text-xs text-ink-dim">
                      Every agent run after this will submit real applications under your name and email. The daily
                      cap, per-company limit and duplicate check still apply, but nothing else stands between a run
                      and an employer's inbox.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="danger" onClick={() => save({ 'submission.dry_run': false })}>
                        Turn off dry run
                      </Button>
                      <Button onClick={() => setArmingLive(false)}>Keep dry run on</Button>
                    </div>
                  </div>
                )}

                <Toggle
                  label="Browser automation"
                  description="The kill switch. Off means no browser opens and no form is filled, whatever else is set."
                  checked={read('submission.browser_enabled') !== false}
                  onChange={(next) => save({ 'submission.browser_enabled': next })}
                />

                <Toggle
                  label="Check the posting is still open"
                  description="Verifies a listing has not closed before spending an application on it."
                  checked={read('freshness.verify_open_before_submit') !== false}
                  onChange={(next) => save({ 'freshness.verify_open_before_submit': next })}
                />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.path} label={f.label}>
                  <input
                    type="number"
                    step={f.path.includes('confidence') ? 0.05 : 1}
                    value={String(pending[f.path] ?? read(f.path) ?? '')}
                    onChange={(e) => setPending((p) => ({ ...p, [f.path]: Number(e.target.value) }))}
                    className="rounded-lg border border-hairline bg-raised px-3 py-1.5 text-xs text-ink focus:border-violet focus:outline-none"
                  />
                  <span className="text-[10px] text-ink-faint">{f.hint}</span>
                </Field>
              ))}
            </div>

            {fields.length > 0 && (
              <div className="flex items-center gap-2 border-t border-hairline pt-4">
                <Button variant="primary" onClick={() => save(pending)} disabled={!dirty}>
                  Save changes
                </Button>
                <Button onClick={() => setPending({})} disabled={!dirty}>Discard</Button>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Toggle({ label, description, checked, onChange, danger }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 rounded-lg border border-hairline bg-raised px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] font-medium ${danger ? 'text-bad' : 'text-ink'}`}>{label}</div>
        <p className="mt-0.5 text-[11px] text-ink-faint">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
          checked ? 'border-violet bg-violet' : 'border-hairline-strong bg-ground'
        }`}
      >
        <span
          className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
