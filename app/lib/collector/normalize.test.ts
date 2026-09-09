import { describe, expect, it } from "vitest";

import type { RawCtaCandidate, RawPage } from "./extract";
import {
  collapse,
  collapseBlock,
  isCta,
  parseDimension,
  toCtas,
  toForms,
  toHeadings,
  toImages,
  toLinks,
  toSnapshot,
} from "./normalize";

function candidate(overrides: Partial<RawCtaCandidate> = {}): RawCtaCandidate {
  return {
    tag: "a",
    text: "Book now",
    href: "https://example.com/book",
    role: null,
    className: "",
    inputType: null,
    visible: true,
    disclosure: false,
    isInCookieBanner: false,
    isInSearchForm: false,
    buttonLike: false,
    ...overrides,
  };
}

describe("normalize.ts", () => {
  describe("collapse", () => {
    it("flattens every run of whitespace and trims", () => {
      expect(collapse("  Book \n\t now  ")).toBe("Book now");
    });

    it("returns an empty string for whitespace-only text", () => {
      expect(collapse(" \n ")).toBe("");
    });
  });

  describe("collapseBlock", () => {
    it("keeps line structure while collapsing spaces within a line", () => {
      expect(collapseBlock("Heading  one\n\nBody   copy")).toBe(
        "Heading one\n\nBody copy",
      );
    });

    it("caps blank runs at one, so paragraphs survive but padding does not", () => {
      expect(collapseBlock("a\n\n\n\n\nb")).toBe("a\n\nb");
    });

    it("strips the indentation innerText carries in from the markup", () => {
      expect(collapseBlock("  a  \n   b  ")).toBe("a\nb");
    });
  });

  describe("parseDimension", () => {
    it("reads a bare number and a px suffix", () => {
      expect(parseDimension("100")).toBe(100);
      expect(parseDimension(" 100px ")).toBe(100);
    });

    it("refuses a percentage rather than reading it as pixels", () => {
      expect(parseDimension("50%")).toBeNull();
    });

    it("is null for absent, empty, and unparseable values", () => {
      expect(parseDimension(null)).toBeNull();
      expect(parseDimension("")).toBeNull();
      expect(parseDimension("auto")).toBeNull();
    });
  });

  describe("toHeadings", () => {
    it("collapses text and drops headings that render to nothing", () => {
      expect(
        toHeadings([
          { level: 1, text: "  Bright  Smile\nDental " },
          { level: 2, text: "   " },
        ]),
      ).toEqual([{ level: 1, text: "Bright Smile Dental" }]);
    });
  });

  describe("isCta", () => {
    it("counts a button, a button-ish input, and a marked-up anchor", () => {
      expect(isCta(candidate({ tag: "button", href: null }))).toBe(true);
      expect(
        isCta(candidate({ tag: "input", inputType: "submit", href: null })),
      ).toBe(true);
      expect(isCta(candidate({ tag: "input", inputType: "button", href: null }))).toBe(
        true,
      );
      expect(isCta(candidate({ role: "button" }))).toBe(true);
      expect(isCta(candidate({ className: "btn btn-primary" }))).toBe(true);
      expect(isCta(candidate({ className: "hero__cta" }))).toBe(true);
    });

    it("does not count a plain anchor, a text input, or an unrelated class", () => {
      expect(isCta(candidate())).toBe(false);
      expect(isCta(candidate({ tag: "input", inputType: "text" }))).toBe(false);
      expect(isCta(candidate({ className: "buttonhole" }))).toBe(false);
    });

    it("counts an anchor painted like a button, whatever its class", () => {
      expect(isCta(candidate({ className: "px-4 py-2 rounded", buttonLike: true }))).toBe(
        true,
      );
    });

    it("does not count chrome: consent, menu toggles, or search", () => {
      expect(isCta(candidate({ tag: "button", disclosure: true }))).toBe(false);
      expect(isCta(candidate({ tag: "button", isInCookieBanner: true }))).toBe(false);
      expect(
        isCta(candidate({ tag: "input", inputType: "submit", isInSearchForm: true })),
      ).toBe(false);
      // The exclusions outrank every positive signal, styling included.
      expect(isCta(candidate({ buttonLike: true, isInCookieBanner: true }))).toBe(false);
    });

    it("does not count anything invisible or empty", () => {
      expect(isCta(candidate({ tag: "button", visible: false }))).toBe(false);
      expect(isCta(candidate({ tag: "button", text: "  \n " }))).toBe(false);
    });
  });

  describe("toCtas", () => {
    it("keeps the tag and href so a button and a link stay distinguishable", () => {
      expect(
        toCtas([
          candidate({ className: "btn", text: " Book  now " }),
          candidate({ tag: "button", text: "Call us", href: null }),
          candidate(),
        ]),
      ).toEqual([
        { text: "Book now", tag: "a", href: "https://example.com/book" },
        { text: "Call us", tag: "button", href: null },
      ]);
    });
  });

  describe("toForms", () => {
    it("defaults a missing method to get and lowercases what is there", () => {
      const [withMethod, without] = toForms([
        { action: "https://example.com/send", method: " POST ", fields: [] },
        { action: null, method: null, fields: [] },
      ]);

      expect(withMethod.method).toBe("post");
      expect(withMethod.action).toBe("https://example.com/send");
      expect(without.method).toBe("get");
      expect(without.action).toBeNull();
    });

    it("empties a missing field name but nulls a missing label", () => {
      const [form] = toForms([
        {
          action: null,
          method: null,
          fields: [
            { name: null, type: "text", required: true, label: "  Your name " },
            { name: "email", type: "email", required: false, label: null },
          ],
        },
      ]);

      expect(form.fields).toEqual([
        { name: "", type: "text", required: true, label: "Your name" },
        { name: "email", type: "email", required: false, label: null },
      ]);
    });
  });

  describe("toImages", () => {
    it("keeps decorative and missing alt text apart", () => {
      const [decorative, missing] = toImages([
        { src: "a.png", alt: "", width: null, height: null, loading: null },
        { src: "b.png", alt: null, width: null, height: null, loading: null },
      ]);

      expect(decorative.alt).toBe("");
      expect(missing.alt).toBeNull();
    });

    it("parses the dimension attributes and normalises loading", () => {
      const [image] = toImages([
        { src: "a.png", alt: null, width: "800", height: "auto", loading: " lazy " },
      ]);

      expect(image).toEqual({
        src: "a.png",
        alt: null,
        width: 800,
        height: null,
        loading: "lazy",
      });
    });
  });

  describe("toLinks", () => {
    it("marks non-web schemes and other origins as external", () => {
      const links = toLinks(
        [
          {
            href: "https://example.com/about",
            text: "About",
            protocol: "https:",
            origin: "https://example.com",
          },
          {
            href: "https://competitor.com/",
            text: "Rival",
            protocol: "https:",
            origin: "https://competitor.com",
          },
          {
            href: "tel:+441130000000",
            text: " Call  us ",
            protocol: "tel:",
            origin: "null",
          },
          {
            href: "mailto:hi@example.com",
            text: "",
            protocol: "mailto:",
            origin: "null",
          },
        ],
        "https://example.com",
      );

      expect(links.map((link) => link.external)).toEqual([
        false,
        true,
        true,
        true,
      ]);
      expect(links[2].text).toBe("Call us");
      // An icon-only tel: link still counts — conversion.no-contact-link reads
      // the scheme, not the text.
      expect(links[3].text).toBe("");
    });
  });

  describe("toSnapshot", () => {
    const raw: RawPage = {
      title: "  Bright Smile Dental  ",
      metaDescription: "",
      lang: "en-GB",
      canonical: "https://example.com/",
      headings: [{ level: 1, text: "Bright Smile Dental" }],
      ctaCandidates: [candidate({ tag: "button", href: null, text: "Book" })],
      forms: [{ action: null, method: null, fields: [] }],
      images: [
        { src: "logo.png", alt: null, width: "40", height: "40", loading: null },
      ],
      links: [
        {
          href: "https://example.com/about",
          text: "About",
          protocol: "https:",
          origin: "https://example.com",
        },
      ],
      text: "Book  your  check-up",
      origin: "https://example.com",
    };

    const meta = {
      url: "https://example.com",
      finalUrl: "https://example.com/",
      status: 200,
      fetchedAt: "2026-08-27T09:00:00.000Z",
      html: "<html></html>",
    };

    it("assembles the contract, meta included", () => {
      const snapshot = toSnapshot(raw, meta);

      expect(snapshot.url).toBe("https://example.com");
      expect(snapshot.finalUrl).toBe("https://example.com/");
      expect(snapshot.status).toBe(200);
      expect(snapshot.fetchedAt).toBe("2026-08-27T09:00:00.000Z");
      expect(snapshot.html).toBe("<html></html>");
      expect(snapshot.title).toBe("Bright Smile Dental");
      expect(snapshot.ctas).toHaveLength(1);
      expect(snapshot.text).toBe("Book your check-up");
    });

    it("nulls the optional strings that came back empty", () => {
      // A `<meta name="description" content="">` is not a description, and a rule
      // asking "is there one" must not be told yes.
      expect(toSnapshot(raw, meta).metaDescription).toBeNull();
    });

    it("keeps every key present, so no consumer has to test for absence", () => {
      expect(Object.keys(toSnapshot(raw, meta)).sort()).toEqual(
        [
          "canonical",
          "ctas",
          "fetchedAt",
          "finalUrl",
          "forms",
          "headings",
          "html",
          "images",
          "lang",
          "links",
          "metaDescription",
          "status",
          "text",
          "title",
          "url",
        ].sort(),
      );
    });
  });
});
