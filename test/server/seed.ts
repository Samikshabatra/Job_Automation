import { openDb, type Database } from '../../src/db/index.js';

/**
 * A database seeded with a known, deliberately lopsided fixture: enough rows
 * in enough states that a query which ignores its filters produces a visibly
 * wrong number rather than an accidentally right one.
 */
export function seedDb(): Database {
  const db = openDb(':memory:');

  const board = db.prepare(
    `INSERT INTO company_boards (ats_platform, board_token, company_name, discovered_via, discovered_at, active)
     VALUES ('greenhouse', 'razorpay', 'Razorpay', 'seed', '2026-08-01T00:00:00Z', 1)`,
  ).run();
  const boardId = Number(board.lastInsertRowid);

  const insertJob = db.prepare(
    `INSERT INTO jobs (fingerprint, board_id, source, source_job_id, url, company, title,
       norm_title, location, norm_location, posted_at, first_seen_at, jd_text, ats_platform,
       min_years, match_score, status, status_reason, resume_path, submitted_at, created_at)
     VALUES (@fingerprint, @boardId, @source, @sourceJobId, @url, @company, @title,
       @normTitle, @location, @normLocation, @postedAt, @firstSeenAt, @jdText, @atsPlatform,
       @minYears, @matchScore, @status, null, null, @submittedAt, @createdAt)`,
  );

  const jobs = [
    { company: 'Razorpay',  title: 'Backend Engineer',  source: 'greenhouse', location: 'Bengaluru, India',  score: 92, status: 'submitted', day: '2026-08-26' },
    { company: 'Microsoft', title: 'Software Engineer', source: 'lever',      location: 'Hyderabad, India',  score: 88, status: 'submitted', day: '2026-08-26' },
    { company: 'Swiggy',    title: 'Senior Backend',    source: 'lever',      location: 'Bengaluru, India',  score: 85, status: 'tailored',  day: '2026-08-26' },
    { company: 'Adobe',     title: 'ML Engineer',       source: 'greenhouse', location: 'Noida, India',      score: 81, status: 'tailored',  day: '2026-08-25' },
    { company: 'Zomato',    title: 'Software Engineer', source: 'greenhouse', location: 'Gurgaon, India',    score: 64, status: 'scored',    day: '2026-08-25' },
    { company: 'Paytm',     title: 'Backend Engineer',  source: 'lever',      location: 'Noida, India',      score: 61, status: 'held',      day: '2026-08-24' },
    { company: 'Flipkart',  title: 'SDE II',            source: 'ashby',      location: 'Bengaluru, India',  score: 44, status: 'skipped',   day: '2026-08-24' },
    { company: 'CRED',      title: 'Software Engineer', source: 'greenhouse', location: 'Mumbai, India',     score: 21, status: 'skipped',   day: '2026-08-20' },
    { company: 'Amazon',    title: 'SDE II',            source: 'ashby',      location: 'Bengaluru, India',  score: 77, status: 'new',       day: '2026-08-26' },
  ];

  jobs.forEach((j, i) => {
    insertJob.run({
      fingerprint: `fp-${i}`,
      boardId,
      source: j.source,
      sourceJobId: `src-${i}`,
      url: `https://example.test/job/${i}`,
      company: j.company,
      title: j.title,
      normTitle: j.title.toLowerCase(),
      location: j.location,
      normLocation: j.location.split(',')[0]!.toLowerCase(),
      postedAt: `${j.day}T00:00:00Z`,
      firstSeenAt: `${j.day}T09:00:00Z`,
      jdText: `We are looking for a ${j.title} at ${j.company}. Python, SQL, AWS.`,
      atsPlatform: j.source === 'ashby' ? 'ashby' : j.source === 'lever' ? 'lever' : 'greenhouse',
      minYears: 3,
      matchScore: j.score,
      status: j.status,
      submittedAt: j.status === 'submitted' ? `${j.day}T10:00:00Z` : null,
      createdAt: `${j.day}T09:00:00Z`,
    });
  });

  const insertApp = db.prepare(
    `INSERT INTO applications (job_id, company, title, applied_at, method, email_used, outcome, last_email_at, thread_ids)
     VALUES (@jobId, @company, @title, @appliedAt, @method, null, @outcome, @lastEmailAt, '[]')`,
  );
  insertApp.run({ jobId: 1, company: 'Razorpay',  title: 'Backend Engineer',  appliedAt: '2026-08-26T10:00:00Z', method: 'agent', outcome: 'interview',    lastEmailAt: '2026-08-26T12:00:00Z' });
  insertApp.run({ jobId: 2, company: 'Microsoft', title: 'Software Engineer', appliedAt: '2026-08-26T10:30:00Z', method: 'api',   outcome: 'rejected',     lastEmailAt: '2026-08-26T13:00:00Z' });

  const insertEvent = db.prepare(
    `INSERT INTO email_events (application_id, gmail_msg_id, thread_id, received_at, from_address,
       from_domain, subject, classified_as, confidence, created_at)
     VALUES (@applicationId, @msgId, 't1', @receivedAt, 'talent@acme.test', 'acme.test',
       @subject, @classifiedAs, 0.9, @receivedAt)`,
  );
  insertEvent.run({ applicationId: 1, msgId: 'm1', receivedAt: '2026-08-26T12:00:00Z', subject: 'Interview invitation', classifiedAs: 'interview' });
  insertEvent.run({ applicationId: 2, msgId: 'm2', receivedAt: '2026-08-26T13:00:00Z', subject: 'Application update',   classifiedAs: 'rejected' });

  return db;
}
