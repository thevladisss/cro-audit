import type Anthropic from "@anthropic-ai/sdk";

export type ProfileDraft = {
  name: string;
  /** Editable at the stage-1 checkpoint. */
  niche: string;
  /** Editable at the stage-1 checkpoint. */
  location: string;
  /** Editable at the stage-1 checkpoint. */
  services: string[]; };

/**
 * Stage 1's terminal tool. `strict: true` guarantees the input validates, so
 * the route can cast `input` to `ProfileDraft` without a shape check — but note
 * what that does *not* buy: `services` may be empty and `location` may be a
 * confidently invented city. The schema constrains shape, never truth.
 */
export const SUBMIT_PROFILE: Anthropic.Tool = {
  name: "submit_profile",
  description:
    "Submit the business profile extracted from the page content. Call this exactly once, as the last thing you do, after reading the supplied content — it is the only way to return a result, and any prose outside it is discarded. Report only what the page states about itself, never what the domain name or the writing style implies.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "niche", "location", "services"],
    properties: {
      name: {
        type: "string",
        description:
          "The business's own name as it appears on the page — not the domain, not the page title, not a slogan.",
      },
      niche: {
        type: "string",
        description:
          "The trade or specialism in a short phrase, as the business itself would describe it (e.g. 'family and cosmetic dentistry').",
      },
      location: {
        type: "string",
        description:
          "The service area or address the page names. Return an empty string when the page names none — an empty string is the correct answer here, and inferring a city from the domain, phone number, or language is not.",
      },
      services: {
        type: "array",
        description:
          "The services the business offers, one per item, in the page's own words. Return an empty array rather than inventing plausible ones for the niche.",
        items: { type: "string" },
      },
    },
  },
};
