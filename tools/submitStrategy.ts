import type Anthropic from "@anthropic-ai/sdk";

import type { Evidence } from "@/types/api/ContentStrategy.type";

/** `id` is derived from the title by code, never model-authored. */
export type RecommendationDraft = {
  title: string;
  rationale: string;
  evidence: Evidence[];
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
}

export type StrategyDraft = {
  summary: string;
  recommendations: RecommendationDraft[];
}

/**
 * Stage 3's terminal tool.
 *
 * Two rules here are stated in the description and enforced in code, because
 * structured outputs support `enum`, `const`, `anyOf`, and
 * `additionalProperties: false` — but not `minItems`. So `evidence: []` is a
 * schema-valid answer, and "at least one evidence item" can only be a filter
 * after the call (`CONCERNS.md` §9). Saying it here is the model-side half:
 * a recommendation that arrives ungrounded is dropped, not surfaced, and the
 * model is told that so it doesn't spend a slot on one.
 */
export const SUBMIT_STRATEGY: Anthropic.Tool = {
  name: "submit_strategy",
  description:
    "Submit the content strategy. Call this exactly once, after comparing the site profile against the confirmed competitors — it is the only way to return a result. Every recommendation must cite at least one piece of evidence, and every citation must resolve to a competitor URL or rule ID you were actually given: recommendations that cite nothing, or cite something that does not exist, are discarded before the user sees them. Prefer four grounded recommendations to eight where half are inferred.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "recommendations"],
    properties: {
      summary: {
        type: "string",
        description:
          "A short readout of where this site stands against the competitor set — what it is missing, and what it already does well. Prose, not a list.",
      },
      recommendations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "rationale", "evidence", "effort", "impact"],
          properties: {
            title: {
              type: "string",
              description:
                "The action, as an imperative phrase — 'Add a pricing page', not 'Pricing'.",
            },
            rationale: {
              type: "string",
              description:
                "Why this matters for conversion on this specific site. Reference what the evidence shows rather than restating it.",
            },
            evidence: {
              type: "array",
              description:
                "What you actually saw that supports this. At least one item — a recommendation with an empty array is discarded rather than shown.",
              items: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["source", "competitorUrl", "observation"],
                    properties: {
                      source: { const: "competitor" },
                      competitorUrl: {
                        type: "string",
                        description:
                          "Copy the URL from the confirmed competitor list exactly. A URL not on that list invalidates the recommendation.",
                      },
                      observation: {
                        type: "string",
                        description:
                          "What that competitor's page has or does that this one doesn't.",
                      },
                    },
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    required: ["source", "ruleId", "observation"],
                    properties: {
                      source: { const: "finding" },
                      ruleId: {
                        type: "string",
                        description:
                          "Copy the rule ID from the supplied findings exactly. An ID not among them invalidates the recommendation.",
                      },
                      observation: {
                        type: "string",
                        description:
                          "What that finding shows about the user's own site.",
                      },
                    },
                  },
                ],
              },
            },
            effort: {
              type: "string",
              description:
                "Implementation cost: 'low' is a copy or layout change, 'high' is new pages, tooling, or an ongoing commitment.",
              enum: ["low", "medium", "high"],
            },
            impact: {
              type: "string",
              description:
                "Expected effect on conversion for this site specifically, not in general.",
              enum: ["low", "medium", "high"],
            },
          },
        },
      },
    },
  },
};
