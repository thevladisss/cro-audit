import type {
  Competitor,
  ContentStrategy,
  Run,
  SiteProfile,
  Snapshot,
} from "@/app/types";
import { RunStatus, Stage } from "@/app/types";
import type { Reconciliation } from "@/app/lib/analyze";

import { canonicalUrl } from "@/app/utils";

import { kv } from "@/app/lib/kv";

import { TTL, runKey, stageKey, urlIndexKey } from "./keys";

/**
 * The run store, in domain vocabulary — no Redis word leaves this module.
 * `lib/kv` owns the driver; the keys, the TTL and what a value means are here.
 *
 * The layering rule that keeps the rest of the code testable: `lib/rules`,
 * `lib/analyze` and `lib/collector` never import this. They are
 * `Snapshot in → findings out`, which is why they need no env and no network.
 * Persistence is called from the route handler alone.
 */

/**
 * `html` never lands in KV. Upstash caps a value near 1MB and a rendered DOM is
 * 100–500KB before JSON escaping. `analyzeWithModel` gets the HTML in-process
 * during the same request, and nothing reads it afterwards.
 */
export type PersistedSnapshot = Omit<Snapshot, "html">;

/** What each stage key holds. `Stage` and this must agree — `putStage` enforces it. */
export type StagePayloads = {
  [Stage.Snapshot]: PersistedSnapshot;
  [Stage.Analysis]: Reconciliation;
  [Stage.Profile]: SiteProfile;
  [Stage.Competitors]: Competitor[];
  [Stage.Strategy]: ContentStrategy;
};

/**
 * Everything a run's progress can move. The identity fields — `runId`, `url`,
 * `createdAt` — are not patchable, and `updatedAt` is `patchRun`'s to set.
 *
 * Spelled out rather than derived from `Run`, so nothing here tracks that type
 * automatically: a field whose shape changes there must be changed here too.
 */
export type RunPatch = {
  status?: RunStatus;
  /** What it is working on now; `null` before it starts and once it stops. */
  stage?: Stage | null;
  /** The message the client was given, not a raw `cause` chain. */
  error?: string | null;
};

/**
 * Field by field rather than a rest spread: what reaches KV is stated here, so
 * a field added to `Snapshot` is one this function must be told about — the
 * `PersistedSnapshot` return type is what makes that a compile error rather
 * than a silent omission.
 */
export function persistedSnapshot(snapshot: Snapshot): PersistedSnapshot {
  return {
    url: snapshot.url,
    finalUrl: snapshot.finalUrl,
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt,

    // `html` is the one field deliberately left behind.
    title: snapshot.title,
    metaDescription: snapshot.metaDescription,
    lang: snapshot.lang,
    canonical: snapshot.canonical,

    headings: snapshot.headings,
    ctas: snapshot.ctas,
    forms: snapshot.forms,
    images: snapshot.images,
    links: snapshot.links,
    text: snapshot.text,
  };
}

export async function createRun(url: string): Promise<Run> {
  const now = new Date().toISOString();

  const run: Run = {
    runId: crypto.randomUUID(),
    url: canonicalUrl(url),
    status: RunStatus.Pending,
    stage: null,
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  await kv.set(runKey(run.runId), run, { ttl: TTL });
  // An object rather than a bare id: `@vercel/kv` auto-parses JSON on `get`, so
  // a stored string that happens to look like JSON comes back parsed. The index
  // points at the newest run for a URL; older ones stay reachable by id.
  await kv.set(urlIndexKey(run.url), { runId: run.runId }, { ttl: TTL });

  return run;
}

export async function getRun(runId: string): Promise<Run | null> {
  return (await kv.get<Run>(runKey(runId))) ?? null;
}

export async function findRunByUrl(url: string): Promise<Run | null> {
  const index = await kv.get<{ runId: string }>(urlIndexKey(url));

  // The index outlives nothing the run does — both TTLs are refreshed together
  // — but a run patched for 24h while the index went untouched can expire the
  // other way round, so a dangling index is a `null`, not a throw.
  return index ? getRun(index.runId) : null;
}

/**
 * Read-modify-write, which is safe here because a run has exactly one writer:
 * the request that created it. Two concurrent patches to the same `runId` would
 * be a pipeline that forked, and that is not a case to make atomic — it is one
 * to not have.
 */
export async function patchRun(runId: string, patch: RunPatch): Promise<void> {
  const run = await getRun(runId);

  // Expired, or an id we never issued. A progress tick is not worth
  // resurrecting a run from.
  if (!run) return;

  await kv.set(
    runKey(runId),
    { ...run, ...patch, updatedAt: new Date().toISOString() },
    { ttl: TTL },
  );
}

export async function putStage(
  runId: string,
  stage: Stage,
  data: StagePayloads[Stage],
): Promise<void> {
  await kv.set(stageKey(runId, stage), data, { ttl: TTL });
}

export async function getStage(
  runId: string,
  stage: Stage,
): Promise<StagePayloads[Stage] | null> {
  return (await kv.get<StagePayloads[Stage]>(stageKey(runId, stage))) ?? null;
}
