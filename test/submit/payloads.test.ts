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
    id: 1, fingerprint: 'fp', board_id: 1, source: 'lever', source_job_id: 'abc-123',
    url: 'https://jobs.lever.co/acme/abc-123', company: 'Acme',
    title: 'Data Analyst', norm_title: 'data analyst', location: 'Remote', norm_location: 'remote',
    posted_at: null, first_seen_at: '2026-08-01T00:00:00.000Z', jd_text: 'jd',
    ats_platform: 'lever', min_years: 0, match_score: 80, status: 'tailored',
    status_reason: null, resume_path: 'C:/resumes/a.pdf', submitted_at: null,
    created_at: '2026-08-01T00:00:00.000Z',
    ...over,
  } as JobRow;
}

describe('lever payload', () => {
  const payload = adapterFor('lever')!.buildPayload(job({}), profile, 'C:/resumes/a.pdf');

  it('targets the apply endpoint for the posting', () => {
    expect(payload.endpoint).toBe('https://jobs.lever.co/acme/abc-123/apply');
  });

  it('uses lever field names', () => {
    expect(payload.fields.name).toBe('Example Candidate');
    expect(payload.fields.email).toBe('example.apply@gmail.com');
    expect(payload.fields['urls[LinkedIn]']).toBe('https://linkedin.com/in/example');
  });

  it('attaches exactly one resume file', () => {
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0]!.field).toBe('resume');
  });

  it('never emits an empty email field', () => {
    expect(payload.fields.email).toBeTruthy();
  });
});

describe('adapterFor', () => {
  it('returns the lever adapter, the one HTTP path that remains', () => {
    expect(adapterFor('lever')).not.toBeNull();
  });

  /**
   * Each of these posted at something that cannot accept an application, and
   * none had ever produced one:
   *
   *   greenhouse  boards.greenhouse.io/{token}/jobs/{id} is a web page; it
   *               answers GET with a 301 to the employer's careers site
   *   ashby       flat multipart at a GraphQL endpoint, which rejects any
   *               request with no `query` body
   *   workable    the employer API, with no Authorization header
   *
   * Null is the contract that routes those jobs to the browser agent, so it is
   * worth asserting rather than leaving implicit.
   */
  it('returns null for the platforms that have no HTTP path', () => {
    for (const p of ['greenhouse', 'ashby', 'workable'] as const) {
      expect(adapterFor(p)).toBeNull();
    }
  });

  it('returns null for a platform it has never heard of', () => {
    expect(adapterFor('taleo' as never)).toBeNull();
  });
});
