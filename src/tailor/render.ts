import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EducationEntry, ExperienceEntry, Profile } from './resume.js';
import type { TailorResponse } from './llm.js';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

export interface RenderEntry {
  role: string;
  org: string;
  start: string;
  end: string;
  bullets: string[];
}

export interface RenderInput {
  profile: Profile;
  summary: string;
  entries: RenderEntry[];
  education: EducationEntry[];
  skills: string[];
}

export function buildRenderInput(
  profile: Profile,
  tailored: TailorResponse,
  source: ExperienceEntry[],
  education: EducationEntry[],
  skills: string[],
): RenderInput {
  const byId = new Map(source.map((e) => [e.id, e]));
  const entries: RenderEntry[] = [];

  for (const entry of tailored.entries) {
    const src = byId.get(entry.id);
    if (!src) continue;
    entries.push({
      role: src.role,
      org: src.org,
      start: src.start,
      end: src.end,
      bullets: entry.bullets.map((b) => b.text),
    });
  }

  return { profile, summary: tailored.summary, entries, education, skills };
}

function safeSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

export function resumePath(baseDir: string, company: string, role: string, when: Date): string {
  const yyyy = when.getUTCFullYear();
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(when.getUTCDate()).padStart(2, '0');
  return join(baseDir, `${yyyy}-${mm}`, `${safeSegment(company)}_${safeSegment(role)}_${yyyy}${mm}${dd}.pdf`);
}

export async function renderPdf(input: RenderInput, outPath: string): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'typst-'));
  try {
    writeFileSync(join(work, 'data.json'), JSON.stringify(input), 'utf8');
    copyFileSync(join(here, 'template.typ'), join(work, 'template.typ'));

    const built = join(work, 'out.pdf');
    // TYPST_BIN lets a non-PATH install (or CI) point at the binary directly.
    const typstBin = process.env.TYPST_BIN ?? 'typst';
    await execFileAsync(typstBin, ['compile', join(work, 'template.typ'), built], { timeout: 20_000 });

    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(built, outPath);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
