import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  collectCtaCandidates,
  collectForms,
  collectHeadings,
  collectImages,
  collectLinks,
  collectMeta,
  extractPage,
  IN_PAGE_FUNCTIONS,
  inPageScript,
  isInCookieBanner,
  isInSearchForm,
  isVisible,
  getLabelFor,
  looksLikeButton,
} from "./extract";
import type { RenderedBox } from "./extract";

/**
 * The in-page half, tested without a page.
 *
 * Every helper here takes its `Document` as a parameter rather than reading the
 * global — the reason `extract.ts` is written that way — so jsdom can stand in
 * for the browser. What jsdom cannot stand in for is *layout*, and the shims
 * below are the honest boundary of this file:
 *
 *  - `innerText` is not implemented by jsdom at all, so it is shimmed to
 *    `textContent`. That makes the DOM structural, not rendered: text inside a
 *    `display:none` block is no longer excluded here, which is precisely the
 *    property `getRenderedText()` exists for.
 *  - `getClientRects()` always returns empty in jsdom, so it is shimmed to
 *    "everything is laid out unless it says otherwise" via `data-hidden`.
 *  - `getBoundingClientRect()` is all zeros whatever we do, so `isButtonLike` is
 *    always false in this file. The painted-box judgement is tested directly
 *    through `looksLikeButton`, which is pure and needs no DOM.
 *
 * So: what element is collected, with which attributes, in what order — here.
 * Whether the browser considers it visible or button-shaped is not covered by
 * any test in this module, and cannot be while the suite is unit-only. Do not
 * paper over that by asserting it here: under these shims such a test passes
 * for the wrong reason, which is worse than the gap it hides.
 */
function makeDocument(body: string, head = ""): Document {
  const dom = new JSDOM(
    `<!doctype html><html lang="en-GB"><head>${head}</head><body>${body}</body></html>`,
    // A real base URL, so href/src absolutisation is genuinely exercised. It is
    // the bug this code is most likely to have.
    { url: "https://example.com/" },
  );

  const { window } = dom;

  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    get(this: HTMLElement) {
      return this.textContent;
    },
    configurable: true,
  });

  window.Element.prototype.getClientRects = function (this: Element) {
    return (
      this.hasAttribute("data-hidden") ? [] : [{}]
    ) as unknown as DOMRectList;
  };

  // `isButtonLike` reads the *global* `getComputedStyle`, so without this every
  // visible anchor in `collectCtaCandidates` throws.
  globalThis.getComputedStyle = window.getComputedStyle.bind(
    window,
  ) as typeof globalThis.getComputedStyle;

  return window.document as unknown as Document;
}

function box(overrides: Partial<RenderedBox> = {}): RenderedBox {
  return {
    display: "inline-block",
    backgroundColor: "rgb(0, 112, 243)",
    borderTopWidth: "0px",
    borderTopStyle: "none",
    width: 120,
    height: 44,
    ...overrides,
  };
}

describe("extract.ts", () => {
  describe("looksLikeButton", () => {
    it("accepts a filled box of about the right size", () => {
      expect(looksLikeButton(box(), 1280)).toBe(true);
    });

    it("accepts an outlined box with no background", () => {
      expect(
        looksLikeButton(
          box({
            backgroundColor: "rgba(0, 0, 0, 0)",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
          }),
          1280,
        ),
      ).toBe(true);
    });

    it("rejects a box that is neither painted nor outlined", () => {
      expect(
        looksLikeButton(box({ backgroundColor: "transparent" }), 1280),
      ).toBe(false);
      expect(
        looksLikeButton(box({ backgroundColor: "rgba(0, 0, 0, 0)" }), 1280),
      ).toBe(false);
    });

    it("rejects an inline box however it is painted", () => {
      // An inline element is a styled span of text, not a control.
      expect(looksLikeButton(box({ display: "inline" }), 1280)).toBe(false);
    });

    it("holds the height window at 28 and 80", () => {
      expect(looksLikeButton(box({ height: 27 }), 1280)).toBe(false);
      expect(looksLikeButton(box({ height: 28 }), 1280)).toBe(true);
      expect(looksLikeButton(box({ height: 80 }), 1280)).toBe(true);
      expect(looksLikeButton(box({ height: 81 }), 1280)).toBe(false);
    });

    it("rejects anything narrower than a button", () => {
      expect(looksLikeButton(box({ width: 47 }), 1280)).toBe(false);
      expect(looksLikeButton(box({ width: 48 }), 1280)).toBe(true);
    });

    it("rejects a painted card, which is the same markup at the wrong width", () => {
      // Half the viewport is the cut-off; a hero panel or a nav bar is wider.
      expect(looksLikeButton(box({ width: 640 }), 1280)).toBe(true);
      expect(looksLikeButton(box({ width: 641 }), 1280)).toBe(false);
    });

    it("uses the 320px floor rather than half of a narrow viewport", () => {
      // Without the floor, a 375px phone would cap buttons at 187px and reject
      // most full-width mobile CTAs.
      expect(looksLikeButton(box({ width: 320 }), 375)).toBe(true);
      expect(looksLikeButton(box({ width: 321 }), 375)).toBe(false);
    });
  });

  describe("isVisible", () => {
    it("reads layout, not styling", () => {
      const doc = makeDocument(`<a href="/a">A</a><a href="/b" data-hidden>B</a>`);
      const [shown, hidden] = [...doc.querySelectorAll("a")];

      expect(isVisible(shown)).toBe(true);
      expect(isVisible(hidden)).toBe(false);
    });
  });

  describe("isInCookieBanner", () => {
    it("matches on a container id or class", () => {
      const doc = makeDocument(`
      <div id="cookie-banner"><button id="a">Accept</button></div>
      <div class="gdpr-notice"><button id="b">Accept</button></div>
      <div class="cmp_wrapper"><button id="c">Accept</button></div>
    `);

      for (const id of ["a", "b", "c"]) {
        expect(isInCookieBanner(doc.getElementById(id)!)).toBe(true);
      }
    });

    it("does not match an ordinary container", () => {
      const doc = makeDocument(`<div class="hero"><button id="a">Book</button></div>`);
      expect(isInCookieBanner(doc.getElementById("a")!)).toBe(false);
    });

    it("walks up eight levels and no further", () => {
      const nest = (depth: number) =>
        "<div>".repeat(depth) + `<button id="a">Accept</button>` + "</div>".repeat(depth);

      // The walk checks eight nodes: the button itself plus seven ancestors. So
      // six wrappers leaves the banner as the seventh ancestor and in range; a
      // seventh wrapper pushes it out.
      const inRange = makeDocument(`<div id="cookie-banner">${nest(6)}</div>`);
      expect(isInCookieBanner(inRange.getElementById("a")!)).toBe(true);

      const outOfRange = makeDocument(`<div id="cookie-banner">${nest(7)}</div>`);
      expect(isInCookieBanner(outOfRange.getElementById("a")!)).toBe(false);
    });
  });

  describe("isInSearchForm", () => {
    it("matches an ARIA search landmark", () => {
      const doc = makeDocument(
        `<div role="search"><input type="submit" id="a" value="Go"></div>`,
      );
      expect(isInSearchForm(doc.getElementById("a")!)).toBe(true);
    });

    it("matches a form that contains a search input", () => {
      const doc = makeDocument(
        `<form><input type="search" name="q"><input type="submit" id="a" value="Go"></form>`,
      );
      expect(isInSearchForm(doc.getElementById("a")!)).toBe(true);
    });

    it("does not match an ordinary form", () => {
      const doc = makeDocument(
        `<form><input type="email" name="e"><input type="submit" id="a" value="Send"></form>`,
      );
      expect(isInSearchForm(doc.getElementById("a")!)).toBe(false);
    });
  });

  describe("getLabelFor", () => {
    it("reads a <label for>, an ancestor <label>, aria-label and placeholder", () => {
      const doc = makeDocument(`
      <label for="a">Your name</label><input id="a">
      <label>Your email<input id="b"></label>
      <input id="c" aria-label="Phone number">
      <span id="ref">Postcode</span><input id="d" aria-labelledby="ref">
      <input id="e" placeholder="Message">
    `);

      expect(getLabelFor(doc.getElementById("a")!, doc)).toBe("Your name");
      expect(getLabelFor(doc.getElementById("b")!, doc)).toBe("Your email");
      expect(getLabelFor(doc.getElementById("c")!, doc)).toBe("Phone number");
      expect(getLabelFor(doc.getElementById("d")!, doc)).toBe("Postcode");
      expect(getLabelFor(doc.getElementById("e")!, doc)).toBe("Message");
    });

    it("is null for a field with nothing to name it", () => {
      const doc = makeDocument(`<input id="a">`);
      expect(getLabelFor(doc.getElementById("a")!, doc)).toBeNull();
    });

    it("prefers a real label over the placeholder standing in for one", () => {
      // The order is the browser's own: an element with both is labelled by the
      // label, and reporting the placeholder would hide a real accessibility win.
      const doc = makeDocument(
        `<label for="a">Your name</label><input id="a" aria-label="Name" placeholder="Jane Smith">`,
      );
      expect(getLabelFor(doc.getElementById("a")!, doc)).toBe("Your name");
    });
  });

  describe("collectHeadings", () => {
    it("reads the level from the tag name and keeps document order", () => {
      const doc = makeDocument(`<h2>Treatments</h2><h1>Dental</h1><h3>Fees</h3>`);

      expect(collectHeadings(doc)).toEqual([
        { level: 2, text: "Treatments" },
        { level: 1, text: "Dental" },
        { level: 3, text: "Fees" },
      ]);
    });

    it("returns text raw, leaving the collapsing to normalize", () => {
      const doc = makeDocument(`<h1> Bright  Smile </h1>`);
      expect(collectHeadings(doc)[0].text).toBe(" Bright  Smile ");
    });
  });

  describe("collectMeta", () => {
    it("reads the head, absolutising the canonical", () => {
      const doc = makeDocument(
        "",
        `<title>Bright Smile</title>
       <meta name="description" content="Family dentistry.">
       <link rel="canonical" href="/home">`,
      );

      expect(collectMeta(doc)).toEqual({
        title: "Bright Smile",
        metaDescription: "Family dentistry.",
        lang: "en-GB",
        canonical: "https://example.com/home",
      });
    });

    it("nulls what the page omits", () => {
      const doc = makeDocument("", "<title></title>");
      const meta = collectMeta(doc);

      expect(meta.metaDescription).toBeNull();
      expect(meta.canonical).toBeNull();
    });
  });

  describe("collectLinks", () => {
    it("absolutises relative hrefs and reports scheme and origin", () => {
      const doc = makeDocument(`
      <a href="/about">About</a>
      <a href="https://competitor.example/">Rival</a>
      <a href="tel:+441130000000">Call</a>
      <a href="mailto:hi@example.com">Email</a>
    `);

      expect(collectLinks(doc)).toEqual([
        {
          href: "https://example.com/about",
          text: "About",
          protocol: "https:",
          origin: "https://example.com",
        },
        {
          href: "https://competitor.example/",
          text: "Rival",
          protocol: "https:",
          origin: "https://competitor.example",
        },
        {
          href: "tel:+441130000000",
          text: "Call",
          protocol: "tel:",
          origin: "null",
        },
        {
          href: "mailto:hi@example.com",
          text: "Email",
          protocol: "mailto:",
          origin: "null",
        },
      ]);
    });

    it("ignores an anchor with no href, which is not a link", () => {
      const doc = makeDocument(`<a name="top">Top</a><a href="/a">A</a>`);
      expect(collectLinks(doc)).toHaveLength(1);
    });
  });

  describe("collectImages", () => {
    it("keeps a decorative alt apart from a missing one", () => {
      const doc = makeDocument(`<img src="/a.png" alt=""><img src="/b.png">`);
      const [decorative, missing] = collectImages(doc);

      expect(decorative.alt).toBe("");
      expect(missing.alt).toBeNull();
    });

    it("absolutises src and returns the dimensions unparsed", () => {
      const doc = makeDocument(
        `<img src="/logo.png" alt="Logo" width="240" height="auto" loading="lazy">`,
      );

      expect(collectImages(doc)).toEqual([
        {
          src: "https://example.com/logo.png",
          alt: "Logo",
          // Strings here; `parseDimension` is normalize's job and rejects "auto".
          width: "240",
          height: "auto",
          loading: "lazy",
        },
      ]);
    });

    it("yields an empty src for a srcset image, as a real collect does", () => {
      // Characterisation, not endorsement. `currentSrc` is the *selected* source,
      // and selection is a side effect of loading — which the collector aborts for
      // images. So this lands as "", which the Snapshot contract reads as "no src
      // attribute". See the TODO in `collectImages`. If a fix ever parses srcset
      // directly, this expectation should change deliberately.
      const doc = makeDocument(`<img srcset="/a-1x.png 1x, /a-2x.png 2x" alt="A">`);
      expect(collectImages(doc)[0].src).toBe("");
    });
  });

  describe("collectForms", () => {
    it("reads the fields a visitor fills, and none of the plumbing", () => {
      const doc = makeDocument(`
      <form action="/enquiry" method="POST">
        <label for="n">Your name</label>
        <input id="n" name="name" required>
        <input type="email" name="email" placeholder="Email address">
        <select name="branch"><option>Leeds</option></select>
        <textarea name="message"></textarea>
        <input type="hidden" name="csrf" value="xyz">
        <input type="submit" value="Send">
        <input type="reset" value="Clear">
        <input type="button" value="Help">
        <input type="image" src="/go.png">
      </form>
    `);

      const [form] = collectForms(doc);

      expect(form.action).toBe("https://example.com/enquiry");
      // Verbatim — the "get" default is applied in normalize, not here.
      expect(form.method).toBe("POST");
      expect(form.fields).toEqual([
        { name: "name", type: "text", required: true, label: "Your name" },
        {
          name: "email",
          type: "email",
          required: false,
          label: "Email address",
        },
        { name: "branch", type: "select", required: false, label: null },
        { name: "message", type: "textarea", required: false, label: null },
      ]);
    });

    it("nulls a missing action rather than absolutising the page URL", () => {
      // `form.action` reflects the document URL when the attribute is absent,
      // which would report every form as posting to itself.
      const doc = makeDocument(`<form><input name="a"></form>`);
      const [form] = collectForms(doc);

      expect(form.action).toBeNull();
      expect(form.method).toBeNull();
    });

    it("counts aria-required as required", () => {
      const doc = makeDocument(
        `<form><input name="a" aria-required="true"><input name="b" aria-required="false"></form>`,
      );

      expect(collectForms(doc)[0].fields.map((field) => field.required)).toEqual([
        true,
        false,
      ]);
    });
  });

  describe("collectCtaCandidates", () => {
    it("gathers every anchor, button and input as a candidate, judging none", () => {
      // The filtering is `normalize.isCta`'s job; this only gathers the facts it
      // needs, so a cookie-banner button must still appear here.
      const doc = makeDocument(`
      <div id="cookie-banner"><button>Accept</button></div>
      <button aria-expanded="false">Menu</button>
      <a href="/book" class="hero__btn">Book</a>
      <input type="submit" value="Send">
    `);

      const candidates = collectCtaCandidates(doc, 1280);

      expect(candidates).toHaveLength(4);
      expect(candidates.map((candidate) => candidate.tag)).toEqual([
        "button",
        "button",
        "a",
        "input",
      ]);
    });

    it("records the signals normalize filters on", () => {
      const doc = makeDocument(`
      <div id="cookie-consent"><button>Accept</button></div>
      <button aria-haspopup="true">Menu</button>
      <form role="search"><input type="submit" value="Go"></form>
      <a href="/book" role="button" class="hero__btn">Book</a>
    `);

      const [consent, menu, search, anchor] = collectCtaCandidates(doc, 1280);

      expect(consent.isInCookieBanner).toBe(true);
      expect(menu.disclosure).toBe(true);
      expect(search.isInSearchForm).toBe(true);
      expect(anchor.role).toBe("button");
      expect(anchor.className).toBe("hero__btn");
      expect(anchor.href).toBe("https://example.com/book");
    });

    it("takes an input's text from value, and gives it no href", () => {
      const doc = makeDocument(`<input type="submit" value="Send enquiry">`);
      const [candidate] = collectCtaCandidates(doc, 1280);

      expect(candidate.text).toBe("Send enquiry");
      expect(candidate.inputType).toBe("submit");
      expect(candidate.href).toBeNull();
    });

    it("defaults a bare input to type text and nulls a hrefless anchor", () => {
      const doc = makeDocument(`<input name="a"><a>No target</a>`);
      const [input, anchor] = collectCtaCandidates(doc, 1280);

      expect(input.inputType).toBe("text");
      expect(anchor.href).toBeNull();
      expect(anchor.inputType).toBeNull();
    });
  });

  describe("extractPage", () => {
    it("assembles every section and the origin the links are judged against", () => {
      const doc = makeDocument(
        `<h1>Bright Smile Dental</h1>
       <p>Check-ups from £39.</p>
       <a href="/book" class="btn">Book online</a>
       <form action="/enquiry"><input name="name"></form>
       <img src="/logo.png" alt="Logo">`,
        `<title>Bright Smile</title>`,
      );

      const raw = extractPage(doc, 1280);

      expect(raw.title).toBe("Bright Smile");
      expect(raw.lang).toBe("en-GB");
      expect(raw.headings).toEqual([{ level: 1, text: "Bright Smile Dental" }]);
      expect(raw.forms).toHaveLength(1);
      expect(raw.images).toHaveLength(1);
      expect(raw.links).toHaveLength(1);
      // The form's text input is a candidate too — everything is gathered here
      // and `normalize.isCta` is what rejects it.
      expect(raw.ctaCandidates.map((candidate) => candidate.tag)).toEqual([
        "a",
        "input",
      ]);
      expect(raw.text).toContain("Check-ups from £39.");
      // What `toLinks` compares each link's origin against.
      expect(raw.origin).toBe("https://example.com");
    });
  });

  describe("inPageScript", () => {
    const script = inPageScript();

    it("wraps the declarations in a scope that calls the entry point", () => {
      // The page has no module scope, so the script has to be one expression
      // that declares everything it needs and then invokes it. `extractPage` is
      // named through `.name` in the builder because a production build may
      // mangle it, so the assertion reads the name the same way.
      expect(script.startsWith("(() => {")).toBe(true);
      expect(script.endsWith("})()")).toBe(true);
      expect(script).toContain(`return ${extractPage.name}();`);
    });

    it("declares every registered function as a hoistable declaration", () => {
      // Derived from the array rather than a list written out here, so the two
      // cannot drift apart. What it pins is the rule a new helper has to obey:
      // `function f() {}`, never `const f = () => {}` — an arrow's `toString()`
      // is an expression with no name for the other declarations to call.
      for (const fn of IN_PAGE_FUNCTIONS) {
        expect(script).toContain(`function ${fn.name}(`);
      }
    });

    it("carries no module-scope references into the page", () => {
      // The failure this exists for: a helper moved to another file compiles to
      // a namespace lookup (`__vite_ssr_import_0__.getRenderedText(...)` under
      // Vitest, `helpers_1.getRenderedText(...)` under tsc/CJS), which `toString()`
      // reproduces verbatim and the page cannot resolve. Cheap to spot in the
      // text; a `ReferenceError` on a real site otherwise.
      expect(script).not.toMatch(/__vite_ssr_import_|__turbopack|__webpack_/);
      expect(script).not.toMatch(/\brequire\(/);
      expect(script).not.toMatch(/\b\w+_\d+\.\w+\(/);
    });
  });
});
