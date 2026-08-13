import { describe, it, expect } from 'vitest';
import { selectEntries, selectBullets } from '../../src/tailor/select.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const entries: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'SQL pipelines', skills: ['sql'] },
      { id: 'a2', text: 'Python automation', skills: ['python'] },
      { id: 'a3', text: 'Tableau dashboards', skills: ['tableau'] },
      { id: 'a4', text: 'Stakeholder updates', skills: [] },
    ],
  },
  {
    id: 'e2', kind: 'project', org: 'Personal', role: 'Churn Model',
    start: '2025-01', end: '2025-04',
    bullets: [
      { id: 'b1', text: 'Gradient boosting classifier', skills: ['machine learning'] },
      { id: 'b2', text: 'Feature engineering', skills: ['pandas'] },
      { id: 'b3', text: 'Docker deployment', skills: ['docker'] },
    ],
  },
];

describe('selectEntries', () => {
  it('ranks the entry with more JD-relevant skills first', () => {
    const picked = selectEntries(entries, ['machine learning', 'docker'], 2);
    expect(picked[0].id).toBe('e2');
  });

  it('honours the limit', () => {
    expect(selectEntries(entries, ['sql'], 1)).toHaveLength(1);
  });

  it('returns entries even when nothing matches, so the resume is never empty', () => {
    const picked = selectEntries(entries, ['rust'], 2);
    expect(picked).toHaveLength(2);
  });

  it('treats projects and internships equally when ranking', () => {
    expect(selectEntries(entries, ['docker'], 1)[0].kind).toBe('project');
  });
});

describe('selectBullets', () => {
  it('puts JD-matching bullets first', () => {
    const picked = selectBullets(entries[0], ['tableau'], 4);
    expect(picked[0].id).toBe('a3');
  });

  it('honours the limit', () => {
    expect(selectBullets(entries[0], ['sql'], 2)).toHaveLength(2);
  });

  it('includes non-matching bullets as filler when the limit allows', () => {
    expect(selectBullets(entries[0], ['sql'], 4).map((b) => b.id)).toContain('a4');
  });

  it('never returns more bullets than the entry has', () => {
    expect(selectBullets(entries[1], ['docker'], 99)).toHaveLength(3);
  });
});
