import { describe, it, expect } from 'vitest';
import { fingerprint } from '../../src/normalize/fingerprint.js';

it('collapses equivalent postings to one fingerprint', () => {
  const a = fingerprint('Acme Corp', 'ML Engineer', 'Bangalore, India');
  const b = fingerprint('acme corp.', 'Machine Learning Engineer', 'Bengaluru');
  expect(a).toBe(b);
});

it('distinguishes different roles at the same company', () => {
  expect(fingerprint('Acme', 'Data Analyst', 'Remote'))
    .not.toBe(fingerprint('Acme', 'Data Engineer', 'Remote'));
});

it('distinguishes the same role at different companies', () => {
  expect(fingerprint('Acme', 'Data Analyst', 'Remote'))
    .not.toBe(fingerprint('Beta', 'Data Analyst', 'Remote'));
});

it('produces a stable 64-char hex digest', () => {
  expect(fingerprint('Acme', 'Data Analyst', null)).toMatch(/^[a-f0-9]{64}$/);
});
