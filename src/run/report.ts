import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  boardsPolled: number;
  discovered: number;
  fetched: number;
  deduped: number;
  filtered: Record<string, number>;
  scored: number;
  tailored: number;
  submitted: number;
  outcomes: Record<string, number>;
  sourceFailures: { source: string; error: string }[];
  unhealthySources: { source: string; consecutiveFailures: number }[];
  unresolvedCompanies: string[];
  unknownLocations: string[];
}

export function emptyReport(startedAt: string): RunReport {
  return {
    startedAt, finishedAt: '', boardsPolled: 0, discovered: 0, fetched: 0,
    deduped: 0, filtered: {}, scored: 0, tailored: 0, submitted: 0,
    outcomes: {}, sourceFailures: [], unhealthySources: [],
    unresolvedCompanies: [], unknownLocations: [],
  };
}

function section(title: string, lines: string[]): string {
  return lines.length ? `\n${title}\n${lines.map((l) => `  ${l}`).join('\n')}\n` : '';
}

export function formatReport(r: RunReport): string {
  const filtered = Object.entries(r.filtered).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';
  const outcomes = Object.entries(r.outcomes).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none';

  return [
    `Run ${r.startedAt} → ${r.finishedAt}`,
    '',
    `  boards polled : ${r.boardsPolled}`,
    `  new boards    : ${r.discovered}`,
    `  fetched       : ${r.fetched}`,
    `  duplicates    : ${r.deduped}`,
    `  filtered out  : ${filtered}`,
    `  scored        : ${r.scored}`,
    `  tailored      : ${r.tailored}`,
    `  submitted     : ${r.submitted}`,
    `  outcomes      : ${outcomes}`,
    section('Source failures:', r.sourceFailures.map((f) => `${f.source}: ${f.error}`)),
    section(
      'Sources failing repeatedly — investigate the adapter:',
      r.unhealthySources.map((s) => `${s.source}: ${s.consecutiveFailures} consecutive failures`),
    ),
    section('Companies that could not be resolved (add ats/token by hand):', r.unresolvedCompanies),
    section('Unrecognised locations (consider adding to the alias map):', r.unknownLocations),
  ].join('\n');
}

export function writeReport(r: RunReport, dir = 'runs'): string {
  mkdirSync(dir, { recursive: true });
  const stamp = r.startedAt.replace(/[:.]/g, '-');
  const path = join(dir, `run-${stamp}.txt`);
  writeFileSync(path, formatReport(r), 'utf8');
  return path;
}
