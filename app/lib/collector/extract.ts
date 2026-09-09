import type { Page } from "playwright-core";

/** A heading's level comes from the tag name; the text is still raw. */
export type RawHeading = { level: number; text: string };

/**
 * A CTA *candidate* — every anchor, button, and button-ish input on the page.
 * `normalize.ts` decides which of these is actually a call to action; this only
 * gathers the facts that decision needs.
 */
export type RawCtaCandidate = {
  /** Lowercased tag name: "a", "button", or "input". */
  tag: string;
  /** `innerText` for a/button, the `value` attribute for an input. Raw. */
  text: string;
  /** Absolute, for anchors with an href. `null` otherwise. */
  href: string | null;
  role: string | null;
  className: string;
  /** `input`'s lowercased type, `null` for a/button. */
  inputType: string | null;
  /** `getClientRects().length > 0` — false for anything the page does not lay out. */
  visible: boolean;
  /** Carries `aria-expanded`/`aria-haspopup`: a menu toggle, not an action. */
  disclosure: boolean;
  /** Sits inside a cookie or consent container. */
  isInCookieBanner: boolean;
  /** Sits inside a search form or an ARIA search landmark. */
  isInSearchForm: boolean;
  /** Laid out like a button — filled or outlined, with real padding. */
  buttonLike: boolean;
};

export type RawFormField = {
  name: string | null;
  type: string;
  required: boolean;
  label: string | null;
};

export type RawForm = {
  /** Absolute when the attribute is present, `null` when it is absent. */
  action: string | null;
  /** The attribute verbatim — the "get" default is applied in normalize. */
  method: string | null;
  fields: RawFormField[];
};

export type RawImage = {
  /** Absolute. `""` when the element has no usable source. */
  src: string;
  /** `null` when the attribute is absent, `""` when present and empty. */
  alt: string | null;
  /** The attributes verbatim; parsed in normalize. */
  width: string | null;
  height: string | null;
  loading: string | null;
};

export type RawLink = {
  /** Absolute for http(s); the raw target for mailto:, tel:, and friends. */
  href: string;
  text: string;
  /** Lowercased, with the colon: "https:", "mailto:". */
  protocol: string;
  /** The anchor's origin, or "null" for schemes that have none. */
  origin: string;
};

/** The head-level facts, all of them nullable on a page that omits them. */
export type RawMeta = {
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  canonical: string | null;
};

export type RawPage = RawMeta & {
  headings: RawHeading[];
  ctaCandidates: RawCtaCandidate[];
  forms: RawForm[];
  images: RawImage[];
  links: RawLink[];
  /** `body.innerText` — rendered, layout-aware, script and hidden text excluded. */
  text: string;
  /** `location.origin`, so normalize can classify links without re-parsing. */
  origin: string;
};

/**
 * The subset of a rendered box `looksLikeButton` judges on — a plain record so
 * the judgement can be tested without a layout engine behind it.
 */
export type RenderedBox = {
  display: string;
  backgroundColor: string;
  borderTopWidth: string;
  borderTopStyle: string;
  width: number;
  height: number;
};

// Element level helpers

export function isVisible(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * `innerText` rather than `textContent` throughout: it is layout-aware, so text
 * inside `display:none` is absent and text broken across elements comes back
 * with the spacing a reader sees. This is the main thing a browser buys over an
 * HTML parse.
 */
export function  getRenderedText(element: HTMLElement | null): string {
  return element === null ? "" : element.innerText;
}

/**
 * Chrome, not conversion. Cookie banners and menu toggles are buttons on every
 * modern site, and counting them means `conversion.no-cta` — the registry's
 * only critical rule — can never fire again. The signals are structural (ARIA
 * roles and container naming) rather than a list of button captions, so they do
 * not need translating for a non-English page.
 */
export function isInCookieBanner(element: Element): boolean {
  const COOKIE_CONTAINER = /cookie|consent|gdpr|cmp[-_]/i;

  let node: Element | null = element;
  for (let depth = 0; node !== null && depth < 8; depth++) {
    const id = node.id;
    const className = typeof node.className === "string" ? node.className : "";
    if (COOKIE_CONTAINER.test(id) || COOKIE_CONTAINER.test(className)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Determines whether an element is within a search form or search region.
 * Walks up the DOM tree using `closest()` to check for an ancestor with
 * `role="search"`. If none is found, checks the nearest `<form>` ancestor
 * and verifies it contains an `<input type="search">`.
 */
export function isInSearchForm(element: Element): boolean {
  if (element.closest('[role="search" i]') !== null) return true;
  const form = element.closest("form");
  return form !== null && form.querySelector('input[type="search" i]') !== null;
}

/**
 * The signal a class-name heuristic cannot reach, and the reason this module
 * runs a browser: utility-class CSS is now the norm, so a page's primary action
 * is routinely an `<a>` with no "btn" anywhere in its markup. What makes it read
 * as a button is that it is *painted* like one — filled or outlined, and about
 * the size and shape of a button. That is a rendering question, and only a
 * rendering engine can answer it.
 *
 * The measurement is the painted box rather than the padding, because a modern
 * design system gives a button its height with `height` plus flex centring and
 * no vertical padding at all — `vercel.com`'s "Deploy now" is `padding: 0 12px`,
 * and a padding test misses every button on the page.
 *
 * The size window is what keeps painted *cards*, nav bars, and hero panels out:
 * they are anchors with backgrounds too, and they are the wrong shape.
 */
export function looksLikeButton(box: RenderedBox, viewportWidth: number): boolean {
  if (box.display === "inline") return false;

  const painted =
    box.backgroundColor !== "transparent" &&
    box.backgroundColor !== "rgba(0, 0, 0, 0)";
  const outlined =
    parseFloat(box.borderTopWidth) > 0 && box.borderTopStyle !== "none";
  if (!painted && !outlined) return false;

  if (box.height < 28 || box.height > 80) return false;

  const widest = Math.max(320, viewportWidth * 0.5);
  return box.width >= 48 && box.width <= widest;
}

/** Reads the box off a live element and hands the judgement to `looksLikeButton`. */
export function isButtonLike(element: Element, viewportWidth: number): boolean {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();

  return looksLikeButton(
    {
      display: style.display,
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      width: rect.width,
      height: rect.height,
    },
    viewportWidth,
  );
}

/**
 * Label resolution, in the order a browser would: the DOM's own `labels`
 * collection covers both `<label for>` and an ancestor `<label>`, then the ARIA
 * attributes, then the placeholder as a last resort. A field with none of these
 * is genuinely unlabelled, which is worth reporting as `null`.
 */
export function getLabelFor(element: Element, doc: Document): string | null {
  const labels = (
    element as HTMLInputElement & { labels?: NodeListOf<HTMLLabelElement> }
  ).labels;
  if (labels && labels.length > 0) {
    const text = getRenderedText(labels[0]);
    if (text !== "") return text;
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel !== "") return ariaLabel;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const target = doc.getElementById(labelledBy);
    const text = getRenderedText(target as HTMLElement | null);
    if (text !== "") return text;
  }

  const placeholder = element.getAttribute("placeholder");
  if (placeholder !== null && placeholder !== "") return placeholder;

  return null;
}

// Section Collectors

export function collectHeadings(doc: Document): RawHeading[] {
  const headings: RawHeading[] = [];
  doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((element) => {
    headings.push({
      level: Number(element.tagName.charAt(1)),
      text: getRenderedText(element as HTMLElement),
    });
  });
  return headings;
}

export function collectCtaCandidates(
  doc: Document,
  viewportWidth: number,
): RawCtaCandidate[] {
  const ctaCandidates: RawCtaCandidate[] = [];

  doc.querySelectorAll("a, button, input").forEach((element) => {
    const tag = element.tagName.toLowerCase();
    const inputType =
      tag === "input"
        ? (element.getAttribute("type") ?? "text").toLowerCase()
        : null;

    // An input carries its label in `value`; there is no rendered text to read.
    const text =
      tag === "input"
        ? (element.getAttribute("value") ?? "")
        : getRenderedText(element as HTMLElement);

    const anchor = tag === "a" ? (element as HTMLAnchorElement) : null;

    const visible = isVisible(element);

    ctaCandidates.push({
      tag,
      text,
      href: anchor !== null && anchor.hasAttribute("href") ? anchor.href : null,
      role: element.getAttribute("role"),
      className: element.getAttribute("class") ?? "",
      inputType,
      visible,
      disclosure:
        element.hasAttribute("aria-expanded") ||
        element.hasAttribute("aria-haspopup"),
      isInCookieBanner: isInCookieBanner(element),
      isInSearchForm: isInSearchForm(element),
      // Only worth measuring for a visible anchor: buttons already count, and
      // computed style on an off-screen element is a wasted style recalc.
      buttonLike:
        visible && tag === "a" ? isButtonLike(element, viewportWidth) : false,
    });
  });

  return ctaCandidates;
}

export function collectForms(doc: Document): RawForm[] {
  /**
   * Hidden inputs and the form's own submit controls are not fields a visitor
   * fills in. Counting a CSRF token as a form field is how a future "this form
   * asks for too much" rule ends up wrong on every framework.
   */
  const SKIPPED_INPUT_TYPES = ["hidden", "submit", "button", "reset", "image"];

  const forms: RawForm[] = [];

  doc.querySelectorAll("form").forEach((form) => {
    const fields: RawFormField[] = [];

    form.querySelectorAll("input, select, textarea").forEach((element) => {
      const tag = element.tagName.toLowerCase();
      const type =
        tag === "input"
          ? (element.getAttribute("type") ?? "text").toLowerCase()
          : tag;

      if (tag === "input" && SKIPPED_INPUT_TYPES.indexOf(type) !== -1) return;

      fields.push({
        name: element.getAttribute("name"),
        type,
        required:
          element.hasAttribute("required") ||
          element.getAttribute("aria-required") === "true",
        label: getLabelFor(element, doc),
      });
    });

    forms.push({
      action: form.hasAttribute("action") ? form.action : null,
      method: form.getAttribute("method"),
      fields,
    });
  });

  return forms;
}

export function collectImages(doc: Document): RawImage[] {
  const images: RawImage[] = [];

  doc.querySelectorAll("img").forEach((image) => {
    // The attribute decides presence; the property gives absolutisation.
    // `currentSrc` covers `srcset`/`<picture>`, which have no `src` at all.
    //
    // TODO: `currentSrc` is the *selected* source, and selection is a side
    // effect of the load — which `collector.ts`'s SKIPPED_RESOURCES aborts. So
    // in a real collect a `<picture>`/`srcset` image lands as `src: ""`, which
    // `Snapshot.type.ts` defines as "the attribute is absent": the two cases are
    // currently indistinguishable. Harmless while no rule reads `src`. The fix,
    // when one does, is to parse the `srcset` attribute here rather than ask the
    // browser which source it picked, because it will not have picked one.
    const hasSrc = image.hasAttribute("src") && image.getAttribute("src") !== "";
    const src = hasSrc ? image.src : (image.currentSrc ?? "");

    images.push({
      src,
      alt: image.getAttribute("alt"),
      width: image.getAttribute("width"),
      height: image.getAttribute("height"),
      loading: image.getAttribute("loading"),
    });
  });

  return images;
}

export function collectLinks(doc: Document): RawLink[] {
  const links: RawLink[] = [];

  doc.querySelectorAll("a[href]").forEach((element) => {
    const anchor = element as HTMLAnchorElement;
    links.push({
      href: anchor.href,
      text: getRenderedText(anchor),
      protocol: anchor.protocol.toLowerCase(),
      origin: anchor.origin,
    });
  });

  return links;
}

export function collectMeta(doc: Document): RawMeta {
  const description = doc.querySelector('meta[name="description" i]');
  const canonical = doc.querySelector('link[rel="canonical" i]');

  return {
    title: doc.title,
    metaDescription:
      description === null ? null : (description.getAttribute("content") ?? null),
    lang: doc.documentElement.lang,
    canonical: canonical === null ? null : (canonical as HTMLLinkElement).href,
  };
}

// Entry point

/**
 * Runs in the page. Keep it total: a missing `<body>`, a `<form>` with no
 * fields, an `<img>` with no `src` are all pages worth auditing, so every read
 * degrades to a null rather than throwing. One exception here fails the whole
 * collection.
 *
 * The parameters default to the page's own globals so the serialized call site
 * stays a bare `extractPage()`; a test passes a jsdom document instead.
 */
export function extractPage(
  doc: Document = document,
  viewportWidth: number = window.innerWidth,
): RawPage {
  return {
    ...collectMeta(doc),
    headings: collectHeadings(doc),
    ctaCandidates: collectCtaCandidates(doc, viewportWidth),
    forms: collectForms(doc),
    images: collectImages(doc),
    links: collectLinks(doc),
    text: getRenderedText(doc.body),
    origin: doc.location.origin,
  };
}

/**
 * Every function whose source has to travel to the page. Order does not matter
 * — they are all `function` declarations, so they hoist within the scope
 * `extractFromPage` builds — but an omission does, and shows up as a
 * `ReferenceError` from `page.evaluate`, not as a type error here.
 */
export const IN_PAGE_FUNCTIONS = [
  isVisible,
  getRenderedText,
  isInCookieBanner,
  isInSearchForm,
  looksLikeButton,
  isButtonLike,
  getLabelFor,
  collectHeadings,
  collectCtaCandidates,
  collectForms,
  collectImages,
  collectLinks,
  collectMeta,
  extractPage,
];

/**
 * The exact source shipped to the page. Exported so a test can evaluate the
 * same string rather than a reconstruction of it — the concatenation is the
 * part that fails, so it is the part worth exercising.
 *
 * The declarations are concatenated into one expression so that every helper is
 * in scope by the time the entry point runs. The entry point is named through
 * `extractPage.name` rather than spelled out, because a production build may
 * mangle these declarations — consistently, and `Function.prototype.toString`
 * reports the names the runtime actually has, so reading the name off the
 * function is the only spelling that survives.
 */
export function inPageScript(): string {
  const declarations = IN_PAGE_FUNCTIONS.map((fn) => fn.toString()).join("\n\n");
  return `(() => {\n${declarations}\n\nreturn ${extractPage.name}();\n})()`;
}

/**
 * Runs the extractor in `page` and returns what it found — the only supported
 * way into this module from Node.
 *
 * A caller that reaches past this to `page.evaluate(extractPage)` gets a
 * runtime `ReferenceError`, not a type error: the page has no module scope.
 */
export async function extractFromPage(page: Page): Promise<RawPage> {
  return page.evaluate<RawPage>(inPageScript());
}
