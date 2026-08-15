import type { AtsPlatform } from '../config/schema.js';
import type { SubmitAdapter } from './types.js';
import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { workableAdapter } from './workable.js';

const ADAPTERS: Partial<Record<AtsPlatform, SubmitAdapter>> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workable: workableAdapter,
};

export function adapterFor(platform: AtsPlatform): SubmitAdapter | null {
  return ADAPTERS[platform] ?? null;
}
