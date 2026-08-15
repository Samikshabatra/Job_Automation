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

CREATE TABLE IF NOT EXISTS source_health (
  source               TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_ok_at           TEXT,
  last_error_at        TEXT
);
