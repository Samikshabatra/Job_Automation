import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { ZodType } from 'zod';
import {
  CriteriaSchema, CompaniesFileSchema, BlocklistFileSchema,
  type Criteria, type CompanyEntry, type BlockedCompany,
} from './schema.js';

function readYaml<T>(dir: string, file: string, schema: ZodType<T>, fallback?: T): T {
  const path = join(dir, file);
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing config file: ${file}`);
  }
  const parsed = schema.safeParse(parse(readFileSync(path, 'utf8')) ?? {});
  if (!parsed.success) {
    throw new Error(`Invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

export function loadCriteria(dir = 'config'): Criteria {
  return readYaml(dir, 'criteria.yaml', CriteriaSchema);
}

export function loadCompanies(dir = 'config'): CompanyEntry[] {
  return readYaml(dir, 'companies.yaml', CompaniesFileSchema, { companies: [] }).companies;
}

export function loadBlocklist(dir = 'config'): BlockedCompany[] {
  return readYaml(dir, 'blocklist.yaml', BlocklistFileSchema, { blocked: [] }).blocked;
}
