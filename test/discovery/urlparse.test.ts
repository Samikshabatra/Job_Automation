import { describe, it, expect } from 'vitest';
import { parseApplyUrl } from '../../src/discovery/urlparse.js';

describe('parseApplyUrl — greenhouse', () => {
  it.each([
    'https://boards.greenhouse.io/acme/jobs/4012345',
    'https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc',
    'https://job-boards.greenhouse.io/acme/jobs/4012345',
  ])('parses %s', (url) => {
    expect(parseApplyUrl(url)).toEqual({ ats: 'greenhouse', token: 'acme', sourceJobId: '4012345' });
  });

  it('parses an embedded greenhouse url without a job id', () => {
    expect(parseApplyUrl('https://boards.greenhouse.io/acme'))
      .toEqual({ ats: 'greenhouse', token: 'acme', sourceJobId: null });
  });
});

describe('parseApplyUrl — lever', () => {
  it('parses a hosted posting url', () => {
    expect(parseApplyUrl('https://jobs.lever.co/beta/abc-123'))
      .toEqual({ ats: 'lever', token: 'beta', sourceJobId: 'abc-123' });
  });

  it('parses an apply sub-path', () => {
    expect(parseApplyUrl('https://jobs.lever.co/beta/abc-123/apply'))
      .toEqual({ ats: 'lever', token: 'beta', sourceJobId: 'abc-123' });
  });
});

describe('parseApplyUrl — ashby', () => {
  it('parses a job board url', () => {
    expect(parseApplyUrl('https://jobs.ashbyhq.com/gamma/job_01'))
      .toEqual({ ats: 'ashby', token: 'gamma', sourceJobId: 'job_01' });
  });
});

describe('parseApplyUrl — workable', () => {
  it('parses a subdomain url', () => {
    expect(parseApplyUrl('https://delta.workable.com/j/ABC123'))
      .toEqual({ ats: 'workable', token: 'delta', sourceJobId: 'ABC123' });
  });

  it('parses an apply.workable.com url', () => {
    expect(parseApplyUrl('https://apply.workable.com/delta/j/ABC123/'))
      .toEqual({ ats: 'workable', token: 'delta', sourceJobId: 'ABC123' });
  });
});

describe('parseApplyUrl — rejections', () => {
  it.each([
    'https://www.linkedin.com/jobs/view/12345',
    'https://example.com/careers',
    'https://boards.greenhouse.io/',
    'not a url at all',
    '',
  ])('returns null for %s', (url) => {
    expect(parseApplyUrl(url)).toBeNull();
  });

  it.each([
    'https://notgreenhouse.io/acme/jobs/1',
    'https://fakelever.co/beta/abc-123',
    'https://evilashbyhq.com/gamma/job_01',
    'https://phishworkable.com/j/ABC123',
  ])('does not treat %s as a matching ATS host', (url) => {
    expect(parseApplyUrl(url)).toBeNull();
  });
});
