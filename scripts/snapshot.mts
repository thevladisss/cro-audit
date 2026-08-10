/**
 * Print a real `Snapshot` for a live URL.
 *
 *   npm run snapshot -- https://example.com
 *   npm run snapshot -- https://example.com mobile
 *   npm run snapshot -- https://example.com desktop --full
 *
 * AUDIT-DESIGN Phase 1's "done when". By default it prints a summary rather
 * than the whole object, because `html` alone is tens of kilobytes and burying
 * the numbers you came to check is the opposite of useful. `--full` dumps the
 * raw JSON for piping into `jq`.
 *
 * The npm script passes `--conditions=react-server`. Without it, `server-only`
 * resolves to the module that throws by design, and every file in `server/`
 * imports it. That is also why relative specifiers in `server/` carry explicit
 * `.ts` extensions: Node's ESM resolver has no extensionless lookup, and this
 * is the one entry point that is plain Node rather than Turbopack or Vitest.
 */

import { createCollector } from "../server/collector/collector.ts";
import type { Snapshot, Viewport } from "../server/collector/types.ts";

const [, , url, ...rest] = process.argv;

if (!url) {
  console.error("Usage: npm run snapshot -- <url> [desktop|mobile] [--full]");
  process.exit(1);
}

const full = rest.includes("--full");
const viewport: Viewport = rest.includes("mobile") ? "mobile" : "desktop";

const collector = await createCollector();

try {
  const started = Date.now();
  const snapshot = await collector.collect(url, viewport);
  const elapsed = Date.now() - started;

  if (full) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    summarize(snapshot, elapsed);
  }
} catch (error) {
  console.error(`\nFailed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  // Never leave a browser alive — the reason this is a `finally` and not a
  // trailing statement is that the catch above must not skip it.
  await collector.dispose();
}

function summarize(snapshot: Snapshot, elapsed: number): void {
  const aboveFold = snapshot.ctas.filter((c) => c.aboveFold);
  const lowContrast = snapshot.ctas.filter(
    (c) => c.contrastRatio !== null && c.contrastRatio < 4.5,
  );
  const missingAlt = snapshot.images.filter((i) => i.alt === null);
  const oversized = snapshot.images.filter(
    (i) => i.rendered.w > 0 && i.natural.w > i.rendered.w * 2,
  );

  console.log(`
${snapshot.viewport}  ${snapshot.status}  ${elapsed}ms
  url        ${snapshot.url}
  finalUrl   ${snapshot.finalUrl}
  title      ${snapshot.title ?? "(none)"}
  meta       ${snapshot.metaDescription ?? "(none)"}
  lang       ${snapshot.lang ?? "(none)"}
  canonical  ${snapshot.canonical ?? "(none)"}

  headings   ${snapshot.headings.length} (${snapshot.headings.filter((h) => h.aboveFold).length} above fold, ${snapshot.headings.filter((h) => h.level === 1).length} h1)
  ctas       ${snapshot.ctas.length} (${aboveFold.length} above fold, ${lowContrast.length} under 4.5:1)
  forms      ${snapshot.forms.length} (${snapshot.forms.reduce((n, f) => n + f.fields.length, 0)} fields)
  images     ${snapshot.images.length} (${missingAlt.length} missing alt, ${oversized.length} oversized)
  links      ${snapshot.links.length} (${snapshot.links.filter((l) => l.external).length} external)
  text       ${snapshot.text.length} chars
  html       ${snapshot.html.length} chars
  console    ${snapshot.consoleErrors.length} errors/warnings

  first CTAs`);

  for (const cta of snapshot.ctas.slice(0, 5)) {
    const contrast = cta.contrastRatio === null ? "  n/a" : `${cta.contrastRatio}:1`.padStart(6);
    const position = `${Math.round(cta.rect.x)},${Math.round(cta.rect.y)}`.padStart(9);
    const size = `${Math.round(cta.rect.w)}x${Math.round(cta.rect.h)}`.padStart(9);
    const fold = cta.aboveFold ? "fold" : "    ";
    console.log(
      `    ${contrast} ${position} ${size} ${fold}  ${cta.text.slice(0, 40) || "(no text)"}`,
    );
  }

  console.log();
}
