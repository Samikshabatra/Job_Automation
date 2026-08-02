import { describe, it, expect } from 'vitest';
import { scoreJob } from '../../src/score/score.js';

const resumeSkills = ['python', 'sql', 'pandas', 'machine learning', 'tableau'];

const base = {
  title: 'Data Analyst',
  jdSkills: ['python', 'sql', 'tableau'],
  jdText: 'Analyse data with Python and SQL.',
  targetTitles: ['data analyst', 'data engineer'],
};

describe('scoreJob', () => {
  it('scores full skill overlap and an exact title match near 100', () => {
    expect(scoreJob({ ...base, resumeSkills }, 60)).toBeGreaterThanOrEqual(90);
  });

  it('scores zero skill overlap low', () => {
    const s = scoreJob({ ...base, jdSkills: ['rust', 'kubernetes', 'terraform'], resumeSkills }, 60);
    expect(s).toBeLessThan(60);
  });

  it('adds weight for an explicit fresher signal', () => {
    const plain = scoreJob({ ...base, resumeSkills }, 60);
    const fresher = scoreJob({ ...base, resumeSkills, jdText: 'Freshers welcome. Python and SQL.' }, 60);
    expect(fresher).toBeGreaterThan(plain);
  });

  it('never exceeds 100', () => {
    expect(scoreJob({
      ...base, resumeSkills, jdText: 'Freshers welcome, entry level, new grad. Python SQL Tableau.',
    }, 60)).toBeLessThanOrEqual(100);
  });

  it('never returns a negative score', () => {
    expect(scoreJob({
      title: 'Quantum Chemist', jdSkills: [], jdText: '', targetTitles: ['data analyst'], resumeSkills: [],
    }, 60)).toBeGreaterThanOrEqual(0);
  });

  it('rewards a closer title match', () => {
    const near = scoreJob({ ...base, resumeSkills, title: 'Data Analyst' }, 60);
    const far = scoreJob({ ...base, resumeSkills, title: 'Data Analyst Intern Trainee Associate' }, 60);
    expect(near).toBeGreaterThan(far);
  });
});
