import { describe, it, expect } from 'vitest';
import { extractBody } from '../../src/track/gmail.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('extractBody', () => {
  it('reads a plain-text part', () => {
    expect(extractBody({ mimeType: 'text/plain', body: { data: b64('hello') } })).toBe('hello');
  });

  it('prefers plain text nested inside a multipart tree', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('the plain one') } },
        { mimeType: 'text/html', body: { data: b64('<p>the html one</p>') } },
      ],
    };
    expect(extractBody(payload)).toBe('the plain one');
  });

  it('falls back to HTML with tags stripped', () => {
    // Many ATS mails are HTML-only; abstaining on all of them would push every
    // one to the LLM and blow the call budget.
    const payload = { mimeType: 'text/html', body: { data: b64('<p>We regret to <b>inform</b> you</p>') } };
    expect(extractBody(payload)).toContain('We regret to');
  });

  it('returns empty string for an empty or missing payload', () => {
    expect(extractBody(undefined)).toBe('');
    expect(extractBody({})).toBe('');
  });
});
