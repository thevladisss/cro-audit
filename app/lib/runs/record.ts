import type { Stage } from "@/app/types";
import { RunStatus } from "@/app/types";


import { patchRun, putStage, type RunPatch, type StagePayloads } from "./runs";

/** A progress tick: status and stage, as the pipeline moves. */
export async function recordProgress(
  runId: string,
  patch: RunPatch,
): Promise<void> {
  try {
    await patchRun(runId, patch);
  } catch (error) {
    console.error(`[lib/runs] recording progress for ${runId} failed:`, error);
  }
}

/** A stage's payload, under `run:{id}:{stage}` — what the next stage reads. */
export async function recordStage(
  runId: string,
  stage: Stage,
  data: StagePayloads[Stage],
): Promise<void> {
  try {
    await putStage(runId, stage, data);
  } catch (error) {
    console.error(
      `[lib/runs] recording the ${stage} of ${runId} failed:`,
      error,
    );
  }
}

/**
 * The end of a run that did not finish. `message` is what the client was told,
 * not a `cause` chain — a run is readable by whoever can read the response.
 */
export async function recordFailure(
  runId: string,
  message: string,
): Promise<void> {
  await recordProgress(runId, {
    status: RunStatus.Failed,
    stage: null,
    error: message,
  });
}
