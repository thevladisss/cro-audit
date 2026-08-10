import type { Competitor } from "./api/Competitor.type";
import type { ContentStrategy } from "./api/ContentStrategy.type";
import type { SiteProfile } from "./api/SiteProfile.type";

/**
 * The run-scoped record the three stages hand off through — AUDIT-DESIGN §9.4.
 *
 * It exists because the workflow pauses at a checkpoint after stages 1 and 2,
 * and a serverless function cannot hold a stream open while a human reads.
 * Each stage is its own request; this is what survives between them.
 */
export type RunStatus =
  | "analyzing"
  | "profiled"
  | "finding-competitors"
  | "competitors-found"
  | "strategizing"
  | "complete"
  | "failed";

export type Run = {
  id: string;
  url: string;
  status: RunStatus;
  /** ISO timestamps. `expiresAt` is `createdAt` + 24h (AUDIT-DESIGN §9.4). */
  createdAt: string;
  expiresAt: string;
  siteProfile?: SiteProfile;
  competitors?: Competitor[];
  strategy?: ContentStrategy;
};
