import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Database } from '../../src/db/index.js';
import { seedDb } from './seed.js';
import { JobRunner, BusyError, buildArgv } from '../../server/runner.js';

/** A stand-in for a spawned child process, driven by hand from each test. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() { this.killed = true; this.emit('close', 130); return true; }
  finish(code: number) { this.emit('close', code); }
}

function fakeSpawn() {
  const calls: { cmd: string; args: string[] }[] = [];
  let last: FakeChild | null = null;
  const spawn = (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    last = new FakeChild();
    return last as never;
  };
  return { spawn, calls, child: () => last! };
}

const DRY = { dryRun: true };

describe('buildArgv', () => {
  it('produces a fixed command per run kind', () => {
    expect(buildArgv('daily', DRY).args).toEqual(['run', 'daily']);
    expect(buildArgv('track', DRY).args).toEqual(['run', 'track']);
    expect(buildArgv('agent', DRY).args).toEqual(['-m', 'apply_agent']);
  });

  it('passes a job id to the agent as a bare positional, matching its CLI', () => {
    // apply_agent.__main__ reads only_job_id from argv[1] with int().
    expect(buildArgv('agent', { ...DRY, jobId: 42 }).args).toEqual(['-m', 'apply_agent', '42']);
  });

  it('refuses a job id that is not a positive integer', () => {
    // The one caller-supplied value that reaches argv. If this check is wrong,
    // nothing else in the process stops a crafted string.
    expect(() => buildArgv('agent', { ...DRY, jobId: 1.5 })).toThrow(/positive integer/);
    expect(() => buildArgv('agent', { ...DRY, jobId: 0 })).toThrow(/positive integer/);
    expect(() => buildArgv('agent', { ...DRY, jobId: -3 })).toThrow(/positive integer/);
    expect(() => buildArgv('agent', { ...DRY, jobId: '7; rm -rf /' as never })).toThrow(/positive integer/);
  });

  it('has no flag that can arm live submission', () => {
    // dry_run lives in criteria.yaml. A second, argv-shaped way to go live is
    // exactly the kind of hidden switch this design refuses to have.
    for (const kind of ['daily', 'track', 'agent'] as const) {
      const { args } = buildArgv(kind, { dryRun: false });
      expect(args.some((a) => /live|no-dry|submit/i.test(a))).toBe(false);
    }
  });

  it('rejects an unknown kind instead of shelling out whatever it was given', () => {
    expect(() => buildArgv('rm -rf /' as never, DRY)).toThrow(/unknown run kind/i);
  });
});

describe('JobRunner', () => {
  let db: Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => { db.close(); });

  it('records a run row when it starts', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const { runId } = runner.start('daily', DRY);

    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as
      { kind: string; finished_at: string | null; dry_run: number };
    expect(row.kind).toBe('daily');
    expect(row.finished_at).toBe(null);
    expect(row.dry_run).toBe(1);
  });

  it('records dry_run = 0 when the config says submission is live', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const { runId } = runner.start('agent', { dryRun: false });

    const row = db.prepare('SELECT dry_run FROM runs WHERE id = ?').get(runId) as { dry_run: number };
    expect(row.dry_run).toBe(0);
  });

  it('refuses a second run while one is alive', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    runner.start('daily', DRY);

    expect(() => runner.start('agent', DRY)).toThrow(BusyError);
    expect(f.calls).toHaveLength(1);
  });

  it('accepts a new run once the previous one closes', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    runner.start('daily', DRY);
    f.child().finish(0);

    expect(() => runner.start('track', DRY)).not.toThrow();
    expect(f.calls).toHaveLength(2);
  });

  it('writes the exit code and finish time when the process closes', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const { runId } = runner.start('daily', DRY);
    f.child().finish(2);

    const row = db.prepare('SELECT exit_code, finished_at FROM runs WHERE id = ?').get(runId) as
      { exit_code: number; finished_at: string | null };
    expect(row.exit_code).toBe(2);
    expect(row.finished_at).not.toBe(null);
  });

  it('broadcasts stdout lines to subscribers', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const seen: string[] = [];
    runner.subscribe((e) => { if (e.type === 'log') seen.push(e.line); });

    runner.start('daily', DRY);
    f.child().stdout.emit('data', Buffer.from('discovered 12 jobs\nscored 4\n'));

    expect(seen).toEqual(['discovered 12 jobs', 'scored 4']);
  });

  it('keeps a tail so a page opened mid-run is not blank', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    runner.start('daily', DRY);
    f.child().stdout.emit('data', Buffer.from('line one\nline two\n'));

    expect(runner.recentLines()).toEqual(['line one', 'line two']);
  });

  it('emits a status event on start and on close', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const types: string[] = [];
    runner.subscribe((e) => types.push(e.type));

    runner.start('daily', DRY);
    f.child().finish(0);

    expect(types.filter((t) => t === 'status')).toHaveLength(2);
  });

  it('reports idle status when nothing is running', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    expect(runner.status().running).toBe(false);

    runner.start('daily', DRY);
    expect(runner.status().running).toBe(true);
    expect(runner.status().kind).toBe('daily');
  });

  it('stops a running process and frees the slot', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    runner.start('daily', DRY);

    expect(runner.stop()).toBe(true);
    expect(f.child().killed).toBe(true);
    expect(runner.status().running).toBe(false);
  });

  it('returns false from stop when there is nothing to stop', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    expect(runner.stop()).toBe(false);
  });

  it('frees the slot when the process fails to spawn at all', () => {
    // An ENOENT on a missing python must not leave the runner permanently
    // wedged in "busy" with no process behind it.
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const { runId } = runner.start('agent', DRY);
    f.child().emit('error', new Error('spawn ENOENT'));

    expect(runner.status().running).toBe(false);
    const row = db.prepare('SELECT error, finished_at FROM runs WHERE id = ?').get(runId) as
      { error: string | null; finished_at: string | null };
    expect(row.error).toContain('ENOENT');
    expect(row.finished_at).not.toBe(null);
  });

  it('does not let a late close event overwrite a recorded spawn error', () => {
    const f = fakeSpawn();
    const runner = new JobRunner(db, f.spawn as never);
    const { runId } = runner.start('agent', DRY);
    const child = f.child();
    child.emit('error', new Error('spawn ENOENT'));
    child.emit('close', 1);

    const row = db.prepare('SELECT error FROM runs WHERE id = ?').get(runId) as { error: string | null };
    expect(row.error).toContain('ENOENT');
  });
});
