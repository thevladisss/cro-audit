import type Anthropic from "@anthropic-ai/sdk";

import type { Competitor } from "@/types/api/Competitor.type";

export type CompetitorDraft = Competitor;

export type CompetitorsDraft = {
  competitors: CompetitorDraft[];
};

/**
 * Stage 2's terminal tool. One call over every fetched page rather than one per
 * competitor — the records are compared against each other, and a per-page call
 * would pay the page content's tokens again on each one.
 *
 * The `services` / `claims` split is the whole point of this schema
 * (`CONCERNS.md` §5). Merging them is what turns "Acme says it's the region's
 * leading provider" into "competitors are the region's leading providers" two
 * stages later, so the description spends most of its length on that boundary.
 */
export const SUBMIT_COMPETITORS: Anthropic.Tool = {
  name: "submit_competitors",
  description:
    "Submit one structured record per competitor page you were given. Call this exactly once, after reading all of the supplied pages — it is the only way to return a result. Skip a page entirely rather than guessing at a record for it; a shorter accurate list is worth more than a complete one.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["competitors"],
    properties: {
      competitors: {
        type: "array",
        description:
          "One record per page you could read. Omit pages you could not.",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "url",
            "name",
            "services",
            "location",
            "claims",
            "confidence",
          ],
          properties: {
            url: {
              type: "string",
              description:
                "Copy the URL of the supplied page this record came from, character for character. It is a correlation key, not a field to author — a record whose URL was not in the set you were given is discarded.",
            },
            name: {
              type: "string",
              description:
                "The competitor's business name as the page gives it.",
            },
            services: {
              type: "array",
              description:
                "Observed: services the page demonstrably offers — listed, priced, described, or given their own section. If the page only asserts quality or standing rather than naming a service, that belongs in `claims`, not here.",
              items: { type: "string" },
            },
            location: {
              type: "string",
              description:
                "The service area or address the listing or page gives. Empty string when neither names one.",
            },
            claims: {
              type: "array",
              description:
                "Claimed: the page's own marketing assertions about itself, quoted or closely paraphrased — 'the region's leading provider', 'award-winning', 'over 20 years' experience'. These are recorded as things the competitor says, never as things that are true.",
              items: { type: "string" },
            },
            confidence: {
              type: "string",
              description:
                "How much of this record you read versus inferred. A record assembled from a homepage alone is 'low' or 'medium'; reserve 'high' for a page that named its services and location outright.",
              enum: ["high", "medium", "low"],
            },
          },
        },
      },
    },
  },
};
