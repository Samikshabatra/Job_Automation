import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRenderInput, resumePath, renderPdf } from '../../src/tailor/render.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const profile = {
  name: 'Example Candidate', email: 'e@example.com', phone: '+91 90000 00000',
  location: 'Bengaluru, India', links: { github: 'https://github.com/example' },
};

const source: ExperienceEntry[] = [{
  id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
  start: '2025-06', end: '2025-12',
  bullets: [
    { id: 'a1', text: 'Built SQL pipelines', skills: ['sql'] },
    { id: 'a2', text: 'Automated reporting in Python', skills: ['python'] },
  ],
}];

const tailored = {
  entries: [{ id: 'e1', bullets: [{ id: 'a2', text: 'Automated reporting in Python' }] }],
  summary: 'Data analyst.',
};

describe('resumePath', () => {
  it('builds the archive path from company, role and date', () => {
    const p = resumePath('/base', 'Acme Corp', 'Data Analyst', new Date('2026-08-01T00:00:00Z'));
    expect(p).toBe(join('/base', '2026-08', 'Acme_Corp_Data_Analyst_20260801.pdf'));
  });

  it('strips characters that are illegal in Windows filenames', () => {
    const p = resumePath('/base', 'A/B:C*Corp', 'Data? Analyst', new Date('2026-08-01T00:00:00Z'));
    expect(p).not.toMatch(/[:*?"<>|]/);
  });
});

describe('buildRenderInput', () => {
  it('keeps only the bullets the tailoring selected, in order', () => {
    const input = buildRenderInput(profile, tailored, source, [], ['python', 'sql']);
    expect(input.entries[0].bullets).toEqual(['Automated reporting in Python']);
  });

  it('carries entry metadata across from the source resume', () => {
    const input = buildRenderInput(profile, tailored, source, [], []);
    expect(input.entries[0]).toMatchObject({ role: 'Data Analyst Intern', org: 'Acme', start: '2025-06' });
  });
});

describe('renderPdf', () => {
  it('produces a non-empty PDF file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'render-'));
    const out = join(dir, 'out.pdf');
    await renderPdf(buildRenderInput(profile, tailored, source, [], ['python']), out);

    expect(existsSync(out)).toBe(true);
    const bytes = readFileSync(out);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});
