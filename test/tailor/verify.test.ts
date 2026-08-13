import { describe, it, expect } from 'vitest';
import { verifyNoFabrication } from '../../src/tailor/verify.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const source: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'Built SQL pipelines aggregating 12M rows of transaction data', skills: ['sql'] },
      { id: 'a2', text: 'Automated a weekly Excel report in Python, cutting 6 hours to 10 minutes', skills: ['python'] },
    ],
  },
];

describe('verifyNoFabrication', () => {
  it('accepts verbatim bullets', () => {
    const res = { entries: [{ id: 'e1', bullets: [{ id: 'a1', text: source[0].bullets[0].text }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(true);
  });

  it('accepts light rewording that preserves the substance', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL data pipelines aggregating 12M rows of transaction data' }] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).ok).toBe(true);
  });

  it('rejects an invented bullet', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Led a team of 12 engineers at Google for three years' }] }],
      summary: '',
    };
    const v = verifyNoFabrication(res, source);
    expect(v.ok).toBe(false);
    expect(v.offending[0]).toContain('Led a team');
  });

  it('rejects a bullet whose id does not exist in the source', () => {
    const res = { entries: [{ id: 'e1', bullets: [{ id: 'ZZZ', text: 'Anything at all' }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('rejects an entry id that does not exist in the source', () => {
    const res = { entries: [{ id: 'ghost', bullets: [{ id: 'a1', text: source[0].bullets[0].text }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('rejects an inflated metric', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12B rows of transaction data' }] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('lists every offending bullet, not just the first', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [
        { id: 'a1', text: 'Completely unrelated claim about rocket engines' },
        { id: 'a2', text: 'Another entirely invented achievement in finance' },
      ] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).offending).toHaveLength(2);
  });
});
