/**
 * Rule-first classification of a recruiting email.
 *
 * Cost is the whole point of the ordering here: the roadmap budgets ~5 LLM
 * calls a day for the inbox, so the rules must catch the ordinary cases and
 * hand over only what is genuinely ambiguous. `classifyEmail` returning
 * `null` is the signal to spend a call.
 */

export type Outcome = 'rejected' | 'offer' | 'interview' | 'screening' | 'acknowledged';

export interface EmailInput {
  subject: string;
  body: string;
}

export interface Classification {
  outcome: Outcome | null;
  confidence: number;
}

/**
 * Confidence attached to a rule hit. Not 1.0: these are keyword rules on free
 * text, and the tracker should be able to tell a rule verdict apart from an
 * LLM one when they disagree.
 */
export const RULE_CONFIDENCE = 0.9;

/**
 * Ordered, and the order is load-bearing. A rejection routinely names the
 * interview it is declining to offer ("we will not be moving forward to the
 * interview stage"), so rejection patterns must be tested before interview
 * ones or the most common email in the inbox is misread as the best news in
 * it. Same reasoning puts screening ahead of acknowledgement: an assessment
 * mail often opens by thanking you for applying.
 *
 * `offer` sits between the two for the same reason in the other direction: an
 * offer mail nearly always references the interview rounds that produced it
 * ("following your final interview..."), so testing interview first would
 * downgrade the best news in the inbox to a routine one. It stays BELOW
 * rejection, because a rejection is commonly phrased as the offer it is
 * declining to make ("unable to extend an offer").
 */
const RULES: { outcome: Outcome; patterns: RegExp[] }[] = [
  {
    outcome: 'rejected',
    patterns: [
      /\bunfortunately\b/,
      /\bregret to inform\b/,
      /\bnot (?:be )?(?:moving|proceeding|going) forward\b/,
      /\bdecided not to (?:proceed|move forward|continue)\b/,
      /\bwill not be (?:proceeding|moving)\b/,
      /\bnot (?:been )?select(?:ed|ing)\b/,
      /\bpursue other candidates\b/,
      /\bno longer under consideration\b/,
    ],
  },
  {
    outcome: 'offer',
    patterns: [
      /\bpleased to offer\b/,
      /\bdelighted to offer\b/,
      /\bhappy to offer\b/,
      /\boffer of employment\b/,
      /\boffer letter\b/,
      /\bjob offer\b/,
      /\bextend(?:ing)? (?:you )?an offer\b/,
      /\bwelcome to the team\b/,
    ],
  },
  {
    outcome: 'interview',
    patterns: [
      /\binterview\b/,
      /\bschedule (?:a |an )?(?:call|chat|conversation|meeting)\b/,
      /\bshare your availability\b/,
      /\byour availability\b/,
      /\bbook a (?:slot|time)\b/,
    ],
  },
  {
    outcome: 'screening',
    patterns: [
      /\bcoding challenge\b/,
      /\b(?:online )?assessment\b/,
      /\btake[- ]home\b/,
      /\baptitude test\b/,
      /\bhackerrank\b/,
      /\bscreening (?:test|round)\b/,
    ],
  },
  {
    outcome: 'acknowledged',
    patterns: [
      /\breceived your application\b/,
      /\bapplication (?:has been )?received\b/,
      /\bthank you for applying\b/,
      /\bthanks for applying\b/,
      /\bwe have your application\b/,
    ],
  },
];

/**
 * Lines a reply quotes from an earlier message. They are stripped before
 * matching because our own "thank you for applying" confirmation is commonly
 * quoted underneath a real reply, which would otherwise downgrade an
 * interview invitation to an acknowledgement.
 */
function stripQuotedLines(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n');
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyEmail(email: EmailInput): Classification {
  const haystack = normalize(`${email.subject} ${stripQuotedLines(email.body)}`);
  if (!haystack) return { outcome: null, confidence: 0 };

  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(haystack))) {
      return { outcome: rule.outcome, confidence: RULE_CONFIDENCE };
    }
  }
  return { outcome: null, confidence: 0 };
}
