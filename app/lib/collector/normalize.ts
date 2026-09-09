import type {
  Snapshot,
  SnapshotCta,
  SnapshotForm,
  SnapshotFormField,
  SnapshotHeading,
  SnapshotImage,
  SnapshotLink,
} from "@/app/types";

import type {
  RawCtaCandidate,
  RawForm,
  RawHeading,
  RawImage,
  RawLink,
  RawPage,
} from "./extract";

/** Everything the browser cannot know: what was asked for, and what came back. */
export type SnapshotMeta = {
  url: string;
  finalUrl: string;
  status: number;
  fetchedAt: string;
  html: string;
};

/**
 * A class name that marks a link as an action.
 *
 * The delimiter is "not alphanumeric" rather than `\b`, because `\b` treats an
 * underscore as a word character and BEM — `hero__cta`, `header__btn` — is how
 * a large share of real sites name these. "buttonhole" and "octagon" are still
 * rejected: the token has to stand alone.
 */
const CTA_CLASS_PATTERN = /(?:^|[^a-z0-9])(btn|button|cta)(?:[^a-z0-9]|$)/i;

/** The only input types that are an action rather than a field. */
const CTA_INPUT_TYPES = ["submit", "button"];

const WEB_SCHEMES = ["http:", "https:"];

/**
 * `innerText` already collapses most runs, but markup like
 * `<a>Book\n  now</a>` still arrives with the source's indentation in it.
 * Every text field in a `Snapshot` goes through here so that a finding's
 * evidence never quotes a newline.
 */
export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Body text gets a gentler treatment than `collapse`: runs of spaces go, but
 * line structure survives, with blank runs capped at one. `innerText` puts a
 * newline where the page puts a block boundary, and flattening those to spaces
 * would throw away the only paragraph information the snapshot has — which is
 * exactly what a readability rule would want to read.
 */
export function collapseBlock(text: string): string {
  return text
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * `width="100"` and `width="100px"` are 100; `width="auto"`, `width="50%"` and
 * `width=""` are `null`. Refusing to parse a percentage is the whole reason
 * this is not `parseInt` — `parseInt("50%")` is 50, and a rule comparing that
 * against a pixel budget would be silently wrong.
 */
export function parseDimension(value: string | null): number | null {
  if (value === null) return null;
  const match = /^\s*(\d+)\s*(px)?\s*$/i.exec(value);
  return match === null ? null : Number(match[1]);
}

export function toHeadings(raw: RawHeading[]): SnapshotHeading[] {
  return raw
    .map((heading) => ({ level: heading.level, text: collapse(heading.text) }))
    .filter((heading) => heading.text.length > 0);
}

/**
 * Whether a candidate is a call to action, and the one heuristic in this module
 * worth arguing about.
 *
 * Both kinds of error are expensive, in opposite directions, and both were
 * observed on real pages before this took its current shape:
 *
 * - Counting chrome makes `conversion.no-cta` — the registry's only `critical`
 *   rule — unfireable. Every modern site has a cookie banner and a menu
 *   toggle, so a rule that just counts `<button>` elements reports "this page
 *   has actions" about a page whose only actions are consent and navigation.
 *   `www.gov.uk` yields eight such buttons and not one thing to buy.
 * - Requiring a "btn" class misses the primary action on any site built with
 *   utility CSS, which is most of them now. `vercel.com`'s "Deploy now" and
 *   "Talk to sales" carry no such class and are unmistakably buttons on screen.
 *
 * So the test is what a visitor sees, not what the markup is called: an
 * element that is laid out, has visible text, is not a disclosure or consent
 * or search control, and is either a real button or is *painted* as one.
 * Deciding that needs a rendering engine, which is the strongest single
 * argument for this collector running a browser at all.
 *
 * What it still misses — a `<div onclick>` with no button styling — costs a
 * finding that the model's second opinion (`app/lib/analyze`) tends to raise as
 * a divergence, which is what that comparison is for.
 */
export function isCta(candidate: RawCtaCandidate): boolean {
  if (!candidate.visible) return false;
  if (!collapse(candidate.text)) return false;

  // Chrome: present on nearly every page, and never the thing being sold.
  if (candidate.disclosure) return false;
  if (candidate.isInCookieBanner) return false;
  if (candidate.isInSearchForm) return false;

  if (candidate.tag === "button") return true;

  if (candidate.tag === "input") {
    return (
      candidate.inputType !== null &&
      CTA_INPUT_TYPES.indexOf(candidate.inputType) !== -1
    );
  }

  if (candidate.tag === "a") {
    if (candidate.role !== null && candidate.role.toLowerCase() === "button") {
      return true;
    }
    return candidate.buttonLike || CTA_CLASS_PATTERN.test(candidate.className);
  }

  return false;
}

export function toCtas(raw: RawCtaCandidate[]): SnapshotCta[] {
  return raw.filter(isCta).map((candidate) => ({
    text: collapse(candidate.text),
    tag: candidate.tag,
    href: candidate.href,
  }));
}

function toFormField(field: {
  name: string | null;
  type: string;
  required: boolean;
  label: string | null;
}): SnapshotFormField {
  return {
    // `""`, not null — the contract is explicit that this field never nulls.
    name: field.name === null ? "" : collapse(field.name),
    type: field.type,
    required: field.required,
    label: collapse(field.label ?? "") || null,
  };
}

export function toForms(raw: RawForm[]): SnapshotForm[] {
  return raw.map((form) => ({
    action: form.action,
    // A form with no method attribute is a GET form; that is the HTML default,
    // not an assumption.
    method: (form.method === null ? "get" : form.method).toLowerCase().trim(),
    fields: form.fields.map(toFormField),
  }));
}

export function toImages(raw: RawImage[]): SnapshotImage[] {
  return raw.map((image) => ({
    src: image.src,
    // `alt` is the one field where empty and absent must stay distinguishable:
    // `alt=""` is a deliberate "decorative", a missing `alt` is an oversight,
    // and an accessibility rule has to tell them apart.
    alt: image.alt,
    width: parseDimension(image.width),
    height: parseDimension(image.height),
    loading: collapse(image.loading ?? "") || null,
  }));
}

/**
 * `external` means "leaves this site": another origin, or a scheme that is not
 * the web at all (`mailto:`, `tel:`).
 *
 * This is wider than the contract's original wording, which named only the
 * non-http(s) schemes — a same-scheme link to a different host was somehow
 * internal. Nothing reads the field yet, and the route needs the origin-aware
 * meaning to derive `SiteProfile.pages` from same-site links, so the wider
 * definition is the one implemented and `Snapshot.type.ts` says so.
 */
export function toLinks(raw: RawLink[], pageOrigin: string): SnapshotLink[] {
  return raw.map((link) => ({
    href: link.href,
    text: collapse(link.text),
    external:
      WEB_SCHEMES.indexOf(link.protocol) === -1 || link.origin !== pageOrigin,
  }));
}
export function toSnapshot(raw: RawPage, meta: SnapshotMeta): Snapshot {
  return {
    url: meta.url,
    finalUrl: meta.finalUrl,
    status: meta.status,
    fetchedAt: meta.fetchedAt,

    html: meta.html,
    title: collapse(raw.title ?? "") || null,
    metaDescription: collapse(raw.metaDescription ?? "") || null,
    lang: collapse(raw.lang ?? "") || null,
    canonical: collapse(raw.canonical ?? "") || null,

    headings: toHeadings(raw.headings),
    ctas: toCtas(raw.ctaCandidates),
    forms: toForms(raw.forms),
    images: toImages(raw.images),
    links: toLinks(raw.links, raw.origin),
    text: collapseBlock(raw.text),
  };
}
