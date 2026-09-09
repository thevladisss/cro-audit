import type Anthropic from "@anthropic-ai/sdk";

import { REGISTRY } from "@/app/lib/rules";
import type { FindingScale, Severity } from "@/app/types";

/**
 * Stage ①'s second opinion.
 *
 * The deterministic registry has already scored the page by the time this runs.
 * This tool asks the model to score the *same* page against the *same* rules
 * from the raw HTML, so the two verdicts can be compared rule by rule.
 *
 * What that buys: a rule whose implementation is too literal shows up as a
 * divergence rather than as a quietly wrong number — `conversion.no-pricing`
 * matching a phone number, or missing "£49" rendered inside an image.
 *
 * What it does NOT buy, and this is the load-bearing part: **the model's score
 * is never the score.** It is evidence about the rules, not about the site.
 * `strict: true` and the `ruleId` enum below guarantee the shape and confine
 * the model to rules that exist; neither guarantees the verdict is right, and
 * the page being read is attacker-controlled text. `reconcile()` ships the
 * deterministic number in every case.
 */

const RULE_IDS = REGISTRY.map((rule) => rule.id);

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

const SCALES: FindingScale[] = [1, 2, 3];

export type AnalysisVerdict = {
  ruleId: string;
  /** True when the model judges the rule's criterion to be met — i.e. a problem. */
  fired: boolean;
  /** What in the HTML decided it. Quoted, counted, and checkable. */
  evidence: string;
};

export type AnalysisDraft = {
  /** The model's own 0–100 conversion score. Compared, never shipped. */
  score: number;
  verdicts: AnalysisVerdict[];
  /** Findings the rules do not cover. Recorded, never scored. */
  extraFindings: {
    title: string;
    evidence: string;
    severity: Severity;
    impact: FindingScale;
    effort: FindingScale;
  }[];
};

export const SUBMIT_ANALYSIS: Anthropic.Tool = {
  name: "submit_analysis",
  description:
    "Submit your judgement of the page against the supplied rules. Call this exactly once, as the last thing you do — it is the only way to return a result, and any prose outside it is discarded. Judge only what the supplied HTML shows; never what the domain name, the page title, or the writing style implies.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["score", "verdicts", "extraFindings"],
    properties: {
      score: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description:
          "Your overall conversion score for this page, 0-100, where 100 is a page that fails none of the rules. Score the page you were given, not the page you would expect a business of this kind to have.",
      },
      verdicts: {
        type: "array",
        description:
          "Exactly one entry per supplied rule, in the order the rules were given. Do not omit a rule because it obviously passes — a pass is a verdict.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "fired", "evidence"],
          properties: {
            ruleId: {
              type: "string",
              // A schema-level enum, so an invented rule id cannot validate.
              // `reconcile` filters again anyway — the two are cheap and the
              // failure modes differ.
              enum: RULE_IDS,
              description: "The rule this verdict is about.",
            },
            fired: {
              type: "boolean",
              description:
                "True when the rule's criterion is met — that is, when the page HAS the problem the rule describes. False when the page satisfies the rule.",
            },
            evidence: {
              type: "string",
              description:
                "What in the HTML decided it, quoted or counted — 'two <a class=\"btn\"> elements: Book now, Call us', not 'the page has CTAs'. When the verdict is a pass, say what you found; when it is a fire, say what you looked for and did not find.",
            },
          },
        },
      },
      extraFindings: {
        type: "array",
        description:
          "Conversion problems you can see that none of the supplied rules covers. Return an empty array rather than restating a rule. These are recorded for review and never affect the score.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "evidence", "severity", "impact", "effort"],
          properties: {
            title: {
              type: "string",
              description: "The problem in one short sentence.",
            },
            evidence: {
              type: "string",
              description: "What in the HTML shows it, quoted or counted.",
            },
            severity: { type: "string", enum: SEVERITIES },
            impact: {
              type: "integer",
              enum: SCALES,
              description: "1 = marginal, 3 = likely to change conversion.",
            },
            effort: {
              type: "integer",
              enum: SCALES,
              description: "1 = a copy change, 3 = a build.",
            },
          },
        },
      },
    },
  },
};
