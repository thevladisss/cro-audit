/** What stage 3 (Content Strategist) produces — see AGENTIC-WORKFLOW.md §3. */

/**
 * Every recommendation traces to something we actually saw (CONCERNS.md §9) —
 * either an observation on a competitor's site or a finding on the user's own.
 * A recommendation with no evidence is dropped rather than surfaced.
 */
export type Evidence =
  | { source: "competitor"; competitorUrl: string; observation: string }
  | { source: "finding"; ruleId: string; observation: string };

export type Recommendation = {
  id: string;
  title: string;
  rationale: string;
  evidence: Evidence[];
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
};

export type ContentStrategy = {
  summary: string;
  /** Ordered — highest impact per unit effort first. */
  recommendations: Recommendation[];
};
