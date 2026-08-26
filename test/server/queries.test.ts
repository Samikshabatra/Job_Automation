import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Database } from '../../src/db/index.js';
import { seedDb } from './seed.js';
import { getOverview } from '../../server/queries/overview.js';
import { listJobs, getJobDetail, getJobFacets, LOCATION_FACET_LIMIT } from '../../server/queries/jobs.js';
import { getPipelineBoard } from '../../server/queries/pipeline.js';
import { listApplications } from '../../server/queries/applications.js';
import { getTracking } from '../../server/queries/tracking.js';
import { getReports } from '../../server/queries/reports.js';

const TODAY = '2026-08-26';

describe('query layer', () => {
  let db: Database;
  beforeEach(() => { db = seedDb(); });
  afterEach(() => { db.close(); });

  describe('getOverview', () => {
    it('counts every job as discovered and only threshold-passing ones as qualified', () => {
      const o = getOverview(db, { threshold: 50, today: TODAY });
      expect(o.stats.discovered).toBe(9);
      // 92, 88, 85, 81, 64, 61, 77 are >= 50. 44 and 21 are not.
      expect(o.stats.qualified).toBe(7);
    });

    it('counts applications sent from the applications table, not job status', () => {
      const o = getOverview(db, { threshold: 50, today: TODAY });
      expect(o.stats.applied).toBe(2);
    });

    it('counts responses as applications an employer actually replied to', () => {
      const o = getOverview(db, { threshold: 50, today: TODAY });
      expect(o.stats.responses).toBe(2);
    });

    it('reports a today-delta that excludes older rows', () => {
      const o = getOverview(db, { threshold: 50, today: TODAY });
      // first_seen_at on 2026-08-26: Razorpay, Microsoft, Swiggy, Amazon.
      expect(o.stats.discoveredToday).toBe(4);
    });

    it('builds a pipeline stepper covering every stage', () => {
      const o = getOverview(db, { threshold: 50, today: TODAY });
      expect(o.pipeline.map((s) => s.key)).toEqual([
        'discovery', 'normalize', 'score', 'tailor', 'apply', 'track',
      ]);
    });
  });

  describe('listJobs', () => {
    it('returns every job when unfiltered', () => {
      expect(listJobs(db, {}).total).toBe(9);
    });

    it('filters by source', () => {
      const r = listJobs(db, { source: 'lever' });
      expect(r.total).toBe(3);
      expect(r.rows.every((j) => j.source === 'lever')).toBe(true);
    });

    it('filters by location substring, case-insensitively', () => {
      // Razorpay, Swiggy, Flipkart, Amazon. The fixture stores "Bengaluru"
      // capitalised, so a match here proves the filter is case-insensitive.
      const r = listJobs(db, { location: 'bengaluru' });
      expect(r.total).toBe(4);
    });

    it('filters by minimum score', () => {
      expect(listJobs(db, { minScore: 80 }).total).toBe(4);
    });

    it('searches title and company together', () => {
      expect(listJobs(db, { q: 'razorpay' }).total).toBe(1);
      expect(listJobs(db, { q: 'backend' }).total).toBe(3);
    });

    it('paginates without losing the unfiltered total', () => {
      const r = listJobs(db, { limit: 2, offset: 0 });
      expect(r.rows).toHaveLength(2);
      expect(r.total).toBe(9);
    });

    it('sorts by score descending by default so the best job is first', () => {
      expect(listJobs(db, {}).rows[0]!.company).toBe('Razorpay');
    });

    it('combines filters rather than letting the last one win', () => {
      // lever AND >= 86 is Microsoft alone; either filter on its own returns more.
      const r = listJobs(db, { source: 'lever', minScore: 86 });
      expect(r.total).toBe(1);
      expect(r.rows[0]!.company).toBe('Microsoft');
    });
  });

  describe('getJobFacets', () => {
    it('offers the sources and statuses actually present', () => {
      const f = getJobFacets(db);
      expect(f.sources).toEqual(['ashby', 'greenhouse', 'lever']);
      expect(f.statuses).toContain('submitted');
    });

    it('ranks locations by how many jobs are in them', () => {
      // The real database holds 800+ raw location strings, many of them junk a
      // board wrote into its own field. The filter must offer the common ones,
      // not every variant.
      const locations = getJobFacets(db).locations;
      expect(locations[0]!.value).toBe('bengaluru');
      expect(locations[0]!.count).toBe(4);
    });

    it('caps the location list so the dropdown stays usable', () => {
      expect(getJobFacets(db).locations.length).toBeLessThanOrEqual(LOCATION_FACET_LIMIT);
    });
  });

  describe('getJobDetail', () => {
    it('returns the job with its description', () => {
      const d = getJobDetail(db, 1);
      expect(d?.company).toBe('Razorpay');
      expect(d?.jd_text).toContain('Backend Engineer');
    });

    it('returns null for an unknown id rather than throwing', () => {
      expect(getJobDetail(db, 99999)).toBe(null);
    });
  });

  describe('getPipelineBoard', () => {
    it('buckets jobs into the five board columns', () => {
      const b = getPipelineBoard(db);
      const counts = Object.fromEntries(b.map((c) => [c.key, c.count]));
      expect(counts.discovered).toBe(1); // new
      expect(counts.scored).toBe(1);     // scored
      expect(counts.tailoring).toBe(2);  // tailored
      expect(counts.review).toBe(1);     // held
      expect(counts.applied).toBe(2);    // submitted
    });

    it('leaves skipped jobs off the board entirely', () => {
      const all = getPipelineBoard(db).flatMap((c) => c.cards.map((x) => x.company));
      expect(all).not.toContain('CRED');
    });
  });

  describe('listApplications', () => {
    it('joins outcome and latest email subject onto each application', () => {
      const r = listApplications(db, {});
      expect(r.total).toBe(2);
      const razorpay = r.rows.find((a) => a.company === 'Razorpay')!;
      expect(razorpay.outcome).toBe('interview');
      expect(razorpay.latest_subject).toBe('Interview invitation');
    });

    it('filters by outcome', () => {
      expect(listApplications(db, { outcome: 'rejected' }).total).toBe(1);
    });
  });

  describe('getTracking', () => {
    it('counts responses, positives, interviews and offers separately', () => {
      const t = getTracking(db);
      expect(t.stats.total).toBe(2);
      expect(t.stats.interviews).toBe(1);
      expect(t.stats.offers).toBe(0);
      // positive = screening, interview or offer. Rejections do not count.
      expect(t.stats.positive).toBe(1);
    });

    it('lists recent responses newest first', () => {
      expect(getTracking(db).recent[0]!.subject).toBe('Application update');
    });
  });

  describe('getReports', () => {
    it('computes rates against the number of applications', () => {
      const r = getReports(db);
      expect(r.rates.responseRate).toBe(100); // 2 of 2 got a reply
      expect(r.rates.interviewRate).toBe(50); // 1 of 2
      expect(r.rates.offerRate).toBe(0);
    });

    it('returns zero rates rather than NaN when nothing has been applied to', () => {
      const empty = seedDb();
      empty.prepare('DELETE FROM email_events').run();
      empty.prepare('DELETE FROM applications').run();
      const r = getReports(empty);
      expect(r.rates.responseRate).toBe(0);
      expect(r.rates.interviewRate).toBe(0);
      expect(Number.isNaN(r.rates.offerRate)).toBe(false);
      empty.close();
    });

    it('breaks applications down by status for the donut', () => {
      const byStatus = Object.fromEntries(getReports(db).byStatus.map((s) => [s.name, s.value]));
      expect(byStatus.interview).toBe(1);
      expect(byStatus.rejected).toBe(1);
    });
  });
});
