import type { AtsPlatform } from '../config/schema.js';
import type { BoardRow } from '../db/types.js';

export interface RawJob {
  sourceJobId: string;
  url: string;
  company: string;
  title: string;
  location: string | null;
  postedAt: string | null;
  jdText: string;
  atsPlatform: AtsPlatform;
}

export interface SourceResult {
  jobs: RawJob[];
  ok: boolean;
  error?: string;
}

export interface JobSource {
  name: string;
  platform: AtsPlatform;
  fetchJobs(board: BoardRow): Promise<SourceResult>;
}
