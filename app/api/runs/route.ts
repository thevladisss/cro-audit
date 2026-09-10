import { collect, CollectorError, CollectorErrorReason } from "@/app/lib/collector";
import type { Snapshot } from "@/app/types";
import { analyzeWithModel, profileWithModel, reconcile } from "@/app/lib/analyze";
import { runRules, REGISTRY } from "@/app/lib/rules";
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
 */

/** Chromium cannot run on edge, so state the runtime rather than defaulting. */
export const runtime = "nodejs";
/** Headroom over `collect`'s own 30s budget — the collector owns the cap. */
export const maxDuration = 60;

/** README's four reasons, mapped to who the failure belongs to. */
const COLLECTOR_STATUS: Record<CollectorErrorReason, number> = {
  // the host does not resolve — the input is wrong, not the internet
  [CollectorErrorReason.Dns]: 400,
  // we reached the network and something refused
  [CollectorErrorReason.Blocked]: 502,
  // the 30s budget expired
  [CollectorErrorReason.Timeout]: 504,
  // Chromium would not start. Ours, not theirs
  [CollectorErrorReason.Browser]: 500,
  // the client hung up; nothing is listening, but the log is honest
  [CollectorErrorReason.Aborted]: 499,
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

  try {
    // TODO: assertPublicUrl(url) — the SSRF guard is the route's, not the
    // collector's, whose own suite renders from 127.0.0.1.
    // The signal is what stops a render outliving the request that asked for it.
    const snapshot = await collect(url, { signal: request.signal });

    require('fs').writeFileSync('snapshot.json', JSON.stringify(snapshot, null, 2));

    // 4a — deterministic. Same snapshot in, same findings out.
    const deterministic = runRules(snapshot);

    // 4b — two independent model calls, neither of which gates the other.
    // Independent, so `Promise.all` makes the wall clock max(a, b) rather than
    // the sum. They are separate calls because they read different things and
    // mean different things on failure: the analysis is a diagnostic that is
    // compared and never shipped, the profile is what checkpoint 1 edits and
    // stage ② is fed from.
    const [draft, profile] = await Promise.all([
      analyzeWithModel(snapshot, request.signal), // raw HTML → AnalysisDraft
      profileWithModel(snapshot, request.signal), // visible copy → ProfileDraft
    ]);

    // 4c — compared rule by rule. `score` is the deterministic one.
    const analysis = reconcile(deterministic, draft, REGISTRY);

    // A 404 or a 503 is a page worth auditing, and arrives as `snapshot.status`
    // rather than a throw — so it must not become an error response here.
    return Response.json({
      ok: true,
      data: {
        ...analysis,
        // `null` when the model call degraded. Not an error here — but stage ②
        // has nothing to run on until this is filled, so the caller is told
        // rather than handed a fabricated profile.
        profile:
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
              },
      },
    });
  } catch (error) {
    /**
     * The error object itself, not a message: `console.error` prints the stack
     * and walks the `cause` chain, which is where Chromium's real `net::ERR_*`
     * ends up after `toCollectorError` wraps it. `JSON.stringify` would drop
     * both. Vercel captures stderr into the runtime logs, so this is the whole
     * of the setup.
     */
    console.error(`[POST /api/runs] ${url} failed:`, error);

    if (error instanceof CollectorError) {
      return Response.json(
        { ok: false, error: { reason: error.reason, message: error.message } },
        { status: COLLECTOR_STATUS[error.reason] },
      );
    }

    // A raw `cause` chain out of Playwright is not something to hand a client.
    return Response.json(
      { ok: false, error: "Analysis failed." },
      { status: 500 },
    );
  }
}
