import "server-only";

import type { Browser, BrowserContextOptions, Page } from "playwright-core";

import { assertSafeUrl } from "../safety.ts";
import { launchBrowser } from "./browser.ts";
import {
  challengeMessage,
  detectChallenge,
  type ChallengeVerdict,
} from "./challenge.ts";
import { extract } from "./extract.ts";
import type {
  CollectOptions,
  Collector,
  ConsoleError,
  Snapshot,
  Viewport,
} from "./types.ts";

const NAV_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 15_000;
/** Long enough for the usual post-load paint, short enough to stay in budget. */
const SETTLE_MS = 750;
/**
 * How long to sit through a "Checking your browser" page. Cloudflare's own
 * check advertises ~5s and usually clears sooner; the rest is headroom for a
 * slow origin behind it. Polling means an uncontested page pays none of this.
 */
const CHALLENGE_TIMEOUT_MS = 15_000;
const CHALLENGE_POLL_MS = 400;

/**
 * Both viewports are real device shapes rather than round numbers, because the
 * responsive rules compare them and a 1000×1000 window matches nothing anyone
 * browses on. `reducedMotion` keeps an animation from deciding what a rect is.
 */
const VIEWPORTS: Record<Viewport, BrowserContextOptions> = {
  desktop: {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    reducedMotion: "reduce",
  },
  mobile: {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    // An Android Chrome UA, not iOS Safari — the engine underneath is Chromium,
    // and a UA that contradicts the engine is what fingerprinting scripts flag.
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    reducedMotion: "reduce",
  },
};

/**
 * Launches one browser and hands back the handle to it.
 *
 * The caller owns the lifetime and must `dispose()` in a `finally` — Chromium
 * wants ~1 GB against Hobby's 2 GB, so one browser per request and one page at
 * a time, always (AUDIT-DESIGN §7).
 */
export async function createCollector(): Promise<Collector> {
  const browser: Browser = await launchBrowser();

  return {
    async collect(url, viewport, options = {}) {
      return collectOne(browser, url, viewport, options);
    },

    async dispose() {
      await browser.close();
    },
  };
}

async function collectOne(
  browser: Browser,
  url: string,
  viewport: Viewport,
  options: CollectOptions,
): Promise<Snapshot> {
  const {
    signal,
    allowPrivateHosts = false,
    challengeTimeoutMs = CHALLENGE_TIMEOUT_MS,
  } = options;

  throwIfAborted(signal);

  if (!allowPrivateHosts) await assertSafeUrl(url);

  const context = await browser.newContext(VIEWPORTS[viewport]);
  const consoleErrors: ConsoleError[] = [];

  // Closing the context is what actually interrupts an in-flight navigation;
  // checking `signal.aborted` between awaits only catches it at the seams.
  const onAbort = () => void context.close().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const page = await context.newPage();

    page.on("console", (message) => {
      const level = message.type();
      if (level === "error" || level === "warning") {
        consoleErrors.push({ level, text: message.text() });
      }
    });

    let blocked: string | null = null;

    await guardRequests(page, allowPrivateHosts, (reason) => {
      blocked ??= reason;
    });

    const response = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
      .catch((error: unknown) => {
        // A blocked navigation surfaces as ERR_BLOCKED_BY_CLIENT, which tells a
        // user nothing. Replace it with the reason the guard actually had.
        if (blocked) throw new Error(blocked);
        throw error;
      });

    if (blocked) throw new Error(blocked);

    // A slow tail should not lose the whole render — `load` timing out still
    // leaves a DOM worth extracting. `networkidle` is deliberately not used:
    // Playwright discourages it, and analytics beacons keep it from ever firing.
    await page.waitForLoadState("load", { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);

    throwIfAborted(signal);

    // WordPress sites are usually behind a WAF that answers the first request
    // with a holding page. Sit through it rather than auditing it.
    const verdict = await settleThroughChallenge(page, challengeTimeoutMs, signal);
    if (verdict.challenged) throw new Error(challengeMessage(verdict.vendor));

    throwIfAborted(signal);

    const extracted = await extract(page);

    return {
      url,
      finalUrl: page.url(),
      status: response?.status() ?? 0,
      fetchedAt: new Date().toISOString(),
      viewport,
      consoleErrors,
      ...extracted,
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await context.close().catch(() => {});
  }
}

/**
 * AUDIT-DESIGN §7's per-navigation interceptor.
 *
 * Validating only the URL the user typed is not enough twice over: a 302 to
 * 169.254.169.254 skips that check entirely, and a subresource fetched from a
 * private address can be injected into the DOM by page script and land in the
 * `html` and `text` we return. So every http(s) request is checked, memoized by
 * host so the cost is one DNS lookup per distinct origin rather than per asset.
 */
async function guardRequests(
  page: Page,
  allowPrivateHosts: boolean,
  onBlocked: (reason: string) => void,
): Promise<void> {
  const verdicts = new Map<string, Promise<boolean>>();

  const isOriginSafe = (origin: string): Promise<boolean> => {
    let verdict = verdicts.get(origin);

    if (!verdict) {
      verdict = assertSafeUrl(origin).then(
        () => true,
        () => false,
      );
      verdicts.set(origin, verdict);
    }

    return verdict;
  };

  await page.route("**/*", async (route) => {
    const target = route.request().url();

    // `data:` and `blob:` are inert — no egress, nothing to protect against.
    if (/^(data|blob|about):/i.test(target)) {
      await route.continue();
      return;
    }

    if (!/^https?:/i.test(target)) {
      onBlocked("That URL scheme is not allowed.");
      await route.abort("blockedbyclient");
      return;
    }

    if (allowPrivateHosts) {
      await route.continue();
      return;
    }

    if (await isOriginSafe(new URL(target).origin)) {
      await route.continue();
      return;
    }

    if (route.request().isNavigationRequest()) {
      onBlocked("That host is not reachable.");
    }

    await route.abort("blockedbyclient");
  });
}

/**
 * Sit through a "Checking your browser" interstitial.
 *
 * Polling rather than a fixed sleep, for two reasons. An uncontested page —
 * which is nearly all of them — pays nothing, instead of adding seconds to
 * every render in a 240s budget. And a page still showing the interstitial when
 * the deadline passes is *reported*, not quietly scored: that document has no
 * H1, no CTAs and no copy, so auditing it would produce a confident report
 * about the wrong page, which is worse than an error.
 */
async function settleThroughChallenge(
  page: Page,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ChallengeVerdict> {
  let verdict = await readChallenge(page);
  if (!verdict.challenged) return verdict;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return verdict;

    await page.waitForTimeout(CHALLENGE_POLL_MS);
    verdict = await readChallenge(page);

    if (!verdict.challenged) {
      // It cleared by reloading into the real site. That document has only just
      // started, so give it the same load-and-settle the first one got.
      await page.waitForLoadState("load", { timeout: LOAD_TIMEOUT_MS }).catch(() => {});
      await page.waitForTimeout(SETTLE_MS);
      return readChallenge(page);
    }
  }

  // The deadline can land mid-navigation, which reads as still-challenged. Take
  // one more look before calling it, so a near-miss is not reported as a block.
  await page.waitForLoadState("load", { timeout: 2_000 }).catch(() => {});
  return readChallenge(page);
}

async function readChallenge(page: Page): Promise<ChallengeVerdict> {
  try {
    const [title, text] = await Promise.all([
      page.title(),
      page.evaluate(() => document.body?.innerText ?? ""),
    ]);
    return detectChallenge(title, text);
  } catch {
    // "Execution context was destroyed" — the page is navigating, which is
    // exactly the transition being waited for. Not cleared yet.
    return { challenged: true, vendor: null };
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error("Collection was cancelled.");
}
