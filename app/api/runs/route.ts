import { collect, CollectorError, CollectorErrorReason } from "@/app/lib/collector";
import type { Run, SiteProfile, Snapshot } from "@/app/types";
import { RunStatus, Stage, StreamEventType } from "@/app/types";
import type { Reconciliation } from "@/app/lib/analyze";
import { analyzeWithModel, profileWithModel, reconcile } from "@/app/lib/analyze";
import { ndjsonResponse } from "@/app/lib/ndjson";
import { runRules, REGISTRY } from "@/app/lib/rules";
import {
  createRun,
  persistedSnapshot,
  recordFailure,
  recordProgress,
  recordStage,
} from "@/app/lib/runs";
import { createRunBodySchema } from "@/app/lib/validation/schemas";

/**
 * Stage ① Website Analyzer.
 *
 * The composition lives here rather than in a `lib/` wrapper: three calls, one
 * caller, and each of the three is already tested on its own.
 *
 * Ordering is the security boundary, not a preference. `runRules` produces the
 * score before the model is asked anything, and `reconcile` ships that number
 * in every case — so the worst an injected page achieves is a bogus
 * `modelScore` and a spurious divergence, both labelled as the model's opinion.
 *
 * The route is also the only layer that calls the store — through `lib/runs`,
 * which owns both the keys and the best-effort semantics of a progress write.
 * `lib/rules`, `lib/analyze` and `lib/collector` are `Snapshot in → findings
 * out` and never import `lib/runs` — a rule that reaches for the store is a
 * rule whose test needs a Redis.
 *
 * The answer is NDJSON, not a JSON body (README.md:42): a cold start plus a
 * render plus two model calls is 20–60s, and a minute of nothing reads as
 * broken. One `progress` line per phase, then exactly one `result` or `error`.
 */

/** Chromium cannot run on edge, so state the runtime rather than defaulting. */
export const runtime = "nodejs";
/** Headroom over `collect`'s own 30s budget — the collector owns the cap. */
export const maxDuration = 60;

/**
 * What the terminal `result` line carries. Flat rather than nested under `data`
 * (README.md:66) — `type` already says what the line is, so an `ok` envelope
 * would be saying it twice.
 */
type AnalyzerResult = Reconciliation & {
  runId: string;
  profile: SiteProfile | null;
};

/**
 * Whether the same request is worth sending again, unchanged.
 *
 * This replaces the status map the JSON response used: once the stream is open
 * the status is already 200, so what a client can still be told is not *who*
 * the failure belonged to but whether to bother retrying.
 */
const COLLECTOR_RETRYABLE: Record<CollectorErrorReason, boolean> = {
  // the host does not resolve — the input is wrong, not the internet
  [CollectorErrorReason.Dns]: false,
  // we reached the network and something refused; it will refuse again
  [CollectorErrorReason.Blocked]: false,
  // the 30s budget expired — a slow page may still be a reachable one
  [CollectorErrorReason.Timeout]: true,
  // Chromium would not start. Ours, not theirs, and a warm lambda may not repeat it
  [CollectorErrorReason.Browser]: true,
  // never sent: the client is what aborted, so nothing is listening
  [CollectorErrorReason.Aborted]: false,
};

/**
 * The site's own pages, as paths, deduped and in the order the page links to
 * them. A fragment or a query string is the same page, so both are dropped
 * before deduping — otherwise `/contact`, `/contact#form` and `/contact?ref=nav`
 * are three pages.
 */
function sitePages(snapshot: Snapshot): string[] {
  const paths = new Set<string>();

  for (const link of snapshot.links) {
    if (link.external) continue;
    try {
      paths.add(new URL(link.href).pathname);
    } catch {
      // A same-origin link the URL parser rejects is not a page we can name.
    }
  }

  return [...paths];
}

export async function POST(request: Request) {
  let body: unknown;

  /**
   * Everything above the stream is the only place a status code is still
   * honest: `new Response(stream)` has already sent 200 by the time the
   * pipeline runs, so these three are the last failures that get one.
   */
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const validation = createRunBodySchema.safeParse(body);

  if (!validation.success) {
    return Response.json(
      { ok: false, error: validation.error.flatten() },
      { status: 422 },
    );
  }

  const { url } = validation.data;

  /**
   * Fatal, unlike every later write, and cheap to fail: nothing has been spent
   * yet, and a caller handed no `runId` has no way to reach stages ② and ③.
   */
  let run: Run;

  try {
    run = await createRun(url);
  } catch (error) {
    console.error(`[POST /api/runs] ${url} could not be stored:`, error);

    return Response.json(
      { ok: false, error: "Run store unavailable." },
      { status: 503 },
    );
  }

  const { runId } = run;

  return ndjsonResponse<AnalyzerResult>(
    async (emit, streamSignal) => {
      // Either side hanging up stops the work: `request.signal` for the
      // request, `streamSignal` for a reader that went away mid-render.
      const signal = AbortSignal.any([request.signal, streamSignal]);

      try {
        emit({
          type: StreamEventType.Progress,
          stage: Stage.Snapshot,
          label: "rendering the page in a real browser",
        });
        // The store mirrors the last line sent — one rule, so `run:{id}.stage`
        // and the stream can never disagree about where the run is.
        await recordProgress(runId, {
          status: RunStatus.Running,
          stage: Stage.Snapshot,
        });

        // TODO: assertPublicUrl(url) — the SSRF guard is the route's, not the
        // collector's, whose own suite renders from 127.0.0.1.
        const snapshot = await collect(url, { signal });

        // Without `html`: a rendered DOM is 100–500KB and Upstash caps a value
        // near 1MB. The model calls read it in-process; nothing reads it after.
        await recordStage(runId, Stage.Snapshot, persistedSnapshot(snapshot));

        emit({
          type: StreamEventType.Progress,
          stage: Stage.Analysis,
          label: `running ${REGISTRY.length} rules`,
        });
        await recordProgress(runId, { stage: Stage.Analysis });

        // 4a — deterministic. Same snapshot in, same findings out.
        const deterministic = runRules(snapshot, REGISTRY);

        // Two lines for two calls that run at once: the wall clock is
        // max(a, b), so announcing them one after the other would misdescribe
        // the wait.
        emit({
          type: StreamEventType.Progress,
          stage: Stage.Analysis,
          label: "asking the model for a second opinion",
        });
        emit({
          type: StreamEventType.Progress,
          stage: Stage.Profile,
          label: "profiling the business",
        });
        await recordProgress(runId, { stage: Stage.Profile });

        // 4b — two independent model calls, neither of which gates the other.
        // They are separate calls because they read different things and mean
        // different things on failure: the analysis is a diagnostic that is
        // compared and never shipped, the profile is what checkpoint 1 edits
        // and stage ② is fed from.
        const [draft, profile] = await Promise.all([
          analyzeWithModel(snapshot, signal), // raw HTML → AnalysisDraft
          profileWithModel(snapshot, signal), // visible copy → ProfileDraft
        ]);

        // 4c — compared rule by rule. `score` is the deterministic one.
        const analysis = reconcile(deterministic, draft, REGISTRY);

        // `null` when the model call degraded. Not an error here — but stage ②
        // has nothing to run on until this is filled, so the caller is told
        // rather than handed a fabricated profile.
        const siteProfile: SiteProfile | null =
          profile === null
            ? null
            : {
                url: snapshot.finalUrl,
                ...profile,
                // The collector's, not the model's (README.md:162). `external`
                // already means "leaves this site", so the same-origin links
                // are the site's own pages.
                pages: sitePages(snapshot),
                score: analysis.score,
              };

        // The whole `Reconciliation` lands here — `modelScore`, `scoreDelta`
        // and `divergences` survive the request even when the wire narrows.
        await recordStage(runId, Stage.Analysis, analysis);

        if (siteProfile) {
          // `run:{id}:profile` is what stage ② reads, so the client does not
          // carry the profile back on the next request — checkpoint 1 patches
          // this key.
          await recordStage(runId, Stage.Profile, siteProfile);
        }

        await recordProgress(runId, {
          status: RunStatus.Done,
          stage: null,
        });

        // A 404 or a 503 is a page worth auditing, and arrives as
        // `snapshot.status` rather than a throw — so it must not become an
        // `error` line here.
        emit({
          type: StreamEventType.Result,
          runId,
          ...analysis,
          profile: siteProfile,
        });
      } catch (error) {
        /**
         * The error object itself, not a message: `console.error` prints the
         * stack and walks the `cause` chain, which is where Chromium's real
         * `net::ERR_*` ends up after `toCollectorError` wraps it.
         * `JSON.stringify` would drop both. Vercel captures stderr into the
         * runtime logs, so this is the whole of the setup.
         */
        console.error(`[POST /api/runs] ${url} failed:`, error);

        if (error instanceof CollectorError) {
          await recordFailure(runId, `${error.reason}: ${error.message}`);

          // Nothing is listening: the client is what aborted. The run records
          // it, and the line goes nowhere.
          if (error.reason === CollectorErrorReason.Aborted) return;

          emit({
            type: StreamEventType.Error,
            reason: error.reason,
            message: error.message,
            retryable: COLLECTOR_RETRYABLE[error.reason],
          });

          return;
        }

        await recordFailure(runId, "Analysis failed.");

        // A raw `cause` chain out of Playwright is not something to hand a
        // client.
        emit({
          type: StreamEventType.Error,
          reason: null,
          message: "Analysis failed.",
          retryable: false,
        });
      }
    },
    // The run exists before the stream opens; a client that drops before the
    // `result` line still has the handle it needs to resume.
    { headers: { "x-run-id": runId } },
  );
}
