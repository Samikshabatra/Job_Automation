import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { SkillDict } from '../score/extract.js';

export const BulletSchema = z.object({
  id: z.string(),
  text: z.string().min(1),
  skills: z.array(z.string()).default([]),
});
export type Bullet = z.infer<typeof BulletSchema>;

export const ExperienceEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['internship', 'project', 'work', 'coursework']),
  org: z.string(),
  role: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(BulletSchema).min(1),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const ProfileSchema = z.object({
  name: z.string(),
  email: z.email(),
  phone: z.string(),
  location: z.string(),
  links: z.record(z.string(), z.string()).default({}),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const EducationEntrySchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string(),
  start: z.string(),
  end: z.string(),
  detail: z.string().default(''),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

export interface Resume {
  profile: Profile;
  experience: ExperienceEntry[];
  skills: SkillDict;
  education: EducationEntry[];
}

function readJson<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
  if (!parsed.success) {
    throw new Error(
      `Invalid ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}

export function loadResume(dir = 'resume'): Resume {
  return {
    profile: readJson(dir, 'profile.json', ProfileSchema),
    experience: readJson(dir, 'experience.json', z.array(ExperienceEntrySchema).min(1)),
    skills: readJson(dir, 'skills.json', z.record(z.string(), z.array(z.string()))),
    education: readJson(dir, 'education.json', z.array(EducationEntrySchema)),
  };
}

/** Every bullet across every entry — used by the anti-fabrication gate. */
export function allBullets(experience: ExperienceEntry[]): Bullet[] {
  return experience.flatMap((e) => e.bullets);
}
