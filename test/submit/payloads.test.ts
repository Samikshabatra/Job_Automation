import { describe, it, expect } from 'vitest';
import { adapterFor } from '../../src/submit/router.js';
import type { JobRow } from '../../src/db/types.js';
import type { Profile } from '../../src/tailor/resume.js';

const profile: Profile = {
  name: 'Example Candidate', email: 'example.apply@gmail.com',
  phone: '+91 90000 00000', location: 'Bengaluru, India',
  links: { linkedin: 'https://linkedin.com/in/example' },
};

function job(over: Partial<JobRow>): JobRow {
  return {
    id: 1, fingerprint: 'fp', board_id: 1, source: 'greenhouse', source_job_id: '4012345',
    url: 'https://boards.greenhouse.io/acme/jobs/4012345', company: 'Acme',
    title: 'Data Analyst', norm_title: 'data analyst', location: 'Remote', norm_location: 'remote',
    posted_at: null, first_seen_at: '2026-08-01T00:00:00.000Z', jd_text: 'jd',
    ats_platform: 'greenhouse', min_years: 0, match_score: 80, status: 'tailored',
    status_reason: null, resume_path: 'C:/resumes/a.pdf', submitted_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    ...over,
  } as JobRow;
}

describe('greenhouse payload', () => {
  const payload = adapterFor('greenhouse')!.buildPayload(job({}), profile, 'C:/resumes/a.pdf');

  it('targets the job-board application endpoint', () => {
    expect(payload.endpoint).toContain('greenhouse.io');
    expect(payload.endpoint).toContain('4012345');
  });

  it('splits the name into first and last', () => {
    expect(payload.fields.first_name).toBe('Example');
    expect(payload.fields.last_name).toBe('Candidate');
  });

  it('carries the applicant email and phone', () => {
    expect(payload.fields.email).toBe('example.apply@gmail.com');
    expect(payload.fields.phone).toBe('+91 90000 00000');
  });

  it('attaches the tailored resume', () => {
    expect(payload.files).toEqual([{ field: 'resume', path: 'C:/resumes/a.pdf' }]);
  });
});

describe('lever payload', () => {
  const leverJob = job({
    ats_platform: 'lever', source_job_id: 'abc-123',
    url: 'https://jobs.lever.co/beta/abc-123',
  });
  const payload = adapterFor('lever')!.buildPayload(leverJob, profile, 'C:/resumes/a.pdf');

  it('targets the lever apply endpoint for the posting', () => {
    expect(payload.endpoint).toBe('https://jobs.lever.co/beta/abc-123/apply');
  });

  it('uses lever field names', () => {
    expect(payload.fields.name).toBe('Example Candidate');
    expect(payload.fields.email).toBe('example.apply@gmail.com');
  });
});

describe('adapterFor', () => {
  it('returns an adapter for each supported platform', () => {
    for (const p of ['greenhouse', 'lever', 'ashby', 'workable'] as const) {
      expect(adapterFor(p)).not.toBeNull();
    }
  });

  it('returns null for an unsupported platform', () => {
    expect(adapterFor('taleo' as never)).toBeNull();
  });
});

describe('every adapter', () => {
  it('never emits an empty email field', () => {
    for (const p of ['greenhouse', 'lever', 'ashby', 'workable'] as const) {
      const payload = adapterFor(p)!.buildPayload(job({ ats_platform: p }), profile, 'C:/r.pdf');
      expect(payload.fields.email ?? payload.fields['cards[0][fields][0][value]']).toBeTruthy();
    }
  });

  it('always attaches exactly one resume file', () => {
    for (const p of ['greenhouse', 'lever', 'ashby', 'workable'] as const) {
      expect(adapterFor(p)!.buildPayload(job({ ats_platform: p }), profile, 'C:/r.pdf').files).toHaveLength(1);
    }
  });
});
