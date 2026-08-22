import { describe, it, expect } from 'vitest';
import { classifyEmail, RULE_CONFIDENCE } from '../../src/track/classify.js';

const sub = (subject: string, body = '') => classifyEmail({ subject, body });

describe('classifyEmail', () => {
  it('reads a rejection', () => {
    expect(sub('Your application to Acme').outcome).toBe(null);
    expect(sub('Update', 'Unfortunately we will not be moving forward').outcome).toBe('rejected');
    expect(sub('We regret to inform you').outcome).toBe('rejected');
    expect(sub('Update', 'we have decided not to proceed with your application').outcome).toBe('rejected');
  });

  it('reads an interview invitation', () => {
    expect(sub('Interview invitation - Data Analyst').outcome).toBe('interview');
    expect(sub('Next steps', 'Please share your availability for a call').outcome).toBe('interview');
    expect(sub('Lets schedule a chat').outcome).toBe('interview');
  });

  it('reads a screening or assessment', () => {
    expect(sub('Coding challenge for your application').outcome).toBe('screening');
    expect(sub('Online assessment link inside').outcome).toBe('screening');
    expect(sub('Take-home exercise').outcome).toBe('screening');
  });

  it('reads an acknowledgement', () => {
    expect(sub('We received your application').outcome).toBe('acknowledged');
    expect(sub('Thank you for applying to Acme').outcome).toBe('acknowledged');
    expect(sub('Your application has been received').outcome).toBe('acknowledged');
  });

  it('rejects BEFORE it looks for interview words', () => {
    // The single most common misclassification: a rejection that mentions the
    // interview it is declining to offer. Ordering is the whole defence.
    const r = sub(
      'Update on your application',
      'Unfortunately we will not be moving forward to the interview stage. '
      + 'We will not be scheduling a call.',
    );
    expect(r.outcome).toBe('rejected');
  });

  it('does not mistake an offer of availability in a rejection for an interview', () => {
    const r = sub('Application update', 'We regret to inform you. Happy to share feedback if you have availability.');
    expect(r.outcome).toBe('rejected');
  });

  it('returns null when no rule matches, so the LLM can decide', () => {
    const r = sub('Quick question about your background', 'Saw your profile and wanted to reach out.');
    expect(r.outcome).toBe(null);
    expect(r.confidence).toBe(0);
  });

  it('reports rule confidence when it matches', () => {
    expect(sub('We regret to inform you').confidence).toBe(RULE_CONFIDENCE);
  });

  it('is case and punctuation insensitive', () => {
    expect(sub('UNFORTUNATELY, we will not proceed').outcome).toBe('rejected');
    expect(sub('interview INVITATION').outcome).toBe('interview');
  });

  it('ignores a quoted signature block that echoes our own words', () => {
    // Our own application confirmation is often quoted underneath a reply.
    const r = sub('Re: Data Analyst', 'Interview invitation attached.\n\n> Thank you for applying to Acme');
    expect(r.outcome).toBe('interview');
  });
});
