/** What stage 2 (Competitor Finder) produces — see AGENTIC-WORKFLOW.md §2. */

/**
 * Split deliberately (CONCERNS.md §5): `services` is what we saw on the page,
 * `claims` is what the page says about itself. Competitor homepages are sales
 * copy — "the region's leading provider" is a claim, not a fact, and the two
 * must not merge into one bucket downstream.
 */
export type Competitor = {
  name: string;
  url: string;
  /** Observed — present on the fetched page. */
  services: string[];
  location: string;
  /** Claimed — marketing copy, attributed but never asserted as true. */
  claims: string[];
  /** How much of the record was found vs. inferred. */
  confidence: "high" | "medium" | "low";
};
