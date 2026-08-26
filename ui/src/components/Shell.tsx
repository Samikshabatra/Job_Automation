import type { ReactNode } from 'react';
import { Button } from './primitives';
import { StageRail, type Stage } from './StageRail';

export type ScreenKey =
  | 'overview' | 'jobs' | 'pipeline' | 'applications' | 'tailoring'
  | 'agent' | 'review' | 'tracking' | 'reports' | 'settings';

const NAV: { key: ScreenKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'applications', label: 'Applications' },
  { key: 'tailoring', label: 'Tailoring' },
  { key: 'agent', label: 'Apply agent' },
  { key: 'review', label: 'Review queue' },
  { key: 'tracking', label: 'Tracking' },
  { key: 'reports', label: 'Reports' },
  { key: 'settings', label: 'Settings' },
];

export function Shell({
  screen, onNavigate, running, runKind, stages, dryRun, onStop, children,
}: {
  screen: ScreenKey;
  onNavigate: (s: ScreenKey) => void;
  running: boolean;
  runKind: string | null;
  stages: Stage[];
  dryRun: boolean;
  onStop: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-ground">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-hairline bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-violet">
            <span className="h-2.5 w-2.5 rotate-45 rounded-[2px] bg-white" />
          </span>
          <span className="font-display text-sm font-bold tracking-tight">
            JobPilot <span className="text-violet">AI</span>
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3">
          {NAV.map((item) => (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              aria-current={screen === item.key ? 'page' : undefined}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                screen === item.key
                  ? 'bg-violet-wash font-medium text-violet'
                  : 'text-ink-dim hover:bg-raised hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/*
          Submission mode is the one piece of state that changes what a click
          costs, so it is pinned where it is always visible rather than left on
          the settings screen.
        */}
        <div className="m-3 rounded-lg border border-hairline bg-raised px-3 py-2.5">
          <div className="eyebrow mb-1">Submission</div>
          <div className={`text-xs font-semibold ${dryRun ? 'text-good' : 'text-bad'}`}>
            {dryRun ? 'Dry run' : 'Live'}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-ink-faint">
            {dryRun ? 'Forms are filled, never submitted.' : 'Runs send real applications.'}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-hairline bg-ground/90 px-6 py-3 backdrop-blur">
          <div className="md:hidden">
            <select
              value={screen}
              onChange={(e) => onNavigate(e.target.value as ScreenKey)}
              className="rounded-lg border border-hairline bg-raised px-2 py-1 text-xs text-ink"
            >
              {NAV.map((n) => <option key={n.key} value={n.key}>{n.label}</option>)}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {running ? (
              <>
                <StageRail stages={stages} compact />
                <span className="flex items-center gap-1.5 text-xs text-violet">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" />
                  {runKind} running
                </span>
                <Button variant="danger" onClick={onStop}>Stop run</Button>
              </>
            ) : (
              <span className="text-xs text-ink-faint">Idle</span>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
