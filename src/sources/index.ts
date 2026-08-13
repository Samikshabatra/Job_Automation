import type { AtsPlatform } from '../config/schema.js';
import type { JobSource } from './types.js';
import { greenhouseSource } from './greenhouse.js';
import { leverSource } from './lever.js';
import { ashbySource } from './ashby.js';
import { workableSource } from './workable.js';

const SOURCES: Record<AtsPlatform, JobSource> = {
  greenhouse: greenhouseSource,
  lever: leverSource,
  ashby: ashbySource,
  workable: workableSource,
};

export function sourceFor(platform: AtsPlatform): JobSource {
  return SOURCES[platform];
}

export const ALL_SOURCES = Object.values(SOURCES);
