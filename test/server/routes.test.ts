import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../../src/db/index.js';
import { seedDb } from './seed.js';
import { buildApp } from '../../server/app.js';
import { JobRunner } from '../../server/runner.js';

const SOURCE = readFileSync('config/criteria.yaml', 'utf8');

/** Records what it was asked to spawn and never starts a real process. */
function recordingRunner(db: Database) {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return {
      stdout: { on() {} }, stderr: { on() {} },
      on() {}, kill() { return true; },
    } as never;
  };
  return { runner: new JobRunner(db, spawn), calls };
}

describe('HTTP routes', () => {
  let db: Database;
  let app: FastifyInstance;
  let dir: string;

  beforeEach(async () => {
    db = seedDb();
    dir = mkdtempSync(join(tmpdir(), 'jobpilot-routes-'));
    writeFileSync(join(dir, 'criteria.yaml'), SOURCE, 'utf8');
    app = buildApp({ db, configDir: dir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const get = (url: string) => app.inject({ method: 'GET', url });

  it('serves the overview', async () => {
    const res = await get('/api/overview');
    expect(res.statusCode).toBe(200);
    expect(res.json().stats.discovered).toBe(9);
  });

  it('serves jobs and honours query filters', async () => {
    expect((await get('/api/jobs')).json().total).toBe(9);
    expect((await get('/api/jobs?source=lever')).json().total).toBe(3);
    expect((await get('/api/jobs?minScore=80')).json().total).toBe(4);
  });

  it('ignores a nonsense numeric filter instead of returning a 500', async () => {
    const res = await get('/api/jobs?minScore=abc');
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(9);
  });

  it('404s an unknown job rather than throwing', async () => {
    expect((await get('/api/jobs/99999')).statusCode).toBe(404);
  });

  it('serves a job with its tailoring history slot', async () => {
    const res = await get('/api/jobs/1');
    expect(res.statusCode).toBe(200);
    expect(res.json().job.company).toBe('Razorpay');
    expect(res.json().tailor).toBe(null);
  });

  it('serves pipeline, applications, tracking and reports', async () => {
    expect((await get('/api/pipeline')).json()).toHaveLength(5);
    expect((await get('/api/applications')).json().total).toBe(2);
    expect((await get('/api/tracking')).json().stats.interviews).toBe(1);
    expect((await get('/api/reports')).json().rates.responseRate).toBe(100);
  });

  it('serves the review queue with the command that actually runs it', async () => {
    const res = await get('/api/review');
    expect(res.statusCode).toBe(200);
    expect(res.json().command).toBe('npm run review');
    // Swiggy and Adobe are 'tailored' in the fixture.
    expect(res.json().queue).toHaveLength(2);
  });

  describe('POST /api/runs', () => {
    it('starts a known run kind', async () => {
      const { runner, calls } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      const res = await a.inject({ method: 'POST', url: '/api/runs', payload: { kind: 'daily' } });
      expect(res.statusCode).toBe(200);
      expect(calls[0]!.args).toEqual(['run', 'daily']);
      await a.close();
    });

    it('rejects an unknown run kind', async () => {
      const { runner, calls } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      const res = await a.inject({ method: 'POST', url: '/api/runs', payload: { kind: 'rm -rf /' } });
      expect(res.statusCode).toBe(400);
      expect(calls).toHaveLength(0);
      await a.close();
    });

    it('returns 409 rather than starting a second concurrent run', async () => {
      const { runner } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      await a.inject({ method: 'POST', url: '/api/runs', payload: { kind: 'daily' } });
      const second = await a.inject({ method: 'POST', url: '/api/runs', payload: { kind: 'track' } });
      expect(second.statusCode).toBe(409);
      expect(second.json().error).toBe('busy');
      await a.close();
    });

    it('refuses an unconfirmed agent run once dry_run is off', async () => {
      // The safety gate that matters: with submission live, a plain click must
      // not be enough to start sending real applications.
      writeFileSync(join(dir, 'criteria.yaml'), SOURCE.replace('dry_run: true', 'dry_run: false'), 'utf8');
      const { runner, calls } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      const res = await a.inject({ method: 'POST', url: '/api/runs', payload: { kind: 'agent' } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('live_submission_requires_confirmation');
      expect(calls).toHaveLength(0);
      await a.close();
    });

    it('allows a confirmed agent run when dry_run is off', async () => {
      writeFileSync(join(dir, 'criteria.yaml'), SOURCE.replace('dry_run: true', 'dry_run: false'), 'utf8');
      const { runner, calls } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      const res = await a.inject({
        method: 'POST', url: '/api/runs', payload: { kind: 'agent', confirm: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().dryRun).toBe(false);
      expect(calls).toHaveLength(1);
      await a.close();
    });

    it('needs no confirmation while dry_run is on', async () => {
      const { runner, calls } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      const res = await a.inject({ method: 'POST', url: '/api/runs', payload: { kind: 'agent' } });
      expect(res.statusCode).toBe(200);
      expect(calls[0]!.args).toEqual(['-m', 'apply_agent']);
      await a.close();
    });

    it('refuses a job id that is not a positive integer', async () => {
      const { runner, calls } = recordingRunner(db);
      const a = buildApp({ db, configDir: dir, runner });
      await a.ready();

      const res = await a.inject({
        method: 'POST', url: '/api/runs', payload: { kind: 'agent', jobId: '3; shutdown' },
      });
      expect(res.statusCode).toBe(400);
      expect(calls).toHaveLength(0);
      await a.close();
    });
  });

  describe('settings', () => {
    it('serves current settings with the integration state', async () => {
      const res = await get('/api/settings');
      expect(res.statusCode).toBe(200);
      expect(res.json().values.scoring.threshold).toBe(50);
      expect(res.json().integrations.some((i: { key: string }) => i.key === 'gmail')).toBe(true);
    });

    it('applies a valid patch', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/api/settings', payload: { 'scoring.threshold': 70 },
      });
      expect(res.statusCode).toBe(200);
      expect((await get('/api/settings')).json().values.scoring.threshold).toBe(70);
    });

    it('rejects a patch outside the whitelist with a 400, not a 500', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/api/settings', payload: { 'titles.include': ['x'] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/not an editable setting/);
    });

    it('rejects an out-of-range value', async () => {
      const res = await app.inject({
        method: 'PATCH', url: '/api/settings', payload: { 'limits.daily_cap': 9999 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
