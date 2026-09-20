/**
 * The run record: status and pointers, never payloads.
 *
 * Findings, snapshots and profiles live under their own keys
 * (`run:{id}:{stage}`) because this record is patched on every progress tick —
 * keeping the payloads out of it is the difference between a cheap patch and a
 * read-modify-write of the whole run.
 */

/**
 * A run's lifecycle. The values are the wire vocabulary — a `Run`'s `status`
 * serializes to these exact strings.
 */
export enum RunStatus {
  Pending = "pending",
  Running = "running",
  Done = "done",
  Failed = "failed",
}

/**
 * The pipeline's stages, in order. Stages ② and ③ are still placeholders.
 *
 * The values are the wire and key vocabulary — `run:{id}:{stage}` and a
 * `ProgressEvent`'s `stage` are these exact strings.
 */
export enum Stage {
  Snapshot = "snapshot",
  Analysis = "analysis",
  Profile = "profile",
  Competitors = "competitors",
  Strategy = "strategy",
}

export type Run = {
  runId: string;
  /** Normalized — `run:url:{url}` indexes this exact string. */
  url: string;
  status: RunStatus;
  /** What it is working on now; `null` before it starts and once it stops. */
  stage: Stage | null;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  /** The message the client was given, not a raw `cause` chain. */
  error: string | null;
};
