import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { updateSettings, getSettings, isDryRun, SettingsError } from '../../server/settings.js';
import { loadCriteria } from '../../src/config/load.js';

const SOURCE = readFileSync('config/criteria.yaml', 'utf8');

describe('settings', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobpilot-cfg-'));
    writeFileSync(join(dir, 'criteria.yaml'), SOURCE, 'utf8');
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('writes an allowed setting', () => {
    updateSettings({ 'scoring.threshold': 65 }, dir);
    expect(loadCriteria(dir).scoring.threshold).toBe(65);
  });

  it('preserves keys the zod schema does not model', () => {
    // criteria.yaml carries browser_enabled, confidence_threshold and the
    // optimizer block. Round-tripping through CriteriaSchema would strip all
    // three, silently disarming the apply agent's own settings.
    updateSettings({ 'scoring.threshold': 65 }, dir);
    const doc = parse(readFileSync(join(dir, 'criteria.yaml'), 'utf8'));
    expect(doc.submission.browser_enabled).toBe(true);
    expect(doc.submission.confidence_threshold).toBe(0.85);
    expect(doc.optimizer.max_repair_attempts).toBe(3);
  });

  it('refuses a setting that is not on the whitelist', () => {
    expect(() => updateSettings({ 'titles.include': ['anything'] }, dir)).toThrow(SettingsError);
    expect(() => updateSettings({ 'optimizer.max_repair_attempts': 99 }, dir)).toThrow(/not an editable setting/);
  });

  it('refuses an out-of-range value', () => {
    expect(() => updateSettings({ 'scoring.threshold': 500 }, dir)).toThrow(/invalid value/);
    expect(() => updateSettings({ 'limits.daily_cap': 0 }, dir)).toThrow(/invalid value/);
    expect(() => updateSettings({ 'limits.daily_cap': 2.5 }, dir)).toThrow(/invalid value/);
  });

  it('refuses a wrongly typed value', () => {
    expect(() => updateSettings({ 'submission.dry_run': 'false' }, dir)).toThrow(/invalid value/);
  });

  it('leaves the file untouched when a patch is rejected', () => {
    const before = readFileSync(join(dir, 'criteria.yaml'), 'utf8');
    expect(() => updateSettings({ 'scoring.threshold': 500 }, dir)).toThrow();
    expect(readFileSync(join(dir, 'criteria.yaml'), 'utf8')).toBe(before);
  });

  it('refuses a delay window that is inside out', () => {
    expect(() => updateSettings({ 'limits.min_delay_seconds': 300 }, dir))
      .toThrow(/cannot exceed/);
  });

  it('applies several settings in one call', () => {
    updateSettings({ 'scoring.threshold': 70, 'limits.daily_cap': 12 }, dir);
    const c = loadCriteria(dir);
    expect(c.scoring.threshold).toBe(70);
    expect(c.limits.daily_cap).toBe(12);
  });

  it('rejects an empty patch rather than rewriting the file for nothing', () => {
    expect(() => updateSettings({}, dir)).toThrow(/no settings/);
  });

  describe('isDryRun', () => {
    it('reads the configured value', () => {
      expect(isDryRun(dir)).toBe(true);
      updateSettings({ 'submission.dry_run': false }, dir);
      expect(isDryRun(dir)).toBe(false);
    });

    it('treats a missing switch as dry-run', () => {
      // The safe reading of an absent safety switch is "engaged".
      writeFileSync(join(dir, 'criteria.yaml'), SOURCE.replace(/^\s*dry_run:.*$/m, ''), 'utf8');
      expect(isDryRun(dir)).toBe(true);
    });
  });

  it('reports which settings are editable and which are dangerous', () => {
    const s = getSettings(dir);
    expect(s.editable).toContain('scoring.threshold');
    expect(s.dangerous).toContain('submission.dry_run');
  });
});
