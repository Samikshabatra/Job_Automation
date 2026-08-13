import type { Bullet, ExperienceEntry } from './resume.js';

function relevance(skills: string[], jdSkills: string[]): number {
  const wanted = new Set(jdSkills.map((s) => s.toLowerCase()));
  return skills.filter((s) => wanted.has(s.toLowerCase())).length;
}

export function selectEntries(
  experience: ExperienceEntry[], jdSkills: string[], limit: number,
): ExperienceEntry[] {
  return [...experience]
    .map((entry, index) => ({
      entry,
      index,
      score: entry.bullets.reduce((sum, b) => sum + relevance(b.skills, jdSkills), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.entry);
}

export function selectBullets(
  entry: ExperienceEntry, jdSkills: string[], limit: number,
): Bullet[] {
  return [...entry.bullets]
    .map((bullet, index) => ({ bullet, index, score: relevance(bullet.skills, jdSkills) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.bullet);
}
