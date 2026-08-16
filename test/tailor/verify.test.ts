import { describe, it, expect } from 'vitest';
import { verifyNoFabrication } from '../../src/tailor/verify.js';
import type { ExperienceEntry } from '../../src/tailor/resume.js';

const source: ExperienceEntry[] = [
  {
    id: 'e1', kind: 'internship', org: 'Acme', role: 'Data Analyst Intern',
    start: '2025-06', end: '2025-12',
    bullets: [
      { id: 'a1', text: 'Built SQL pipelines aggregating 12M rows of transaction data', skills: ['sql'] },
      { id: 'a2', text: 'Automated a weekly Excel report in Python, cutting 6 hours to 10 minutes', skills: ['python'] },
    ],
  },
];

describe('verifyNoFabrication', () => {
  it('accepts verbatim bullets', () => {
    const res = { entries: [{ id: 'e1', bullets: [{ id: 'a1', text: source[0].bullets[0].text }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(true);
  });

  it('accepts light rewording that preserves the substance', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL data pipelines aggregating 12M rows of transaction data' }] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).ok).toBe(true);
  });

  it('rejects an invented bullet', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Led a team of 12 engineers at Google for three years' }] }],
      summary: '',
    };
    const v = verifyNoFabrication(res, source);
    expect(v.ok).toBe(false);
    expect(v.offending[0]).toContain('Led a team');
  });

  it('rejects a bullet whose id does not exist in the source', () => {
    const res = { entries: [{ id: 'e1', bullets: [{ id: 'ZZZ', text: 'Anything at all' }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('rejects an entry id that does not exist in the source', () => {
    const res = { entries: [{ id: 'ghost', bullets: [{ id: 'a1', text: source[0].bullets[0].text }] }], summary: '' };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  it('rejects an inflated metric', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12B rows of transaction data' }] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).ok).toBe(false);
  });

  // The gate must not fire on the rewording the prompt explicitly invites
  // ("YOU MAY: ... reword for keyword alignment"). These cases are taken from
  // a real Gemini response that the pre-normalization gate rejected at
  // jaccard 0.5769 despite inventing nothing whatsoever.
  describe('faithful rewording', () => {
    const ml: ExperienceEntry[] = [{
      id: 'e2', kind: 'internship', org: 'Atomic North', role: 'AI Engineer Intern',
      start: '2025-01', end: '2025-05',
      bullets: [{
        id: 'b1',
        text: 'Owned the full ML workflow — data cleaning, feature engineering, modelling, and evaluation — using Python, Pandas, NumPy, Scikit-learn, and LangChain',
        skills: ['python'],
      }],
    }];

    it('accepts the real response that the un-normalized gate rejected', () => {
      const res = {
        entries: [{ id: 'e2', bullets: [{ id: 'b1', text: 'Owned the end-to-end machine learning workflow—including data cleaning, feature engineering, modeling, and evaluation—utilizing Python, Pandas, NumPy, Scikit-learn, and LangChain.' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(res, ml)).toEqual({ ok: true, offending: [] });
    });

    it('treats an expanded abbreviation as equal to its short form', () => {
      const res = {
        entries: [{ id: 'e2', bullets: [{ id: 'b1', text: 'Owned the full machine learning workflow — data cleaning, feature engineering, modelling, and evaluation — using Python, Pandas, NumPy, Scikit-learn, and LangChain' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(res, ml).ok).toBe(true);
    });

    it('treats en-GB and en-US spellings as equal', () => {
      const res = {
        entries: [{ id: 'e2', bullets: [{ id: 'b1', text: 'Owned the full ML workflow — data cleaning, feature engineering, modeling, and evaluation — using Python, Pandas, NumPy, Scikit-learn, and LangChain' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(res, ml).ok).toBe(true);
    });

    // The gap the old gate missed: adding a tool keeps similarity high and
    // introduces no number, so neither prior check fired — yet the prompt says
    // "YOU MAY NOT invent ... skills".
    it('rejects an invented technology even when the wording stays close', () => {
      const res = {
        entries: [{ id: 'e2', bullets: [{ id: 'b1', text: 'Owned the full ML workflow — data cleaning, feature engineering, modelling, and evaluation — using Python, Pandas, NumPy, Scikit-learn, TensorFlow, and LangChain' }] }],
        summary: '',
      };
      const v = verifyNoFabrication(res, ml);
      expect(v.ok).toBe(false);
      expect(v.offending[0]).toContain('TensorFlow');
    });

    it('rejects an invented employer spliced into an otherwise faithful bullet', () => {
      const res = {
        entries: [{ id: 'e2', bullets: [{ id: 'b1', text: 'Owned the full ML workflow at Google — data cleaning, feature engineering, modelling, and evaluation — using Python, Pandas, NumPy, Scikit-learn, and LangChain' }] }],
        summary: '',
      };
      const v = verifyNoFabrication(res, ml);
      expect(v.ok).toBe(false);
      expect(v.offending[0]).toContain('Google');
    });

    // The unit letter of a metric ("12M") sits mid-token. If proper-noun
    // matching is not anchored to a word boundary it reads that "M" as a name
    // absent from the source, failing every bullet carrying such a figure.
    it('does not read the unit suffix of a metric as an invented name', () => {
      const res = {
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Built SQL pipelines aggregating 12M rows of transaction data' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(res, source)).toEqual({ ok: true, offending: [] });
    });

    it('does not flag a capitalized word that merely starts the bullet', () => {
      const res = {
        entries: [{ id: 'e2', bullets: [{ id: 'b1', text: 'Managed the full ML workflow — data cleaning, feature engineering, modelling, and evaluation — using Python, Pandas, NumPy, Scikit-learn, and LangChain' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(res, ml).ok).toBe(true);
    });
  });

  // A skill the candidate genuinely holds is not a fabrication just because
  // the ONE source bullet being reworded did not spell it out. The allow-set
  // is the whole resume: every bullet's text, every bullet's declared skills,
  // and the canonical skills list.
  describe('skills as the fabrication authority', () => {
    const src: ExperienceEntry[] = [{
      id: 'e1', kind: 'internship', org: 'Acme', role: 'AI Intern',
      start: '2025-01', end: '2025-05',
      bullets: [{
        id: 'a1',
        text: 'Working across vector and relational databases to structure, retrieve, and ground LLM outputs, improving response accuracy and consistency',
        skills: ['vector databases', 'sql', 'rag', 'llm'],
      }],
    }];

    it('accepts a skill surfaced from the bullet own declared skills', () => {
      const res = {
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Working across SQL and vector databases to structure, retrieve, and ground LLM outputs, improving response accuracy and consistency' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(res, src)).toEqual({ ok: true, offending: [] });
    });

    it('accepts a skill surfaced from the canonical skills list', () => {
      // ETL lives only in skills.json, not in any bullet text or bullet skills.
      const withEtl = {
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Managed ETL across SQL and vector databases to structure, retrieve, and ground LLM outputs, improving response accuracy' }] }],
        summary: '',
      };
      expect(verifyNoFabrication(withEtl, src, ['etl', 'sql', 'rag', 'llm']).ok).toBe(true);
    });

    it('accepts a word drawn from the candidate own role or employer', () => {
      const withRole: ExperienceEntry[] = [{
        id: 'e1', kind: 'internship', org: 'Alliedworks', role: 'AI Developer Intern',
        start: '2025-01', end: '2025-05',
        bullets: [{ id: 'a1', text: 'Working across vector and relational databases to structure and ground LLM outputs', skills: ['sql', 'llm'] }],
      }];
      const res = {
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: withRole[0].bullets[0].text }] }],
        summary: 'Developer at Alliedworks experienced with LLM grounding.',
      };
      expect(verifyNoFabrication(res, withRole).ok).toBe(true);
    });

    it('still rejects a technology in neither the resume nor the skills list', () => {
      const res = {
        entries: [{ id: 'e1', bullets: [{ id: 'a1', text: 'Working across TensorFlow and vector databases to structure, retrieve, and ground LLM outputs, improving response accuracy and consistency' }] }],
        summary: '',
      };
      const v = verifyNoFabrication(res, src, ['sql', 'rag', 'llm']);
      expect(v.ok).toBe(false);
      expect(v.offending[0]).toContain('TensorFlow');
    });
  });

  // The summary is printed on the resume exactly like a bullet, but it is
  // written from scratch and synthesized across entries, so it was previously
  // checked by nothing at all.
  describe('summary', () => {
    const faithful = { id: 'a1', text: source[0].bullets[0].text };

    it('accepts a summary built only from source material', () => {
      const res = {
        entries: [{ id: 'e1', bullets: [faithful] }],
        summary: 'Analyst experienced with SQL pipelines and transaction data.',
      };
      expect(verifyNoFabrication(res, source)).toEqual({ ok: true, offending: [] });
    });

    it('rejects a summary naming a technology absent from the resume', () => {
      const res = {
        entries: [{ id: 'e1', bullets: [faithful] }],
        summary: 'Analyst experienced with SQL pipelines and Kubernetes.',
      };
      const v = verifyNoFabrication(res, source);
      expect(v.ok).toBe(false);
      expect(v.offending.join(' ')).toContain('Kubernetes');
    });

    it('rejects a summary carrying an invented figure', () => {
      const res = {
        entries: [{ id: 'e1', bullets: [faithful] }],
        summary: 'Analyst with 7 years building SQL pipelines.',
      };
      const v = verifyNoFabrication(res, source);
      expect(v.ok).toBe(false);
      expect(v.offending.join(' ')).toContain('invented figures');
    });

    it('ignores an empty summary', () => {
      const res = { entries: [{ id: 'e1', bullets: [faithful] }], summary: '   ' };
      expect(verifyNoFabrication(res, source).ok).toBe(true);
    });
  });

  it('lists every offending bullet, not just the first', () => {
    const res = {
      entries: [{ id: 'e1', bullets: [
        { id: 'a1', text: 'Completely unrelated claim about rocket engines' },
        { id: 'a2', text: 'Another entirely invented achievement in finance' },
      ] }],
      summary: '',
    };
    expect(verifyNoFabrication(res, source).offending).toHaveLength(2);
  });
});
