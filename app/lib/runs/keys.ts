import type { Stage } from "@/app/types";
import { canonicalUrl } from "@/app/utils";

/**
 * 24h TTL. Every write refreshes it, so an active run cannot
 * expire mid-flight — a run that goes quiet for a day is one nothing is waiting
 * on.
 */
export const TTL = 60 * 60 * 24;

/** Status and pointers. Small, and patched on every progress tick. */
export const runKey = (runId: string) => `run:${runId}`;

/** Written once, read by the next stage. */
export const stageKey = (runId: string, stage: Stage) =>
  `run:${runId}:${stage}`;

/** The "stores the run under url" index (ENDPOINT_RUN_PLAN.md:7). */
export const urlIndexKey = (url: string) => `run:url:${canonicalUrl(url)}`;
