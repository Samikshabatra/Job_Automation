CREATE TABLE IF NOT EXISTS company_boards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ats_platform   TEXT NOT NULL,
  board_token    TEXT NOT NULL,
  company_name   TEXT NOT NULL,
  discovered_via TEXT,
  discovered_at  TEXT NOT NULL,
  last_polled_at TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  UNIQUE (ats_platform, board_token)
);

CREATE TABLE IF NOT EXISTS jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint    TEXT UNIQUE NOT NULL,
  board_id       INTEGER REFERENCES company_boards(id),
  source         TEXT NOT NULL,
  source_job_id  TEXT,
  url            TEXT NOT NULL,
  company        TEXT NOT NULL,
  title          TEXT NOT NULL,
  norm_title     TEXT NOT NULL,
  location       TEXT,
  norm_location  TEXT,
  posted_at      TEXT,
  first_seen_at  TEXT NOT NULL,
  jd_text        TEXT,
  ats_platform   TEXT,
  min_years      INTEGER,
  match_score    REAL,
  status         TEXT NOT NULL DEFAULT 'new',
  status_reason  TEXT,
  resume_path    TEXT,
  submitted_at   TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);

-- NOTE: the `idx_jobs_source_identity` unique index is NOT created here. It
-- cannot be, on any database that predates it: the duplicate rows it forbids
-- already exist, so the CREATE would throw. `openDb` creates it after running
-- `dedupeBySourceId`. See src/db/index.ts.

CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL REFERENCES jobs(id),
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  applied_at    TEXT NOT NULL,
  method        TEXT NOT NULL,
  email_used    TEXT,
  outcome       TEXT NOT NULL DEFAULT 'awaiting',
  last_email_at TEXT,
  thread_ids    TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_apps_company ON applications(company);

-- One row per recruiting email we have seen. `gmail_msg_id` is UNIQUE so a
-- re-poll of an overlapping window is idempotent: Gmail is polled on a rolling
-- window, so the same message WILL be fetched more than once.
CREATE TABLE IF NOT EXISTS email_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER REFERENCES applications(id),
  gmail_msg_id   TEXT UNIQUE NOT NULL,
  thread_id      TEXT,
  received_at    TEXT NOT NULL,
  from_address   TEXT NOT NULL,
  from_domain    TEXT,
  subject        TEXT,
  classified_as  TEXT,
  confidence     REAL,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_application ON email_events(application_id);

CREATE TABLE IF NOT EXISTS source_health (
  source               TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_ok_at           TEXT,
  last_error_at        TEXT
);
