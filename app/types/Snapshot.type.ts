/**
 * The collector's contract. Produced by `app/lib/collector`, which renders the
 * page in headless Chromium (Playwright + `@sparticuz/chromium`) and reads the
 * DOM after scripts have run — so what a `Snapshot` describes is the page a
 * visitor gets, not the HTML the server sent. On a site whose body is written
 * by script, those are entirely different pages.
 *
 * What this shape does NOT carry: `aboveFold`, element rectangles, WCAG
 * contrast ratios, rendered-vs-natural image size, and Core Web Vitals. Those
 * are now *reachable* — a browser can measure all of them — and are left
 * uncollected because no rule reads them yet, and a contract grows a field when
 * something consumes it, not before. They land with the rules that need them.
 * Screenshots are absent for a different reason: nothing downstream renders
 * them (`README.md`, "MVP").
 *
 * Nullable fields are `T | null`, never optional: the key is always present, so
 * `"metaDescription" in snapshot` is never the question worth asking. `null`
 * and `""` are different answers; see `alt` below.
 *
 * Member types are `Snapshot`-prefixed because `app/types/index.ts` is a flat
 * global barrel, and `Form`, `Link`, and `Image` are all names a component will
 * want later.
 */

export type SnapshotHeading = {
  /** 1–6, from the tag name. */
  level: number;
  text: string;
};

export type SnapshotCta = {
  text: string;
  /** Lowercase tag name — an <a> and a <button> are scored differently. */
  tag: string;
  href: string | null;
};

export type SnapshotFormField = {
  /** `""` when the attribute is absent — the collector never emits null here. */
  name: string;
  /** `"text"` for a bare <input>; the tag name for <select> and <textarea>. */
  type: string;
  required: boolean;
  label: string | null;
};

export type SnapshotForm = {
  action: string | null;
  /** Lowercased, defaulting to `"get"`. */
  method: string;
  fields: SnapshotFormField[];
};

export type SnapshotImage = {
  /** Absolutised against the final URL, or `""` when the attribute is absent. */
  src: string;
  /** `null` means the attribute is absent; `""` means present and empty. */
  alt: string | null;
  /** The width/height *attributes* — not the rendered or the intrinsic size. */
  width: number | null;
  height: number | null;
  loading: string | null;
};

export type SnapshotLink = {
  href: string;
  text: string;
  /**
   * True when the link leaves this site: another origin, or a scheme that is
   * not the web at all (`mailto:`, `tel:`). Same-origin links are the ones
   * `SiteProfile.pages` is derived from.
   */
  external: boolean;
};

export type Snapshot = {
  /** As requested. */
  url: string;
  /** After redirects. */
  finalUrl: string;
  /**
   * The *target site's* status, not the collector's. A 404 or a 500 is still a
   * page worth auditing, so it travels in the snapshot instead of failing the
   * fetch — only a transport error does that.
   */
  status: number;
  /** ISO 8601. */
  fetchedAt: string;

  /** The rendered DOM (`page.content()`), not the transport body. */
  html: string;
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  canonical: string | null;

  headings: SnapshotHeading[];
  ctas: SnapshotCta[];
  forms: SnapshotForm[];
  images: SnapshotImage[];
  links: SnapshotLink[];
  /**
   * `body.innerText`: layout-aware visible copy, so script bodies and anything
   * `display:none` are absent rather than stripped after the fact. Line
   * structure survives; runs of spaces do not.
   */
  text: string;
};
