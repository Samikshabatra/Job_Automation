import type { AtsPlatform } from '../config/schema.js';

export type JobStatus =
  | 'new' | 'scored' | 'tailored' | 'queued' | 'submitted'
  | 'failed' | 'skipped' | 'held' | 'deferred' | 'stale' | 'closed';

export interface NewJob {
  fingerprint: string;
  boardId: number | null;
  source: string;
  sourceJobId: string | null;
  url: string;
  company: string;
  title: string;
  normTitle: string;
  location: string | null;
  normLocation: string | null;
  postedAt: string | null;
  jdText: string | null;
  atsPlatform: AtsPlatform | null;
}

export interface JobRow {
  id: number;
  fingerprint: string;
  board_id: number | null;
  source: string;
  source_job_id: string | null;
  url: string;
  company: string;
  title: string;
  norm_title: string;
  location: string | null;
  norm_location: string | null;
  posted_at: string | null;
  first_seen_at: string;
  jd_text: string | null;
  ats_platform: AtsPlatform | null;
  min_years: number | null;
  match_score: number | null;
  status: JobStatus;
  status_reason: string | null;
  resume_path: string | null;
  submitted_at: string | null;
  created_at: string;
}

export interface NewBoard {
  atsPlatform: AtsPlatform;
  boardToken: string;
  companyName: string;
  discoveredVia: string;
}

export interface BoardRow {
  id: number;
  ats_platform: AtsPlatform;
  board_token: string;
  company_name: string;
  discovered_via: string | null;
  discovered_at: string;
  last_polled_at: string | null;
  active: number;
}

export interface NewApplication {
  jobId: number;
  company: string;
  title: string;
  method: 'api' | 'agent' | 'manual';
  emailUsed: string | null;
}
