/**
 * Where a Chromium comes from, and nothing else.
 *
 * The environments differ in exactly one thing — the binary.
 * `@sparticuz/chromium` on Lambda or Vercel, Playwright's own install on a
 * laptop. Who owns the browser and when it closes is `collect`'s business.
 *
 * Both packages are pinned to exact versions rather than caret ranges, and that
 * is load-bearing: `playwright-core@1.61.0` bundles Chromium 149.0.7827.55 and
 * `@sparticuz/chromium@149.0.0` ships the same major. Playwright speaks CDP to
 * whatever binary it is handed but is only *tested* against its own, so a
 * routine `npm update` that moved one and not the other would not fail loudly —
 * it would hang a call and surface as a timeout on a page that is fine. Move
 * the two together or not at all.
 *
 * `playwright-core` is pinned to 1.61.0 because it bundles Chromium 149, the
 * same major `@sparticuz/chromium@149` ships. Playwright speaks CDP to whatever
 * binary it is handed, and it is only *tested* against its own — so the pin is
 * load-bearing, and the launch logs the version it actually got.
 */

import { chromium as playwright } from "playwright-core";
import type { Browser } from "playwright-core";

import { CollectorError, CollectorErrorReason } from "./errors";

/**
 * Vercel sets `VERCEL`; every Lambda sets `AWS_LAMBDA_FUNCTION_NAME`. Neither
 * exists on a laptop, which is the only distinction that matters here.
 */
export function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? undefined,
  );
}

/**
 * A user agent that matches the browser actually doing the fetching, rather
 * than a copied constant that claims macOS from a Linux container. The default
 * Playwright UA says "HeadlessChrome", which a fair number of sites reject
 * outright; this is the same string with that one token corrected.
 *
 * That is the whole of the anti-blocking effort. A site that blocks datacentre
 * IPs will block this too, and the honest outcome is a `blocked` error the user
 * can read — not an evasion arms race this product has no business entering.
 */
export function desktopUserAgent(version: string): string {
  const major = version.split(".")[0];
  const platform =
    process.platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10_15_7"
      : process.platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";

  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/**
 * A browser, or a `CollectorError` explaining why not. The caller owns it and
 * is responsible for closing it.
 */
export async function launch(): Promise<Browser> {
  try {
    // running on Vercel / Lambda functions
    if (isServerless()) {
      // Imported lazily: on a laptop this package is a 50MB Linux binary that
      // nothing is going to run, and resolving it costs a real second.
      const { default: chromium } = await import("@sparticuz/chromium");

      return await playwright.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    }

    // runs on a local machine
    return await playwright.launch({
      headless: true,
      // Playwright finds its own install; `CHROMIUM_PATH` is the escape hatch
      // for a machine that would rather use the Chrome it already has.
      executablePath: process.env.CHROMIUM_PATH,
    });
  } catch (cause) {
    throw new CollectorError(
      CollectorErrorReason.Browser,
      "Could not launch Chromium. Run `npx playwright install chromium` for local development.",
      cause,
    );
  }
}
