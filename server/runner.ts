import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { Database } from '../src/db/index.js';

export type RunKind = 'daily' | 'agent' | 'track';

export interface RunOptions {
  /**
   * Restricts an `agent` run to a single job. `apply_agent.__main__` reads it
   * from argv[1]. Validated as an integer before it is stringified, which is
   * the only reason a caller-supplied value is allowed into argv at all.
   */
  jobId?: number;
  /**
   * Whether the pipeline will actually submit, read from criteria.yaml by the
   * caller. Recorded on the run row for the audit trail; it is NOT passed to
   * the child, because dry-run lives in config and nowhere else.
   */
  dryRun: boolean;
}

export type RunnerEvent =
  | { type: 'log'; runId: number; line: string; stream: 'out' | 'err' }
  | { type: 'status'; runId: number | null; kind: RunKind | null; running: boolean; exitCode?: number | null };

export class BusyError extends Error {
  constructor(public readonly kind: RunKind) {
    super(`a ${kind} run is already in progress`);
    this.name = 'BusyError';
  }
}

type SpawnFn = (cmd: string, args: string[], opts: object) => ChildProcess;

const isWindows = process.platform === 'win32';
const NPM = isWindows ? 'npm.cmd' : 'npm';
const PYTHON = isWindows ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';

/**
 * The command line for a run kind, assembled from constants only.
 *
 * Nothing a caller sends over HTTP is interpolated here. A request chooses
 * WHICH of three fixed commands runs, and may narrow an agent run to one job
 * id -- an integer, rejected if it is anything else. It cannot contribute a
 * single free-form character to argv. That is the whole reason this is a
 * lookup rather than a template.
 *
 * There is deliberately no "go live" flag. Whether the agent submits is
 * `submission.dry_run` in config/criteria.yaml; making it an argv option would
 * create a second, less visible way to arm real submissions.
 */
export function buildArgv(kind: RunKind, opts: RunOptions): { cmd: string; args: string[] } {
  switch (kind) {
    case 'daily':
      return { cmd: NPM, args: ['run', 'daily'] };
    case 'track':
      return { cmd: NPM, args: ['run', 'track'] };
    case 'agent': {
      const args = ['-m', 'apply_agent'];
      if (opts.jobId !== undefined) {
        if (!Number.isInteger(opts.jobId) || opts.jobId <= 0) {
          throw new Error(`jobId must be a positive integer, got: ${String(opts.jobId)}`);
        }
        args.push(String(opts.jobId));
      }
      return { cmd: PYTHON, args };
    }
    default:
      throw new Error(`unknown run kind: ${String(kind)}`);
  }
}

/**
 * Runs at most one pipeline process at a time and streams its output.
 *
 * The singleton is a safety property, not a convenience. Two concurrent apply
 * runs would each read the daily cap before either had written its
 * applications, so both could pass a cap that only one of them should. Making
 * concurrency impossible is cheaper and more trustworthy than making the cap
 * check atomic across processes.
 */
export class JobRunner {
  private child: ChildProcess | null = null;
  private currentKind: RunKind | null = null;
  private currentRunId: number | null = null;
  private startedAt: string | null = null;
  private subscribers = new Set<(e: RunnerEvent) => void>();
  private tail: string[] = [];

  constructor(private db: Database, private spawnFn: SpawnFn = nodeSpawn as SpawnFn) {}

  subscribe(fn: (e: RunnerEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** The last lines of the live run, so a page opened mid-run is not blank. */
  recentLines(): string[] {
    return [...this.tail];
  }

  private emit(e: RunnerEvent): void {
    for (const fn of this.subscribers) {
      try { fn(e); } catch { /* a broken SSE client must not kill the run */ }
    }
  }

  status(): { running: boolean; kind: RunKind | null; runId: number | null; startedAt: string | null } {
    return {
      running: this.child !== null,
      kind: this.currentKind,
      runId: this.currentRunId,
      startedAt: this.startedAt,
    };
  }

  start(kind: RunKind, opts: RunOptions): { runId: number } {
    if (this.child) throw new BusyError(this.currentKind!);

    const { cmd, args } = buildArgv(kind, opts);
    const startedAt = new Date().toISOString();

    const info = this.db.prepare(
      'INSERT INTO runs (kind, started_at, dry_run) VALUES (?, ?, ?)',
    ).run(kind, startedAt, opts.dryRun ? 1 : 0);
    const runId = Number(info.lastInsertRowid);

    const child = this.spawnFn(cmd, args, {
      cwd: process.cwd(),
      // npm on Windows is a shim that cannot be exec'd directly. The args are
      // constants from buildArgv, so there is no injection surface here.
      shell: isWindows,
      env: process.env,
    });

    this.child = child;
    this.currentKind = kind;
    this.currentRunId = runId;
    this.startedAt = startedAt;
    this.tail = [];

    const pump = (stream: 'out' | 'err') => (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.length === 0) continue;
        this.tail.push(line);
        if (this.tail.length > 200) this.tail.shift();
        this.emit({ type: 'log', runId, line, stream });
      }
    };
    child.stdout?.on('data', pump('out'));
    child.stderr?.on('data', pump('err'));

    child.on('error', (err: Error) => this.finish(runId, null, err.message));
    child.on('close', (code: number | null) => this.finish(runId, code, null));

    this.emit({ type: 'status', runId, kind, running: true });
    return { runId };
  }

  /**
   * Clears the slot and closes out the run row. Guarded against running twice
   * for one run: a failed spawn emits both 'error' and 'close', and the second
   * of those must not overwrite the recorded error with a bare exit code.
   */
  private finish(runId: number, code: number | null, error: string | null): void {
    if (this.currentRunId !== runId) return;

    this.db.prepare(
      'UPDATE runs SET finished_at = ?, exit_code = ?, error = ? WHERE id = ?',
    ).run(new Date().toISOString(), code, error, runId);

    const kind = this.currentKind;
    this.child = null;
    this.currentKind = null;
    this.currentRunId = null;
    this.startedAt = null;

    this.emit({ type: 'status', runId, kind, running: false, exitCode: code });
  }

  stop(): boolean {
    if (!this.child) return false;
    this.child.kill();
    return true;
  }
}
