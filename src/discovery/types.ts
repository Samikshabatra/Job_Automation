import type { Criteria } from '../config/schema.js';
import type { DiscoveryHit } from './register.js';

export interface DiscoveryResult {
  hits: DiscoveryHit[];
  ok: boolean;
  error?: string;
}

export interface DiscoverySource {
  name: string;
  search(queries: string[], criteria: Criteria): Promise<DiscoveryResult>;
}
