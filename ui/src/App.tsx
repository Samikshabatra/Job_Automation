import { useCallback, useEffect, useState } from 'react';
import { api, useApi, useRunStream } from './lib/api';
import { Shell, type ScreenKey } from './components/Shell';
import type { Stage } from './components/StageRail';
import { Overview } from './screens/Overview';
import { Jobs } from './screens/Jobs';
import { PipelineBoard } from './screens/PipelineBoard';
import { JobDetail } from './screens/JobDetail';
import { Applications } from './screens/Applications';
import { Tailoring } from './screens/Tailoring';
import { ApplyAgent } from './screens/ApplyAgent';
import { ReviewQueue } from './screens/ReviewQueue';
import { Tracking } from './screens/Tracking';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';

/**
 * Screen state lives in the URL hash rather than in React state alone, so a
 * reload keeps you where you were and the browser's back button works. This is
 * a ten-screen tool; a router library would be more machinery than it earns.
 */
function readHash(): { screen: ScreenKey; jobId: number | null } {
  const [screen, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  return {
    screen: (screen || 'overview') as ScreenKey,
    jobId: id ? Number(id) : null,
  };
}

export default function App() {
  const [route, setRoute] = useState(readHash);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refreshAll = useCallback(() => setReloadKey((k) => k + 1), []);
  const { lines, status } = useRunStream(refreshAll);

  const overview = useApi<{ pipeline: Stage[] }>('/api/overview', [reloadKey]);
  const settings = useApi<{ dryRun: boolean }>('/api/settings', [reloadKey]);

  const navigate = (screen: ScreenKey) => { window.location.hash = `/${screen}`; };
  const openJob = (id: number) => { window.location.hash = `/job/${id}`; };

  const startRun = async (kind: 'daily' | 'track' | 'agent') => {
    try {
      await api.post('/api/runs', { kind });
      refreshAll();
    } catch {
      // The agent screen surfaces its own errors; a discovery run that cannot
      // start is already visible through the idle indicator in the header.
    }
  };

  const stopRun = async () => {
    await api.post('/api/runs/stop');
    refreshAll();
  };

  const screen = route.jobId !== null ? 'jobs' : route.screen;

  return (
    <Shell
      screen={screen}
      onNavigate={navigate}
      running={status.running}
      runKind={status.kind}
      stages={overview.data?.pipeline ?? []}
      dryRun={settings.data?.dryRun ?? true}
      onStop={stopRun}
    >
      {route.jobId !== null ? (
        <JobDetail key={`${route.jobId}-${reloadKey}`} id={route.jobId} onBack={() => navigate('jobs')} />
      ) : (
        <Screen
          key={`${route.screen}-${reloadKey}`}
          screen={route.screen}
          running={status.running}
          lines={lines}
          onRun={startRun}
          onOpenJob={openJob}
        />
      )}
    </Shell>
  );
}

function Screen({ screen, running, lines, onRun, onOpenJob }: {
  screen: ScreenKey;
  running: boolean;
  lines: { line: string; stream: 'out' | 'err'; id: number }[];
  onRun: (kind: 'daily' | 'track' | 'agent') => void;
  onOpenJob: (id: number) => void;
}) {
  switch (screen) {
    case 'jobs': return <Jobs onOpenJob={onOpenJob} />;
    case 'pipeline': return <PipelineBoard onOpenJob={onOpenJob} />;
    case 'applications': return <Applications onOpenJob={onOpenJob} />;
    case 'tailoring': return <Tailoring onOpenJob={onOpenJob} />;
    case 'agent': return <ApplyAgent running={running} logLines={lines} />;
    case 'review': return <ReviewQueue onOpenJob={onOpenJob} />;
    case 'tracking': return <Tracking onSync={() => onRun('track')} running={running} />;
    case 'reports': return <Reports />;
    case 'settings': return <Settings />;
    default: return <Overview onRun={onRun} running={running} logLines={lines} />;
  }
}
