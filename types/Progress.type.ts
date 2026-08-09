/** The NDJSON wire format — see AUDIT-DESIGN §3. */

export type AuditStage =
  // Stage 1 — Website Analyzer (the audit runs inside it)
  | "validating"
  | "launching"
  | "rendering-desktop"
  | "rendering-mobile"
  | "running-rules"
  | "scoring"
  | "profiling"
  // Stage 2 — Competitor Finder
  | "searching-competitors"
  | "fetching-competitor"
  | "collating-competitors"
  // Stage 3 — Content Strategist
  | "comparing"
  | "writing-recommendations"
  | "assembling"
  // Audit-only, pending the questions-screen decision (CONCERNS.md §1)
  | "deriving-questions"
  | "generating-narrative";

export type ProgressEvent = {
  stage: AuditStage;
  label: string;
  /** ISO timestamp. */
  at: string;
};

/**
 * One line of the NDJSON body. Exactly one `result` **or** one `error` is sent,
 * always last — the structured payload can't be rendered until it is whole, so
 * it never arrives in pieces.
 */
export type RunStreamEvent<T = unknown> =
  | { type: "progress"; event: ProgressEvent }
  | { type: "result"; data: T }
  | { type: "error"; message: string; retryable: boolean };
