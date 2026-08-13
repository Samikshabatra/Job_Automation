import type { DiscoverySource } from './types.js';
import { adzunaSource } from './adzuna.js';
import { hnSource } from './hn.js';
import { remotiveSource } from './remotive.js';
import { linkedinSource } from './linkedin.js';

export const ALL_DISCOVERY: DiscoverySource[] = [
  adzunaSource, hnSource, remotiveSource, linkedinSource,
];
