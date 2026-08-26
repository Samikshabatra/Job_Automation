import { describe, it, expect } from 'vitest';
import { diffSections } from '../../server/queries/tailor.js';

/**
 * The exact shapes `recordTailorRun` stores. The original keeps the full
 * experience entry (role, org, bullets with skills); the tailored response
 * carries only ids and rewritten text, so the two are joined on bullet id.
 */
const ORIGINAL = JSON.stringify({
  entries: [
    {
      id: 'e1', kind: 'work', org: 'Acme', role: 'Data Analyst',
      start: '2023-01', end: 'Present',
      bullets: [
        { id: 'b1', text: 'Built reporting pipelines in Python and SQL', skills: ['python'] },
        { id: 'b2', text: 'Automated weekly reconciliation', skills: [] },
      ],
    },
    {
      id: 'e2', kind: 'work', org: 'Globex', role: 'Intern',
      start: '2022-06', end: '2022-12',
      bullets: [{ id: 'b3', text: 'Wrote ETL jobs', skills: [] }],
    },
  ],
});

const TAILORED = JSON.stringify({
  entries: [
    {
      id: 'e1',
      bullets: [
        { id: 'b1', text: 'Built Python and SQL reporting pipelines for finance' },
        { id: 'b2', text: 'Automated weekly reconciliation' },
      ],
    },
  ],
  summary: 'Analytics engineer with reporting and ETL experience',
});

describe('diffSections', () => {
  it('names each section after the real role and organisation', () => {
    // Not "entries". The heading a person needs is the job the bullets are from.
    const headings = diffSections(ORIGINAL, TAILORED).map((s) => s.heading);
    expect(headings).toContain('Data Analyst - Acme');
  });

  it('renders bullet text, never a stringified object', () => {
    const section = diffSections(ORIGINAL, TAILORED).find((s) => s.heading.startsWith('Data Analyst'))!;
    expect(section.original.join(' ')).not.toContain('[object Object]');
    expect(section.tailored.join(' ')).not.toContain('[object Object]');
    expect(section.original[0]).toBe('Built reporting pipelines in Python and SQL');
    expect(section.tailored[0]).toBe('Built Python and SQL reporting pipelines for finance');
  });

  it('marks only the bullets whose wording actually changed', () => {
    const section = diffSections(ORIGINAL, TAILORED).find((s) => s.heading.startsWith('Data Analyst'))!;
    expect(section.added).toEqual(['Built Python and SQL reporting pipelines for finance']);
  });

  it('shows the generated summary as its own section', () => {
    const summary = diffSections(ORIGINAL, TAILORED).find((s) => s.heading === 'Summary')!;
    expect(summary.tailored).toEqual(['Analytics engineer with reporting and ETL experience']);
    // Nothing to compare it against: the base resume has no tailored summary.
    expect(summary.original).toEqual([]);
  });

  it('omits an entry the tailor left out entirely', () => {
    // e2 was not selected for this application. Showing it with an empty
    // right-hand column would read as "the tailor deleted your internship".
    const headings = diffSections(ORIGINAL, TAILORED).map((s) => s.heading);
    expect(headings.some((h) => h.startsWith('Intern'))).toBe(false);
  });

  it('returns nothing rather than throwing on unreadable payloads', () => {
    expect(diffSections('not json', TAILORED)).toEqual([]);
    expect(diffSections(ORIGINAL, '{')).toEqual([]);
    expect(diffSections('[]', '[]')).toEqual([]);
  });

  it('survives a tailored entry whose id is not in the original', () => {
    const orphan = JSON.stringify({ entries: [{ id: 'nope', bullets: [{ id: 'x', text: 'Invented' }] }] });
    expect(() => diffSections(ORIGINAL, orphan)).not.toThrow();
  });
});
