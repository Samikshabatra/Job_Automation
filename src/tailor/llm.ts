import { z } from 'zod';
import type { ExperienceEntry } from './resume.js';
import { selectBullets } from './select.js';

export type LlmCall = (prompt: string) => Promise<string>;

export class TailorError extends Error {}

export interface TailorRequest {
  jdSkills: string[];
  jobTitle: string;
  entries: ExperienceEntry[];
}

const TailorResponseSchema = z.object({
  entries: z.array(z.object({
    id: z.string(),
    bullets: z.array(z.object({ id: z.string(), text: z.string().min(1) })).min(1),
  })).min(1),
  summary: z.string().default(''),
});
export type TailorResponse = z.infer<typeof TailorResponseSchema>;

const MAX_BULLETS_PER_ENTRY = 8;

export function buildPrompt(req: TailorRequest): string {
  const entries = req.entries.map((e) => ({
    id: e.id,
    role: e.role,
    org: e.org,
    bullets: selectBullets(e, req.jdSkills, MAX_BULLETS_PER_ENTRY)
      .map((b) => ({ id: b.id, text: b.text })),
  }));

  return `You are tailoring an existing resume to a job posting.

TARGET ROLE: ${req.jobTitle}
JOB KEYWORDS: ${req.jdSkills.join(', ')}

CANDIDATE BULLETS (the only material you may use):
${JSON.stringify(entries, null, 2)}

YOUR TASK
Select and order the bullets that best match the job keywords, and reword them
to surface that terminology naturally.

YOU MAY: reorder bullets, choose which to include, reword for keyword alignment.
YOU MAY NOT invent employers, job titles, dates, metrics, numbers, or skills.
Every bullet you return must keep the id of the bullet it came from and must
remain a faithful restatement of that bullet. Do not change any number.

Return ONLY valid JSON in exactly this shape, with no markdown fences:
{"entries":[{"id":"<entry id>","bullets":[{"id":"<bullet id>","text":"<reworded>"}]}],"summary":"<2-line professional summary built only from the above>"}`;
}

function stripFences(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new TailorError('GEMINI_API_KEY is not set');
  // gemini-2.5-flash is listed by ListModels but 404s for keys created after
  // its retirement, so the default has to be a currently-servable model.
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) throw new TailorError(`Gemini HTTP ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new TailorError('Gemini returned no text');
  return text;
}

export async function tailor(
  req: TailorRequest, deps: { call?: LlmCall } = {},
): Promise<TailorResponse> {
  const call = deps.call ?? callGemini;
  const prompt = buildPrompt(req);
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await call(attempt === 1 ? prompt : `${prompt}\n\nYour previous reply was rejected: ${lastError}\nReturn ONLY the JSON object.`);
    try {
      const parsed = TailorResponseSchema.safeParse(JSON.parse(stripFences(raw)));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  throw new TailorError(`Tailoring failed after 2 attempts: ${lastError}`);
}
