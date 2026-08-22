import type { ExperienceEntry } from './resume.js';
import type { TailorResponse } from './llm.js';

/**
 * Content-token Jaccard a tailored bullet must retain against its source
 * bullet. Calibrated, not guessed: at 0.6 the live run rejected seven bullets
 * that were all faithful rewordings of real resume content, scoring 0.522 to
 * 0.586 against their source. 0.45 clears that band with headroom.
 *
 * Lowering this is narrower than it looks. Similarity is one of four
 * independent checks in `verifyNoFabrication` — invented figures, invented
 * proper nouns, and unknown entry/bullet ids each fail on their own regardless
 * of this value. So the floor governs how far a bullet may be REWORDED, not
 * whether a new employer, metric or technology can be introduced.
 */
const SIMILARITY_FLOOR = 0.45;

/**
 * Words that carry no claim. Dropping them stops the similarity score from
 * being spent on grammar: the prompt explicitly invites rewording ("YOU MAY:
 * reorder bullets, choose which to include, reword for keyword alignment"),
 * so `using` vs `utilizing` must not count as evidence of fabrication.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'from', 'as', 'that', 'this', 'it', 'its', 'into', 'across', 'via', 'per',
  'using', 'use', 'used', 'uses', 'utilizing', 'utilising', 'utilize', 'utilise',
  'including', 'include', 'included',
  'while', 'which', 'is', 'are', 'was', 'were', 'be', 'been', 'their', 'them',
]);

/**
 * en-GB / en-US pairs, listed explicitly. A generic `-ise` → `-ize` rule is
 * NOT safe: it also rewrites raise, precise, concise, promise, expertise.
 */
const SPELLING: Record<string, string> = {
  modelling: 'modeling', modelled: 'modeled',
  labelling: 'labeling', labelled: 'labeled',
  cancelled: 'canceled', travelling: 'traveling',
  analyse: 'analyze', analysed: 'analyzed', analysing: 'analyzing',
  optimise: 'optimize', optimised: 'optimized', optimising: 'optimizing',
  optimisation: 'optimization',
  organise: 'organize', organised: 'organized', organisation: 'organization',
  summarise: 'summarize', summarised: 'summarized', summarisation: 'summarization',
  visualise: 'visualize', visualised: 'visualized', visualisation: 'visualization',
  normalise: 'normalize', normalised: 'normalized', normalisation: 'normalization',
  standardise: 'standardize', standardised: 'standardized',
  prioritise: 'prioritize', prioritised: 'prioritized',
  categorise: 'categorize', categorised: 'categorized',
  minimise: 'minimize', minimised: 'minimized',
  maximise: 'maximize', maximised: 'maximized',
  utilise: 'utilize', utilised: 'utilized',
  colour: 'color', behaviour: 'behavior', centre: 'center', programme: 'program',
};

/** Expanded on BOTH sides, so "ML" and "machine learning" compare as equal. */
const ABBREVIATIONS: Record<string, string> = {
  ml: 'machine learning',
  dl: 'deep learning',
  nlp: 'natural language processing',
  ai: 'artificial intelligence',
  llm: 'large language model',
  llms: 'large language models',
  rag: 'retrieval augmented generation',
  eda: 'exploratory data analysis',
  etl: 'extract transform load',
};

/**
 * Suffixes stripped longest-first. Crude by design — this only has to make
 * "structure"/"structuring" and "retrieve"/"retrieving" agree, and a stem
 * match is still a real word match, so it does not loosen the gate. The
 * trailing bare `e` is what lets an -ing/-ed form meet its base form.
 */
const SUFFIXES = [
  'ational', 'ization', 'isation', 'ations', 'ation', 'ings', 'ing',
  'edly', 'ions', 'ion', 'ies', 'ed', 'es', 's', 'ly', 'e',
];

function stem(word: string): string {
  if (word.length <= 4) return word;
  for (const suffix of SUFFIXES) {
    if (!word.endsWith(suffix)) continue;
    if (word.length - suffix.length < 3) continue;
    let base = word.slice(0, word.length - suffix.length);
    // "running" -> "runn" -> "run"
    if (/([bdfglmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }
  return word;
}

function rawTokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Tokens with spelling, abbreviations and morphology normalized. */
function normalizedTokens(s: string): string[] {
  const out: string[] = [];
  for (const raw of rawTokens(s)) {
    const spelled = SPELLING[raw] ?? raw;
    const expanded = ABBREVIATIONS[spelled];
    if (expanded) out.push(...expanded.split(' ').map(stem));
    else out.push(stem(spelled));
  }
  return out;
}

/**
 * Stopwords must be compared in stemmed form too — `normalizedTokens` stems
 * before this filter runs, so a raw-form set would miss "including" once it
 * has already become "includ".
 */
const STOPWORD_STEMS = new Set([...STOPWORDS].map(stem));

/** Claim-bearing tokens only — what the similarity score is computed over. */
function contentTokens(s: string): Set<string> {
  return new Set(normalizedTokens(s).filter((t) => !STOPWORD_STEMS.has(t)));
}

/**
 * Content-token Jaccard between a tailored bullet and its source bullet —
 * the same number `verifyNoFabrication` compares against `SIMILARITY_FLOOR`.
 * Exported so the floor can be calibrated against real rejections instead of
 * guessed at.
 */
export function bulletSimilarity(tailored: string, source: string): number {
  return jaccard(tailored, source);
}

function jaccard(a: string, b: string): number {
  const A = contentTokens(a);
  const B = contentTokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) if (B.has(t)) intersection++;
  return intersection / (A.size + B.size - intersection);
}

/** Every number in the text, so an inflated metric can be caught. */
function numbers(s: string): string[] {
  return (s.match(/\d+(?:\.\d+)?\s*[kmb%]?/gi) ?? []).map((n) => n.toLowerCase().replace(/\s+/g, ''));
}

/**
 * Capitalized tokens that do not start a sentence — employers, products and
 * technologies (Google, TensorFlow, NumPy, Scikit-learn). Sentence-initial
 * words are skipped because their capital says nothing about what they are.
 */
function properNouns(text: string): string[] {
  const out: string[] = [];
  // The lookbehind is load-bearing: without it, the "M" inside a metric like
  // "12M" matches as its own capitalized token and gets reported as an
  // invented name, failing every bullet that carries a unit-suffixed number.
  const re = /(?<![A-Za-z0-9])[A-Z][A-Za-z0-9+#.\-]*/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const word = m[0].replace(/[.\-+#]+$/, '');
    if (!word) continue;
    // Only whitespace between this token and the start of the text, or a
    // sentence terminator, means it is sentence-initial.
    if (/(^|[.!?])\s*$/.test(text.slice(0, m.index))) continue;
    out.push(word);
  }
  return out;
}

export function verifyNoFabrication(
  res: TailorResponse, source: ExperienceEntry[], skills: string[] = [],
  jobTitle = '',
): { ok: boolean; offending: string[] } {
  const entryById = new Map(source.map((e) => [e.id, e]));
  const offending: string[] = [];

  // A name is "invented" only when it appears NOWHERE the candidate has
  // declared it: not in any bullet's text, not in any bullet's `skills`, and
  // not in the canonical skills list (skills.json). Tailoring reorders and
  // rewords bullets, so surfacing "SQL" in a bullet whose source text said
  // "relational databases" — but whose declared skills include sql — is
  // faithful, not fabrication. The per-bullet similarity and number checks
  // below stay per-bullet, so this only widens the allow-set for names.
  const allowedNames = new Set(
    normalizedTokens(
      source
        .flatMap((e) => [e.role, e.org, ...e.bullets.flatMap((b) => [b.text, ...(b.skills ?? [])])])
        .concat(skills)
        .join(' '),
    ),
  );

  for (const entry of res.entries) {
    const sourceEntry = entryById.get(entry.id);
    if (!sourceEntry) {
      offending.push(`unknown entry id "${entry.id}"`);
      continue;
    }
    const bulletById = new Map(sourceEntry.bullets.map((b) => [b.id, b]));

    for (const bullet of entry.bullets) {
      const sourceBullet = bulletById.get(bullet.id);
      if (!sourceBullet) {
        offending.push(`unknown bullet id "${bullet.id}"`);
        continue;
      }

      if (jaccard(bullet.text, sourceBullet.text) < SIMILARITY_FLOOR) {
        offending.push(bullet.text);
        continue;
      }

      const sourceNumbers = new Set(numbers(sourceBullet.text));
      const invented = numbers(bullet.text).filter((n) => !sourceNumbers.has(n));
      if (invented.length) {
        offending.push(`${bullet.text} (invented figures: ${invented.join(', ')})`);
        continue;
      }

      // A proper noun must be traceable to something the candidate declared —
      // any bullet's text or skills, or the canonical skills list.
      const newNames = properNouns(bullet.text).filter(
        (name) => !normalizedTokens(name).every((t) => allowedNames.has(t)),
      );
      if (newNames.length) {
        offending.push(`${bullet.text} (invented names: ${[...new Set(newNames)].join(', ')})`);
      }
    }
  }

  // The summary is free text the model writes from scratch, and it is printed
  // on the resume just like a bullet — but it is synthesized ACROSS entries,
  // so a per-bullet similarity floor cannot apply. Hold it to the checks that
  // do transfer: every figure and every name in it must be traceable to the
  // source material somewhere.
  if (res.summary.trim()) {
    const corpus = source.flatMap((e) => e.bullets.map((b) => b.text)).join(' ');
    const corpusNumbers = new Set(numbers(corpus));

    const inventedFigures = numbers(res.summary).filter((n) => !corpusNumbers.has(n));
    if (inventedFigures.length) {
      offending.push(`summary (invented figures: ${inventedFigures.join(', ')})`);
    }

    // The bullets' allow-set PLUS the words of the role being applied for.
    // A summary conventionally names its target role, and `properNouns` reads
    // any capitalized mid-sentence word as a name — so tailoring for
    // "Analytics Engineer - Finance" reported "Analytics" as invented purely
    // because that word appears nowhere in the resume.
    //
    // Deliberately the TITLE only, not the JD: a few words naming the role is
    // not a claim about the candidate's history, whereas admitting the whole
    // posting would let any technology it mentions pass unchallenged. And
    // deliberately summary-only — a BULLET claiming the target role's
    // vocabulary as work actually done is still fabrication, so the loop above
    // keeps the strict set.
    const allowedInSummary = new Set([...allowedNames, ...normalizedTokens(jobTitle)]);
    const inventedNames = properNouns(res.summary).filter(
      (name) => !normalizedTokens(name).every((t) => allowedInSummary.has(t)),
    );
    if (inventedNames.length) {
      offending.push(`summary (invented names: ${[...new Set(inventedNames)].join(', ')})`);
    }
  }

  return { ok: offending.length === 0, offending };
}
