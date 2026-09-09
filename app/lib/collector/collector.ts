import type { Browser } from "playwright-core";

import type { Snapshot } from "@/app/types";

import { desktopUserAgent, launch } from "./browser";
import { CollectorError, CollectorErrorReason, toCollectorError } from "./errors";
import { extractFromPage } from "./extract";
import { toSnapshot } from "./normalize";
import { sleep } from "@/app/lib/collector/utils";

export type CollectOptions = {
  /** Cap on the navigation itself. */
  navigationTimeoutMs?: number;
  /** Cap on the post-load settle — see the note on `networkidle` below. */
  settleTimeoutMs?: number;
  /** Cap on everything, so a hung step cannot outlive the route's budget. */
  totalBudgetMs?: number;
  viewport?: { width: number; height: number };
  /**
   * Cancels the collection. A disconnected client is the case this exists for:
   * without it, a render outlives the request that asked for it and holds a
   * Chromium until the budget expires.
   */
  signal?: AbortSignal;
};

/**
 * What `render` is configured by. `signal` is deliberately absent: cancellation
 * is raced at the `collect` level, next to the budget it behaves like, and
 * `render` has nothing to do with it.
 */
type RenderSettings = Required<Omit<CollectOptions, "signal">>;

/**
 * A promise that only ever rejects, paired with the teardown that stops it
 * doing so. Both racers below own a resource — a timer, a listener — that
 * outlives the promise if the other one wins, so neither can be a bare
 * `Promise`.
 */
type Racer = { promise: Promise<never>; dispose: () => void };

const DEFAULTS = {
  navigationTimeoutMs: 20_000,
  settleTimeoutMs: 2_500,
  totalBudgetMs: 30_000,
  /**
   * One desktop viewport, not the two the README describes. A second render
   * doubles the slowest step in the audit and no rule reads layout yet; the
   * mobile pass lands with the above-the-fold rules that would need it.
   */
  viewport: { width: 1280, height: 800 },
} as const;

/**
 * Bytes we will never look at. Image metadata comes from DOM attributes, so
 * nothing in a `Snapshot` depends on the pixels arriving, and on an
 * image-heavy page this is the difference between a six-second render and a
 * twenty-second one. Stylesheets and scripts must load: layout-aware text and
 * the entire justification for using a browser depend on them.
 *
 * TODO: one `Snapshot` field does depend on the bytes, contrary to the claim
 * above — aborting these requests means resource selection never runs, so
 * `currentSrc` stays empty and a `<picture>`/`srcset` image lands as `src: ""`.
 * See the note in `extract.ts`'s `collectImages`.
 */
const SKIPPED_RESOURCES = ["image", "media", "font"];

/**
 * The budget rejects on its own timer rather than by tearing the context down,
 * because teardown does not interrupt anything: `context.close()` resolves
 * promptly, but a Playwright call already in flight on that context never
 * settles — not resolved, not rejected. Racing an independent timer is what
 * makes the cap real.
 */
function getExpiryPromise(url: string, budgetMs: number): Racer {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new CollectorError(
            CollectorErrorReason.Timeout,
            `Collecting ${url} exceeded its ${budgetMs}ms budget.`,
          ),
        ),
      budgetMs,
    );
  });

  return { promise, dispose: () => clearTimeout(timer) };
}

/**
 * Cancellation is raced rather than pushed into Playwright, which takes no
 * `AbortSignal`, and for the same reason the budget is: closing the context
 * does not interrupt a call already in flight on it. This only decides when to
 * stop waiting — reclaiming the browser is `collect`'s `finally`.
 *
 * With no signal the promise never settles, which is the right shape for a race
 * it is not taking part in.
 */
function getAbortionPromise(url: string, signal?: AbortSignal): Racer {
  if (signal === undefined) {
    return { promise: new Promise<never>(() => {}), dispose: () => {} };
  }

  let onAbort: (() => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    const fail = () =>
      reject(
        new CollectorError(
          CollectorErrorReason.Aborted,
          `Collecting ${url} was aborted.`,
        ),
      );

    /**
     * Checked here, not only in `collect`'s pre-flight: `launch` runs between
     * the two, and `addEventListener` on a signal that has already fired never
     * calls back. Without this, a caller who gave up during the browser launch
     * would be waited on for the full budget.
     */
    if (signal.aborted) {
      fail();
      return;
    }

    onAbort = fail;
    signal.addEventListener("abort", onAbort, { once: true });
  });

  return {
    promise,
    /**
     * One signal outlives many collects — a crawl hands the same
     * `request.signal` to every page — so a listener left behind is a leak that
     * grows with the crawl.
     */
    dispose: () => {
      if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
    },
  };
}

export async function collect(
  url: string,
  options: CollectOptions = {},
): Promise<Snapshot> {
  const settings = { ...DEFAULTS, ...options };

  /**
   * Before `launch`, deliberately: a caller that has already gone away must not
   * cost the ~280ms a browser takes to start. It is also what lets the abort
   * path be tested without a Chromium.
   */
  if (settings.signal?.aborted) {
    throw new CollectorError(
      CollectorErrorReason.Aborted,
      `Collecting ${url} was aborted before it began.`,
    );
  }

  /**
   * One browser per collect, closed unconditionally. On serverless that is
   * mandatory — a leaked browser survives into the next invocation on a warm
   * instance and takes several hundred MB of the memory budget with it. In dev
   * a cached one would save 80-120ms on a 1.5-3.5s collect, which is not enough
   * to buy a second code path: it would go stale across an HMR module reload,
   * need a liveness check to notice, and leave production as the only place
   * teardown ever ran.
   *
   * Closing the browser disposes its contexts, so this one `finally` is the
   * whole teardown story.
   */
  const browser = await launch();
  // Started before the `try`, so the `finally` disposes them unconditionally.
  const expiry = getExpiryPromise(url, settings.totalBudgetMs);
  const abortion = getAbortionPromise(url, settings.signal);

  try {
    /**
     * Everything the budget is meant to cover, on one side of the race —
     * opening the context included, since that is a Playwright call and can
     * hang like any other. A step left outside would reject `expiry` with
     * nothing listening.
     */
    const work = render(browser, url, settings);
    // The loser of the race is abandoned, so its rejection needs an owner.
    work.catch(() => {});

    return await Promise.race([work, expiry.promise, abortion.promise]);
  } catch (error) {
    throw toCollectorError(error, `Could not collect ${url}.`);
  } finally {
    expiry.dispose();
    abortion.dispose();
    await browser.close().catch(() => {});
  }
}

async function render(
  browser: Browser,
  url: string,
  settings: RenderSettings,
): Promise<Snapshot> {
  const context = await browser.newContext({
    viewport: settings.viewport,
    userAgent: desktopUserAgent(browser.version()),
    locale: "en-GB",
    // A small business with an expired certificate is still a page worth
    // auditing — and arguably a finding in its own right.
    ignoreHTTPSErrors: true,
  });

  context.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    return SKIPPED_RESOURCES.indexOf(type) === -1
      ? route.continue()
      : route.abort();
  });

  const page = await context.newPage();

  /**
   * `domcontentloaded`, not `load`: a single slow third-party script must not
   * decide whether the audit happens at all.
   */
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  const fetchedAt = new Date().toISOString();

  if (response === null) {
    throw new CollectorError(
      CollectorErrorReason.Blocked,
      `Navigation to ${url} produced no response.`,
    );
  }

  /**
   * The step where naive collectors hang. `networkidle` never resolves on a
   * page with an analytics heartbeat or an open socket, which is most
   * commercial sites — so it is raced against a fixed settle, and the race is
   * the contract: at most `settleTimeoutMs` of extra waiting, however busy the
   * page is.
   */
  await Promise.race([
    page.waitForLoadState("networkidle").catch(() => {}),
    sleep(settings.settleTimeoutMs),
  ]);

  const html = await page.content();
  const raw = await extractFromPage(page);

  return toSnapshot(raw, {
    url,
    finalUrl: page.url(),
    status: response.status(),
    fetchedAt,
    html,
  });
}
