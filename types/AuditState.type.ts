import type { Competitor } from "./api/Competitor.type";
import type { ContentStrategy } from "./api/ContentStrategy.type";
import type { ProgressEvent } from "./Progress.type";
import type { SiteProfile } from "./api/SiteProfile.type";

/**
 * The client state machine — see RUN-LIFECYCLE.md §6.
 *
 * Two kinds of state, and the difference is structural: **running** states carry
 * `progress` and have a request open; **checkpoint** states carry the artifact
 * under review and fire nothing. That pause is the whole reason the work is
 * split across three endpoints.
 *
 * Each transition adds a field and never removes one, so `finding-competitors`
 * cannot exist without the `siteProfile` its request body is built from — an
 * impossible combination has no representation.
 *
 * `step` and the server's `Run.status` track the same run from two sides and
 * agree at every boundary (RUN-LIFECYCLE.md §1) — present participles are
 * running states, past tenses are checkpoints:
 *
 *   analyzing / finding-competitors / strategizing → the same `status`
 *   profile-review     → `profiled`
 *   competitor-review  → `competitors-found`
 *   result             → `complete`
 */
export type AuditState =
  /** `url` is the last value entered — empty on first load, kept so returning
   *  from a run doesn't clear the field. */
  | { step: "idle"; url: string }
  | { step: "analyzing"; url: string; progress: ProgressEvent[] }
  | {
      step: "profile-review";
      url: string;
      runId: string;
      siteProfile: SiteProfile;
    }
  | {
      step: "finding-competitors";
      url: string;
      runId: string;
      /** As the user confirmed it at the stage-1 checkpoint, not as stage 1 returned it. */
      siteProfile: SiteProfile;
      progress: ProgressEvent[];
    }
  | {
      step: "competitor-review";
      url: string;
      runId: string;
      siteProfile: SiteProfile;
      competitors: Competitor[];
    }
  | {
      step: "strategizing";
      url: string;
      runId: string;
      siteProfile: SiteProfile;
      /** As the user confirmed them at the stage-2 checkpoint. */
      competitors: Competitor[];
      progress: ProgressEvent[];
    }
  /** Terminal. The whole deliverable: score, competitors, and strategy together. */
  | {
      step: "result";
      url: string;
      runId: string;
      siteProfile: SiteProfile;
      competitors: Competitor[];
      strategy: ContentStrategy;
    }
  | { step: "error"; url: string; message: string; retryable: boolean };
