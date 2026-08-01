import { z } from 'zod';

export const AtsPlatform = z.enum(['greenhouse', 'lever', 'ashby', 'workable']);
export type AtsPlatform = z.infer<typeof AtsPlatform>;

export const CriteriaSchema = z.object({
  titles: z.object({
    include: z.array(z.string()).min(1),
    exclude: z.array(z.string()).default([]),
  }),
  experience: z.object({
    max_years_required: z.number().int().min(0),
  }),
  locations: z.object({
    include: z.array(z.string()).min(1),
  }),
  freshness: z.object({
    max_posted_age_days: z.number().int().positive(),
    verify_open_before_submit: z.boolean().default(true),
  }),
  scoring: z.object({
    threshold: z.number().min(0).max(100),
  }),
  limits: z.object({
    daily_cap: z.number().int().positive(),
    per_company_open_applications: z.number().int().positive(),
    min_delay_seconds: z.number().int().nonnegative(),
    max_delay_seconds: z.number().int().positive(),
  }),
  submission: z
    .object({ dry_run: z.boolean().default(true) })
    .default({ dry_run: true }),
});
export type Criteria = z.infer<typeof CriteriaSchema>;

export const CompanyEntrySchema = z.object({
  name: z.string().min(1),
  paused: z.boolean().default(false),
  ats: AtsPlatform.optional(),
  token: z.string().optional(),
});
export type CompanyEntry = z.infer<typeof CompanyEntrySchema>;

export const CompaniesFileSchema = z.object({
  companies: z.array(CompanyEntrySchema).default([]),
});

export const BlockedCompanySchema = z.object({
  name: z.string().min(1),
  reason: z.string().default(''),
});
export type BlockedCompany = z.infer<typeof BlockedCompanySchema>;

export const BlocklistFileSchema = z.object({
  blocked: z.array(BlockedCompanySchema).default([]),
});
