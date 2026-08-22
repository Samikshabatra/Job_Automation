import { describe, it, expect } from 'vitest';
import { buildClassifyPrompt, parseOutcome } from '../../src/run/inbox.js';

const email = {
  id: 'm1', threadId: 't1', receivedAt: '2026-08-05T09:00:00Z',
  from: 'careers@phonepe.com', subject: 'Update', body: 'x'.repeat(5000),
};

describe('buildClassifyPrompt', () => {
  it('truncates the body so an LLM call stays cheap', () => {
    const prompt = buildClassifyPrompt(email);
    expect(prompt.length).toBeLessThan(1200);
    expect(prompt).toContain('careers@phonepe.com');
  });
});

describe('parseOutcome', () => {
  it('accepts the four real outcomes', () => {
    for (const w of ['rejected', 'interview', 'screening', 'acknowledged']) {
      expect(parseOutcome(w)).toBe(w);
    }
  });

  it('tolerates whitespace, case and stray punctuation', () => {
    expect(parseOutcome('  Interview.\n')).toBe('interview');
  });

  it('returns null for "none" and for anything unrecognised', () => {
    // A model that answers with a sentence must not be read as a verdict.
    expect(parseOutcome('none')).toBeNull();
    expect(parseOutcome('I think this is probably a rejection')).toBeNull();
  });
});
