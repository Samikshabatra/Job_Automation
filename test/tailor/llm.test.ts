import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, tailor, TailorError } from '../../src/tailor/llm.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const entries: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'Built SQL pipelines aggregating 12M rows', skills: ['sql'] },
      { id: 'a2', text: 'Automated a weekly report in Python', skills: ['python'] },
    ],
  },
];

const req = { jdSkills: ['sql', 'python'], jobTitle: 'Data Analyst', entries };

const validResponse = JSON.stringify({
  entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12M rows' }] }],
  summary: 'Data analyst with SQL and Python experience.',
});

describe('buildPrompt', () => {
  it('includes the JD keywords and the candidate bullets', () => {
    const p = buildPrompt(req);
    expect(p).toContain('sql');
    expect(p).toContain('Built SQL pipelines aggregating 12M rows');
  });

  it('states the no-fabrication constraint', () => {
    expect(buildPrompt(req).toLowerCase()).toContain('may not invent');
  });

  it('never contains the full JD text', () => {
    expect(buildPrompt(req)).not.toContain('jdText');
  });
});

describe('tailor', () => {
  it('parses a valid response', async () => {
    const call = vi.fn(async () => validResponse);
    const res = await tailor(req, { call });
    expect(res.entries[0].bullets[0].id).toBe('a1');
    expect(call).toHaveBeenCalledOnce();
  });

  it('strips markdown code fences before parsing', async () => {
    const call = vi.fn(async () => '```json\n' + validResponse + '\n```');
    await expect(tailor(req, { call })).resolves.toBeTruthy();
  });

  it('retries once on invalid JSON, then succeeds', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(validResponse);
    await expect(tailor(req, { call })).resolves.toBeTruthy();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('retries once on schema violation, then succeeds', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ entries: 'wrong type' }))
      .mockResolvedValueOnce(validResponse);
    await expect(tailor(req, { call })).resolves.toBeTruthy();
  });

  it('throws TailorError after two failures', async () => {
    const call = vi.fn(async () => 'still not json');
    await expect(tailor(req, { call })).rejects.toBeInstanceOf(TailorError);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
