import type { Stage } from "./Run.type";

/**
 * The NDJSON wire protocol for the stage endpoints.
 *
 * One JSON object per line, discriminated on `type`. The discriminator lives in
 * the payload rather than in a transport field — which is what SSE's `event:`
 * would have bought and the only thing it would have bought here, since these
 * streams answer a `POST` with a body and `EventSource` cannot send one.
 *
 * What this does not buy: resumption. There is no sequence number and no
 * replay, because a dropped connection must not re-run a non-idempotent 60s
 * pipeline. Resuming is `GET /api/runs/[runId]` reading the store.
 */
export enum StreamEventType {
  Progress = "progress",
  Result = "result",
  Error = "error",
}

export type ProgressEvent = {
  type: StreamEventType.Progress;
  /** The store's own vocabulary, so the line and `run:{id}.stage` cannot drift. */
  stage: Stage;
  /** The human sentence. Finer-grained than `stage`, and free to change. */
  label: string;
};

/**
 * Spread flat rather than nested under `data`, per README.md:66. `type` already
 * says what the line is, so an `ok` envelope would be saying it twice.
 */
export type ResultEvent<T> = { type: StreamEventType.Result } & T;

export type ErrorEvent = {
  type: StreamEventType.Error;
  /**
   * A `CollectorErrorReason` when the collector was what failed, else `null`.
   * Typed as a string so `app/types` does not import from `app/lib`.
   */
  reason: string | null;
  message: string;
  /** Whether the same request is worth sending again, unchanged. */
  retryable: boolean;
};

export type StreamEvent<T = unknown> =
  | ProgressEvent
  | ResultEvent<T>
  | ErrorEvent;
