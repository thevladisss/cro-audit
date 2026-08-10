import "server-only";

import type { Page } from "playwright-core";

import type { Cta, Form, Heading, Image, Link } from "./types.ts";

/**
 * The DOM-derived half of a `Snapshot`.
 *
 * The other half — `url`, `finalUrl`, `status`, `viewport`, `fetchedAt`,
 * `consoleErrors` — is known in Node, from the request, the navigation
 * response, the context config, the clock, and a `page.on` listener. Nothing
 * appears in both halves, so a new field has exactly one place it can go.
 */
export type Extracted = {
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
  text: string;
};

/**
 * Everything measured in the DOM, in one round trip.
 *
 * The callback is serialized to a string, shipped over CDP, and evaluated in
 * the page. Three consequences, all of them sharp:
 *
 *  1. **It closes over nothing.** No imports, no module constants. Every helper
 *     is declared inside the body. A stray outer reference is a runtime
 *     `ReferenceError`, not a compile error — TypeScript cannot see the seam.
 *  2. **Only JSON comes back.** No nodes, no functions, no `undefined`.
 *  3. **One call, not one per element**, or this becomes thousands of messages.
 *
 * It has to run in-page at all because `aboveFold`, `rect`, `contrastRatio` and
 * rendered-vs-natural image size are layout and cascade facts. No amount of
 * HTML parsing produces them.
 */
export function extract(page: Page): Promise<Extracted> {
  return page.evaluate(() => {
    const fold = window.innerHeight;

    const trim = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();

    const isVisible = (el: Element): boolean => {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const toRect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };

    type Rgb = { r: number; g: number; b: number; a: number };

    const parseColor = (value: string): Rgb | null => {
      const match = /^rgba?\(([^)]+)\)$/.exec(value.trim());
      if (!match?.[1]) return null;

      const parts = match[1]
        .split(/[,\s/]+/)
        .filter((p) => p.length > 0)
        .map(Number);

      const [r, g, b] = parts;
      if (r === undefined || g === undefined || b === undefined) return null;
      if ([r, g, b].some((n) => Number.isNaN(n))) return null;

      const a = parts.length > 3 ? (parts[3] ?? 1) : 1;
      return { r, g, b, a: Number.isNaN(a) ? 1 : a };
    };

    const luminance = ({ r, g, b }: Rgb): number => {
      const channel = (value: number) => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    /** First fully opaque ancestor background. `null` if an image intervenes. */
    const backgroundOf = (el: Element): Rgb | null => {
      let node: Element | null = el;

      while (node) {
        const style = getComputedStyle(node);
        if (style.backgroundImage && style.backgroundImage !== "none") return null;

        const color = parseColor(style.backgroundColor);
        if (color && color.a === 1) return color;

        node = node.parentElement;
      }

      // Nothing opaque all the way up: the canvas shows through, and that is white.
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const contrastOf = (el: Element): number | null => {
      const foreground = parseColor(getComputedStyle(el).color);
      const background = backgroundOf(el);
      if (!foreground || !background) return null;

      const [light, dark] = [luminance(foreground), luminance(background)].sort(
        (a, b) => b - a,
      ) as [number, number];

      return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
    };

    const labelFor = (field: Element): string | null => {
      const id = field.getAttribute("id");
      if (id) {
        const escaped =
          typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
        const explicit = document.querySelector(`label[for="${escaped}"]`);
        if (explicit) return trim(explicit.textContent) || null;
      }

      const wrapping = field.closest("label");
      if (wrapping) return trim(wrapping.textContent) || null;

      const aria = field.getAttribute("aria-label");
      if (aria) return trim(aria) || null;

      const labelledBy = field.getAttribute("aria-labelledby");
      if (labelledBy) {
        const target = document.getElementById(labelledBy);
        if (target) return trim(target.textContent) || null;
      }

      const placeholder = field.getAttribute("placeholder");
      return placeholder ? trim(placeholder) || null : null;
    };

    const formatOf = (src: string): string => {
      if (src.startsWith("data:")) {
        return trim(src.slice(5).split(";")[0]?.split("/")[1] ?? "").toLowerCase();
      }
      try {
        const path = new URL(src, location.href).pathname;
        const dot = path.lastIndexOf(".");
        if (dot === -1) return "";
        return path.slice(dot + 1).toLowerCase();
      } catch {
        return "";
      }
    };

    const headings: Heading[] = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
    ).map((el) => ({
      level: Number(el.tagName[1]),
      text: trim(el.textContent),
      aboveFold: el.getBoundingClientRect().top < fold,
    }));

    const ctas: Cta[] = Array.from(
      document.querySelectorAll(
        'a, button, input[type="submit"], input[type="button"], [role="button"]',
      ),
    )
      .filter(isVisible)
      .map((el) => {
        const rect = toRect(el);
        // `innerText` is empty on an <input>, whose label lives in `value`.
        const text =
          el instanceof HTMLInputElement
            ? trim(el.value)
            : trim((el as HTMLElement).innerText || el.textContent);

        return {
          text,
          tag: el.tagName.toLowerCase(),
          href: el.getAttribute("href"),
          rect,
          aboveFold: rect.y < fold,
          visible: true,
          contrastRatio: contrastOf(el),
        };
      });

    const forms: Form[] = Array.from(document.querySelectorAll("form")).map(
      (form) => ({
        action: form.getAttribute("action"),
        method: (form.getAttribute("method") || "get").toLowerCase(),
        fields: Array.from(
          form.querySelectorAll("input, select, textarea"),
        ).map((field) => ({
          name: field.getAttribute("name") ?? "",
          type:
            field.tagName === "INPUT"
              ? (field.getAttribute("type") || "text").toLowerCase()
              : field.tagName.toLowerCase(),
          required: field.hasAttribute("required"),
          label: labelFor(field),
        })),
      }),
    );

    const images: Image[] = Array.from(document.querySelectorAll("img")).map(
      (img) => {
        const rect = img.getBoundingClientRect();
        return {
          src: img.currentSrc || img.src,
          alt: img.hasAttribute("alt") ? img.getAttribute("alt") : null,
          natural: { w: img.naturalWidth, h: img.naturalHeight },
          rendered: { w: rect.width, h: rect.height },
          format: formatOf(img.currentSrc || img.src),
          loading: img.getAttribute("loading"),
        };
      },
    );

    const links: Link[] = Array.from(
      document.querySelectorAll("a[href]"),
    ).map((el) => {
      const anchor = el as HTMLAnchorElement;
      // `.href` is already absolute; the attribute may be relative.
      const href = anchor.href;
      let external = true;
      try {
        const target = new URL(href, location.href);
        // A mailto: or tel: leaves the site too, and has no matching origin.
        external =
          (target.protocol === "http:" || target.protocol === "https:") &&
          target.origin !== location.origin;
        if (target.protocol !== "http:" && target.protocol !== "https:") {
          external = true;
        }
      } catch {
        external = true;
      }

      return { href, text: trim(anchor.innerText || anchor.textContent), external };
    });

    const meta = document.querySelector('meta[name="description"]');
    const canonical = document.querySelector('link[rel="canonical"]');

    return {
      html: document.documentElement.outerHTML,
      title: document.title ? document.title : null,
      metaDescription: meta ? meta.getAttribute("content") : null,
      lang: document.documentElement.lang || null,
      canonical: canonical ? canonical.getAttribute("href") : null,
      headings,
      ctas,
      forms,
      images,
      links,
      text: document.body ? document.body.innerText : "",
    };
  });
}
