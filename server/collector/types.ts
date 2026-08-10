/**
 * The collector's contract — AUDIT-DESIGN §3.
 *
 * `Snapshot` is the browser's exit door. Playwright runs, fills one of these
 * in, and the browser is disposed; nothing downstream ever sees a `Page`, a
 * locator, or a network call. That is what makes the ~30 rules pure functions
 * over hand-written fixtures with no Chromium in the test run.
 *
 * These types live beside the collector rather than in `types/` because they
 * cross no network boundary — a `Snapshot` never leaves the server. AUDIT-DESIGN
 * §3's own rule of thumb: "`types/` holds shapes that cross a module or network
 * boundary."
 *
 * Every sub-shape is named rather than inlined. `Extracted` in `extract.ts`
 * restates a subset of `Snapshot`, and with utility types ruled out (CLAUDE.md)
 * shared names are what keep the two from drifting.
 */

export type Viewport = "desktop" | "mobile";

export type Rect = { x: number; y: number; w: number; h: number };

export type Dimensions = { w: number; h: number };

export type Heading = {
  /** 1–6. */
  level: number;
  text: string;
  aboveFold: boolean;
};

export type Cta = {
  text: string;
  /** Lowercase tag name — an `<a>` and a `<button>` are scored differently. */
  tag: string;
  href: string | null;
  rect: Rect;
  aboveFold: boolean;
  visible: boolean;
  /**
   * WCAG contrast against the nearest opaque ancestor background.
   * `null` when that background is an image or gradient — an honest gap
   * rather than a fabricated number.
   */
  contrastRatio: number | null;
};

export type FormField = {
  name: string;
  type: string;
  required: boolean;
  label: string | null;
};

export type Form = {
  action: string | null;
  method: string;
  fields: FormField[];
};

export type Image = {
  src: string;
  /** `null` means the attribute is absent; `""` means it is present and empty. */
  alt: string | null;
  natural: Dimensions;
  rendered: Dimensions;
  /** Extension or MIME subtype, lowercased. `""` when undeterminable. */
  format: string;
  loading: string | null;
  // `bytes` returns with the performance pillar — its only source is a CDP
  // `Network.loadingFinished` listener, which this increment does not open.
};

export type Link = {
  href: string;
  text: string;
  external: boolean;
};

export type ConsoleError = {
  level: string;
  text: string;
};

export type Snapshot = {
  /** As requested. */
  url: string;
  /** After redirects. */
  finalUrl: string;
  status: number;
  /** ISO timestamp. */
  fetchedAt: string;
  viewport: Viewport;

  html: string;
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  canonical: string | null;

  headings: Heading[];
  ctas: Cta[];
  forms: Form[];
  images: Image[];
  links: Link[];
  /** Visible innerText — what the readability rules read. */
  text: string;

  consoleErrors: ConsoleError[];

  // `metrics` (lcp, cls, ttfb, transferBytes, requestCount) returns with the
  // performance pillar; `screenshots` returns with Phase 8 Blob storage.
};

export type CollectOptions = {
  signal?: AbortSignal;
  /**
   * Test-only. Lets the integration suite point at a 127.0.0.1 fixture server,
   * which the SSRF guard would otherwise correctly refuse.
   */
  allowPrivateHosts?: boolean;
  /**
   * How long to sit through a "Checking your browser" interstitial before
   * giving up on the site. Defaults to 15s; only an unusually slow WAF origin
   * should need more.
   */
  challengeTimeoutMs?: number;
};

/**
 * Stateful and must be closed — it owns a Chromium process. One per request,
 * disposed in a `finally` (AUDIT-DESIGN §7).
 */
export interface Collector {
  collect(
    url: string,
    viewport: Viewport,
    options?: CollectOptions,
  ): Promise<Snapshot>;
  dispose(): Promise<void>;
}
