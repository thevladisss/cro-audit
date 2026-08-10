// @vitest-environment node
//
// The collector's only real coverage. `extract` measures layout and cascade
// facts, and jsdom has neither — `getBoundingClientRect` returns zeros there —
// so a unit test of it would assert nothing true about production.
//
// Gated behind RUN_BROWSER_TESTS=1 (AUDIT-DESIGN §8) because it launches
// Chromium. It serves its own fixture on 127.0.0.1 instead of hitting a live
// site, so it is deterministic and works offline; `allowPrivateHosts` exists
// for exactly this, since the SSRF guard would otherwise correctly refuse.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCollector } from "./collector.ts";
import type { Collector, Snapshot } from "./types.ts";

const describeBrowser = process.env.RUN_BROWSER_TESTS ? describe : describe.skip;

const FIXTURE = `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <!-- Without this, Chromium lays a mobile context out at the legacy 980px
         viewport rather than the device width. That fallback is real device
         behaviour and is exactly what the "missing viewport meta" rule will
         detect — but it would make the reflow assertion below meaningless. -->
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Riverside Dental</title>
    <meta name="description" content="Family dentistry in Austin." />
    <link rel="canonical" href="https://riverside.example/" />
    <style>
      body { margin: 0; font: 16px/1.5 system-ui; background: #ffffff; color: #222; }
      .hero { height: 400px; padding: 24px; }
      .cta { display: inline-block; background: #0a5c36; color: #ffffff;
             padding: 12px 20px; border: 0; }
      /* Full width, so its rect reflows with the viewport. */
      .wide { display: block; background: #0a5c36; color: #ffffff; padding: 12px; }
      .faint { color: #cccccc; background: #ffffff; }
      .below { margin-top: 1200px; }
      img.scaled { width: 100px; height: 50px; }
    </style>
  </head>
  <body>
    <div class="hero">
      <h1>Gentle dentistry on the river</h1>
      <h2>Book in under a minute</h2>
      <a class="cta" href="/book">Book an appointment</a>
      <a class="wide" href="/call">Call us today</a>
      <a class="faint" href="/pricing">See pricing</a>
      <a href="https://example.org/partner">Our partner</a>
      <a href="mailto:hi@riverside.example">Email us</a>
      <img class="scaled" src="/logo.png" alt="Riverside logo" loading="lazy" />
      <img src="/hero.jpg" />
    </div>

    <div class="below">
      <h3>Below the fold</h3>
      <form action="/enquire" method="POST">
        <label for="name">Your name</label>
        <input id="name" name="name" type="text" required />
        <label>Email <input name="email" type="email" /></label>
        <input name="phone" type="tel" aria-label="Phone number" />
        <textarea name="notes" placeholder="Anything else?"></textarea>
        <button type="submit">Send</button>
      </form>
    </div>

    <script>console.error("fixture console error");</script>
  </body>
</html>`;

// A 1×1 PNG, so `naturalWidth` is real and differs from the rendered size.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describeBrowser("PlaywrightCollector", () => {
  let server: Server;
  let origin: string;
  let collector: Collector;
  let desktop: Snapshot;
  let mobile: Snapshot;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url?.endsWith(".png") || request.url?.endsWith(".jpg")) {
        response.writeHead(200, { "content-type": "image/png" });
        response.end(PNG);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(FIXTURE);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    collector = await createCollector();
    desktop = await collector.collect(origin, "desktop", { allowPrivateHosts: true });
    mobile = await collector.collect(origin, "mobile", { allowPrivateHosts: true });
  }, 120_000);

  afterAll(async () => {
    await collector?.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("records the request, the response, and the viewport", () => {
    expect(desktop.url).toBe(origin);
    expect(desktop.finalUrl).toBe(`${origin}/`);
    expect(desktop.status).toBe(200);
    expect(desktop.viewport).toBe("desktop");
    expect(Date.parse(desktop.fetchedAt)).not.toBeNaN();
  });

  it("reads the head", () => {
    expect(desktop.title).toBe("Riverside Dental");
    expect(desktop.metaDescription).toBe("Family dentistry in Austin.");
    expect(desktop.lang).toBe("en-GB");
    expect(desktop.canonical).toBe("https://riverside.example/");
  });

  it("returns rendered text, not markup", () => {
    expect(desktop.text).toContain("Gentle dentistry on the river");
    expect(desktop.text).not.toContain("<h1>");
  });

  it("measures headings against the fold", () => {
    const h1 = desktop.headings.find((h) => h.level === 1);
    const below = desktop.headings.find((h) => h.text === "Below the fold");

    expect(h1?.aboveFold).toBe(true);
    expect(below?.aboveFold).toBe(false);
  });

  it("gives every CTA a real rect — the thing HTML parsing cannot produce", () => {
    const book = desktop.ctas.find((c) => c.text === "Book an appointment");

    expect(book).toBeDefined();
    expect(book?.rect.w).toBeGreaterThan(0);
    expect(book?.rect.h).toBeGreaterThan(0);
    expect(book?.aboveFold).toBe(true);
    expect(book?.tag).toBe("a");
    expect(book?.href).toBe("/book");
  });

  it("computes contrast from the cascade, and ranks a faint CTA below a strong one", () => {
    const strong = desktop.ctas.find((c) => c.text === "Book an appointment");
    const faint = desktop.ctas.find((c) => c.text === "See pricing");

    // White on #0a5c36 is comfortably past 4.5:1; #ccc on white fails 3:1.
    expect(strong?.contrastRatio).toBeGreaterThan(4.5);
    expect(faint?.contrastRatio).toBeLessThan(3);
  });

  it("separates internal links from external ones", () => {
    const pricing = desktop.links.find((l) => l.href.endsWith("/pricing"));
    const partner = desktop.links.find((l) => l.href.includes("example.org"));
    const email = desktop.links.find((l) => l.href.startsWith("mailto:"));

    expect(pricing?.external).toBe(false);
    expect(partner?.external).toBe(true);
    expect(email?.external).toBe(true);
  });

  it("resolves form field labels through four different mechanisms", () => {
    const form = desktop.forms[0];

    expect(form?.action).toBe("/enquire");
    expect(form?.method).toBe("post");

    const byName = Object.fromEntries(
      (form?.fields ?? []).map((f) => [f.name, f]),
    );

    expect(byName.name?.label).toBe("Your name"); // <label for>
    expect(byName.email?.label).toBe("Email"); // wrapping label
    expect(byName.phone?.label).toBe("Phone number"); // aria-label
    expect(byName.notes?.label).toBe("Anything else?"); // placeholder
    expect(byName.name?.required).toBe(true);
    expect(byName.email?.required).toBe(false);
    expect(byName.notes?.type).toBe("textarea");
  });

  it("distinguishes a missing alt from an empty one", () => {
    const logo = desktop.images.find((i) => i.src.endsWith("logo.png"));
    const hero = desktop.images.find((i) => i.src.endsWith("hero.jpg"));

    expect(logo?.alt).toBe("Riverside logo");
    expect(logo?.loading).toBe("lazy");
    expect(hero?.alt).toBeNull();
  });

  it("records natural and rendered image sizes separately", () => {
    const logo = desktop.images.find((i) => i.src.endsWith("logo.png"));

    // The fixture is a 1×1 PNG stretched by CSS to 100×50 — the gap between
    // these two numbers is the entire "unoptimized image" signal.
    expect(logo?.natural).toEqual({ w: 1, h: 1 });
    expect(logo?.rendered).toEqual({ w: 100, h: 50 });
    expect(logo?.format).toBe("png");
  });

  it("captures console errors", () => {
    expect(desktop.consoleErrors.some((e) => e.text.includes("fixture console error"))).toBe(
      true,
    );
  });

  it("produces a different layout at the mobile viewport", () => {
    // Same page, narrower window. A full-width CTA is the honest probe here:
    // the inline-block one sits at the same coordinates in both viewports, so
    // asserting on it would pass whether or not the mobile pass did anything.
    const onDesktop = desktop.ctas.find((c) => c.text === "Call us today");
    const onMobile = mobile.ctas.find((c) => c.text === "Call us today");

    expect(mobile.viewport).toBe("mobile");
    expect(onDesktop?.rect.w).toBeGreaterThan(1000); // 1440 viewport
    expect(onMobile?.rect.w).toBeLessThan(400); // 393 viewport
  });

  it("refuses a private host when the guard is not bypassed", async () => {
    await expect(collector.collect(origin, "desktop")).rejects.toThrow();
  });

  it("refuses a non-http scheme", async () => {
    await expect(
      collector.collect("file:///etc/passwd", "desktop"),
    ).rejects.toThrow();
  });

  it("stops when the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      collector.collect(origin, "desktop", {
        allowPrivateHosts: true,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/i);
  });
});

/**
 * The WordPress case: a WAF answers the first request with a holding page that
 * runs a check and then reloads into the real site. `detectChallenge` is unit
 * tested on strings; this is the part that can only be proved with a browser —
 * that the collector actually sits through the reload and extracts the site
 * behind it, and that it refuses to score the holding page when it never lifts.
 */
const INTERSTITIAL = `<!doctype html>
<html><head><title>Just a moment...</title></head>
<body>
  <h1>Checking your browser before accessing the site.</h1>
  <p>This process is automatic. Your browser will redirect shortly.</p>
  <script>setTimeout(() => location.reload(), 900);</script>
</body></html>`;

const REAL_PAGE = `<!doctype html>
<html lang="en"><head><title>Riverside Dental</title></head>
<body><h1>Gentle dentistry on the river</h1>
<p>We have looked after Austin families for twenty years.</p></body></html>`;

describeBrowser("PlaywrightCollector · browser-check interstitials", () => {
  let collector: Collector;
  const servers: Server[] = [];

  const serve = async (handler: () => string): Promise<string> => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(handler());
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  beforeAll(async () => {
    collector = await createCollector();
  }, 120_000);

  afterAll(async () => {
    await collector?.dispose();
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  });

  it("waits through an interstitial and audits the page behind it", async () => {
    let hits = 0;
    const origin = await serve(() => (++hits === 1 ? INTERSTITIAL : REAL_PAGE));

    const snapshot = await collector.collect(origin, "desktop", {
      allowPrivateHosts: true,
    });

    expect(hits).toBeGreaterThan(1);
    expect(snapshot.title).toBe("Riverside Dental");
    expect(snapshot.text).toContain("Gentle dentistry on the river");
    expect(snapshot.text).not.toContain("Checking your browser");
  }, 60_000);

  it("refuses to score an interstitial that never lifts", async () => {
    const origin = await serve(() => INTERSTITIAL);

    // A Snapshot of a holding page has no H1, no CTAs and no copy — the rules
    // would score it near zero and report it as the customer's homepage.
    await expect(
      collector.collect(origin, "desktop", {
        allowPrivateHosts: true,
        challengeTimeoutMs: 3_000,
      }),
    ).rejects.toThrow(/browser check/i);
  }, 60_000);

  it("costs an uncontested page nothing", async () => {
    const origin = await serve(() => REAL_PAGE);

    const started = Date.now();
    await collector.collect(origin, "desktop", { allowPrivateHosts: true });

    // Polling, not a fixed sleep: a page with no interstitial never enters the
    // wait loop, so the 15s budget is not spent on the 95% case.
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 60_000);
});
