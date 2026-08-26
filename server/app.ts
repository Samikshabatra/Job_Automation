import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, type Database } from '../src/db/index.js';
import { loadCriteria } from '../src/config/load.js';
import { JobRunner, BusyError, type RunKind } from './runner.js';
import { getSettings, updateSettings, isDryRun, getIntegrations, SettingsError } from './settings.js';
import { getOverview } from './queries/overview.js';
import { listJobs, getJobDetail, getJobFacets } from './queries/jobs.js';
import { getPipelineBoard } from './queries/pipeline.js';
import { listApplications, getApplicationCompanies } from './queries/applications.js';
import { getTracking } from './queries/tracking.js';
import { getReports } from './queries/reports.js';
import { getReviewQueue } from './queries/review.js';
import { getAgentSnapshot } from './queries/agent.js';
import { getLatestTailorRun, listTailorRuns, diffSections } from './queries/tailor.js';

export interface AppOptions {
  db?: Database;
  dbPath?: string;
  configDir?: string;
  runner?: JobRunner;
}

const RUN_KINDS: RunKind[] = ['daily', 'agent', 'track'];

const asInt = (v: unknown): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};

const asStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const db = opts.db ?? openDb(opts.dbPath ?? 'data/pipeline.db');
  const configDir = opts.configDir ?? 'config';
  const runner = opts.runner ?? new JobRunner(db);
  const app = Fastify({ logger: false });

  const criteria = () => loadCriteria(configDir);

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/overview', async () => getOverview(db, {
    threshold: criteria().scoring.threshold,
    today: new Date().toISOString().slice(0, 10),
  }));

  app.get('/api/jobs', async (req) => {
    const q = req.query as Record<string, string>;
    return listJobs(db, {
      q: asStr(q.q),
      source: asStr(q.source),
      location: asStr(q.location),
      status: asStr(q.status),
      minScore: asInt(q.minScore),
      since: asStr(q.since),
      sort: (asStr(q.sort) as 'score' | 'recent' | 'company') ?? 'score',
      limit: asInt(q.limit),
      offset: asInt(q.offset),
    });
  });

  app.get('/api/jobs/facets', async () => getJobFacets(db));

  app.get('/api/jobs/:id', async (req, reply) => {
    const id = asInt((req.params as { id: string }).id);
    const job = id === undefined ? null : getJobDetail(db, id);
    if (!job) return reply.code(404).send({ error: 'no such job' });
    const tailor = getLatestTailorRun(db, job.id);
    return {
      job,
      tailor: tailor
        ? { ...tailor, sections: diffSections(tailor.original_json, tailor.tailored_json) }
        : null,
    };
  });

  app.get('/api/pipeline', async () => getPipelineBoard(db));

  app.get('/api/applications', async (req) => {
    const q = req.query as Record<string, string>;
    return {
      ...listApplications(db, {
        q: asStr(q.q),
        outcome: asStr(q.outcome),
        company: asStr(q.company),
        limit: asInt(q.limit),
        offset: asInt(q.offset),
      }),
      companies: getApplicationCompanies(db),
    };
  });

  app.get('/api/tracking', async () => getTracking(db));
  app.get('/api/reports', async () => getReports(db));
  app.get('/api/tailoring', async () => listTailorRuns(db));

  app.get('/api/review', async () => {
    const c = criteria();
    const submission = c.submission as { browser_enabled?: boolean };
    return {
      queue: getReviewQueue(db, {
        browserEnabled: submission.browser_enabled !== false,
        dailyCap: c.limits.daily_cap,
        perCompanyCap: c.limits.per_company_open_applications,
      }),
      // The review flow needs a TTY (apply_agent/__review__.py checks
      // stdin.isatty), so it cannot be driven from here. The UI shows the
      // command instead of a button that would silently do nothing.
      command: 'npm run review',
      note: 'The review queue opens a headed browser and waits for you at a prompt. '
        + 'Run it in a terminal; this screen shows what it will open.',
    };
  });

  app.get('/api/agent', async () => ({
    ...getAgentSnapshot(db),
    runner: runner.status(),
    dryRun: isDryRun(configDir),
    recentLines: runner.recentLines(),
  }));

  app.get('/api/settings', async () => ({
    ...getSettings(configDir),
    integrations: getIntegrations(configDir),
    dryRun: isDryRun(configDir),
  }));

  app.patch('/api/settings', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return { values: updateSettings(body, configDir) };
    } catch (err) {
      if (err instanceof SettingsError) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  app.post('/api/runs', async (req, reply) => {
    const body = (req.body ?? {}) as { kind?: string; jobId?: number; confirm?: boolean };
    const kind = body.kind as RunKind;
    if (!RUN_KINDS.includes(kind)) {
      return reply.code(400).send({ error: `kind must be one of: ${RUN_KINDS.join(', ')}` });
    }

    const dryRun = isDryRun(configDir);

    // An agent run with dry_run off submits real applications to real
    // employers. That is not something a stray click should be able to do, so
    // the request must say so explicitly and the server must agree it is live.
    if (kind === 'agent' && !dryRun && body.confirm !== true) {
      return reply.code(409).send({
        error: 'live_submission_requires_confirmation',
        message: 'submission.dry_run is false: this run will send real applications. '
          + 'Re-send with confirm: true to proceed.',
      });
    }

    try {
      const { runId } = runner.start(kind, { dryRun, jobId: body.jobId });
      return { runId, kind, dryRun };
    } catch (err) {
      if (err instanceof BusyError) {
        return reply.code(409).send({ error: 'busy', message: err.message, status: runner.status() });
      }
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/api/runs/stop', async () => ({ stopped: runner.stop() }));

  app.get('/api/runs', async () => db.prepare(
    'SELECT id, kind, started_at, finished_at, exit_code, dry_run, error FROM runs ORDER BY id DESC LIMIT 50',
  ).all());

  /**
   * Server-sent events. One stream carries both pipeline log lines and runner
   * status changes; the client demultiplexes on `type`. A heartbeat keeps
   * intermediaries from closing an idle connection.
   */
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (data: unknown) => {
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };

    send({ type: 'status', ...runner.status() });
    for (const line of runner.recentLines()) {
      send({ type: 'log', line, stream: 'out', runId: runner.status().runId });
    }

    const unsubscribe = runner.subscribe(send);
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { /* client gone */ }
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.addHook('onClose', async () => {
    if (!opts.db) db.close();
  });

  return app;
}
