import "server-only";

import { chromium, type Browser } from "playwright-core";

/**
 * Where the Chromium binary comes from — AUDIT-DESIGN §2.
 *
 * Two environments, two answers, and no configuration in either:
 *
 * - **On Vercel**, `@sparticuz/chromium` unpacks a Brotli-compressed Linux
 *   build into /tmp. `playwright-core` (~5 MB) plus that (~50 MB) fits the
 *   250 MB bundle budget; the full `playwright` package (~280 MB) does not.
 * - **Locally**, Playwright's `channel` launches whatever browser the machine
 *   already has. No download, no executable path, no env var — the sparticuz
 *   binary is Linux x64 and cannot run on a developer's Mac at all.
 */

// Vercel sets this in the function runtime. Preferred over `VERCEL`, which is
// also set by `vercel dev` on a machine where the Linux binary would not run.
const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_VERSION);

/** Tried in order; the first one installed wins. */
const LOCAL_CHANNELS = ["chrome", "msedge", "chromium"] as const;

export async function launchBrowser(): Promise<Browser> {
  if (isLambda) {
    // A literal specifier — Next's output-file tracing has to be able to follow
    // this statically, or the binary is missing from the deployed bundle.
    const { default: sparticuz } = await import("@sparticuz/chromium");

    // Nothing here needs WebGL, and turning it off saves ~100 MB of a 1 GB budget.
    sparticuz.setGraphicsMode = false;

    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }

  const failures: string[] = [];

  for (const channel of LOCAL_CHANNELS) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      failures.push(
        `${channel}: ${error instanceof Error ? error.message.split("\n")[0] : "failed"}`,
      );
    }
  }

  throw new Error(
    `No local browser could be launched. Install Google Chrome to run the collector locally. Tried — ${failures.join("; ")}`,
  );
}
