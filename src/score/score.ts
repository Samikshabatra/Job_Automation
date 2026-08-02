import { titleSimilarity } from '../normalize/title.js';
import { hasFresherSignal } from './extract.js';

export interface ScoreInput {
  title: string;
  jdSkills: string[];
  jdText: string;
  resumeSkills: string[];
  targetTitles: string[];
}

const WEIGHT_SKILLS = 60;
const WEIGHT_TITLE = 30;
const WEIGHT_FRESHER = 10;

export function scoreJob(input: ScoreInput, _threshold: number): number {
  const resume = new Set(input.resumeSkills.map((s) => s.toLowerCase()));
  const overlap = input.jdSkills.filter((s) => resume.has(s.toLowerCase())).length;
  const skillScore = input.jdSkills.length === 0 ? 0 : (overlap / input.jdSkills.length) * WEIGHT_SKILLS;

  const bestTitle = input.targetTitles.reduce(
    (best, t) => Math.max(best, titleSimilarity(input.title, t)), 0,
  );
  const titleScore = bestTitle * WEIGHT_TITLE;

  const fresherScore = hasFresherSignal(input.jdText) ? WEIGHT_FRESHER : 0;

  return Math.max(0, Math.min(100, Math.round(skillScore + titleScore + fresherScore)));
}
