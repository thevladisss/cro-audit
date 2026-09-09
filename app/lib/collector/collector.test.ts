import { afterEach, describe, expect, it, vi } from "vitest";

import { CollectorError, CollectorErrorReason } from "./errors";
import type { RawPage } from "./extract";

/**
 * Orchestration, tested without an orchestra.
 *
 * `collect` owns four things a real browser is a poor witness to: that the
 * browser is closed on every path, that the budget and the abort signal can
 * actually interrupt a call Playwright will never settle, that a transport
 * failure arrives as the right `CollectorErrorReason`, and that the snapshot is
 * assembled from the right sources. All four are decisions about promises, so
 * a stubbed `launch` tests them in milliseconds and — the part that matters —
 * *deterministically*. A budget test against a real Chromium is a race with the
 * machine it runs on.
 *
 * What is deliberately not here: whether Chromium renders a page this way. No
 * test in this module covers that — the suite is unit-only by choice, and the
 * stubs below are a model of Playwright, so they agree with it right up until
 * Playwright changes. `normalize` is left real rather than mocked, because it
 * is pure and the seam it forms with `collect` is one line — mocking it would
 * test the mock.
 */
const launchMock = vi.hoisted(() => vi.fn());
const extractMock = vi.hoisted(() => vi.fn());

vi.mock("./browser", () => ({
  launch: launchMock,
  // A sentinel rather than the real string: what is under test here is that the
  // launched build's version reaches the context, not the UA's spelling, which
  // is `browser.test.ts`'s subject.
  desktopUserAgent: (version: string) => `UA/${version}`,
}));

vi.mock("./extract", () => ({ extractFromPage: extractMock }));

// Below the mocks by convention only: vitest hoists `vi.mock` above every
// import, so `collector.ts` binds the stubs whatever order this file is in.
import { collect } from "./collector";

const URL_UNDER_TEST = "https://example.com/";

/**
 * `settleTimeoutMs: 0` in almost every test below. The settle is a fixed wait
 * raced against `networkidle`, so leaving it at its 2.5s default would add 2.5s
 * per test to measure nothing; the race itself gets one test of its own.
 */
const FAST = { settleTimeoutMs: 0 } as const;

const RAW_PAGE: RawPage = {
  title: "  Bright Smile Dental  ",
  metaDescription: "Family dentistry in Leeds.",
  lang: "en-GB",
  canonical: "https://example.com/",
  headings: [{ level: 1, text: "Bright Smile Dental" }],
  ctaCandidates: [],
  forms: [],
  images: [],
  links: [],
  text: "Check-ups from £39.",
  origin: "https://example.com",
};

/**
 * A `Page` with only the four members `render` touches, typed as plain
 * functions so a stub can narrow a return — `goto` resolving `null` is a case
 * the collector has to handle, and a `Mock` type would reject it.
 */
type PageStub = {
  goto: (url: string, options?: unknown) => Promise<{ status: () => number } | null>;
  url: () => string;
  content: () => Promise<string>;
  waitForLoadState: (state: string) => Promise<void>;
};

function makePage(overrides: Partial<PageStub> = {}): PageStub {
  return {
    goto: vi.fn(async () => ({ status: () => 200 })),
    url: vi.fn(() => "https://example.com/landed"),
    content: vi.fn(async () => "<html>rendered</html>"),
    /**
     * Never settles, which is the honest default: `networkidle` does not
     * resolve on a page with an analytics heartbeat, and that is the case the
     * settle race exists for. Every test therefore leaves through the timer.
     */
    waitForLoadState: vi.fn(() => new Promise<void>(() => {})),
    ...overrides,
  };
}

/**
 * Wires a browser → context → page chain into `launch` and hands back all
 * three, so a test can assert on what `collect` did to any of them.
 */
function stubBrowser(
  page: PageStub = makePage(),
  browserOverrides: { close?: () => Promise<void> } = {},
) {
  const context = {
    setDefaultNavigationTimeout: vi.fn(),
    route: vi.fn(async () => {}),
    newPage: vi.fn(async () => page),
  };
  const browser = {
    version: vi.fn(() => "149.0.7827.55"),
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => {}),
    ...browserOverrides,
  };

  launchMock.mockResolvedValue(browser);
  extractMock.mockResolvedValue(RAW_PAGE);

  return { browser, context, page };
}

/** `collect(...).catch(e => e)` — the rejection as a value, for inspection. */
async function failureOf(promise: Promise<unknown>): Promise<CollectorError> {
  return promise.then(
    () => {
      throw new Error("Expected collect to reject, and it resolved.");
    },
    (error: unknown) => error as CollectorError,
  );
}

/** A `Route` whose only interesting property is the resource type it carries. */
function stubRoute(resourceType: string) {
  return {
    request: () => ({ resourceType: () => resourceType }),
    continue: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
}

describe("collector.ts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    launchMock.mockReset();
    extractMock.mockReset();
  });

  describe("collect, before the browser", () => {
    /**
     * The ordering is the point. If this check ever moves below `launch`, a
     * caller who has already gone away starts costing a browser start — and
     * this file starts needing a binary it does not have.
     */
    it("refuses an already-aborted signal without launching anything", async () => {
      stubBrowser();

      const failure = await failureOf(
        collect(URL_UNDER_TEST, { signal: AbortSignal.abort() }),
      );

      expect(failure).toBeInstanceOf(CollectorError);
      expect(failure.reason).toBe(CollectorErrorReason.Aborted);
      expect(launchMock).not.toHaveBeenCalled();
    });
  });

  describe("collect, the context it opens", () => {
    it("takes the user agent from the build that actually launched", async () => {
      // Not a constant: a Chromium 150 claiming 149 is exactly the mismatch a
      // fingerprinter reads, and the version is only knowable after `launch`.
      const { browser } = stubBrowser();

      await collect(URL_UNDER_TEST, FAST);

      expect(browser.version).toHaveBeenCalled();
      expect(browser.newContext).toHaveBeenCalledWith({
        viewport: { width: 1280, height: 800 },
        userAgent: "UA/149.0.7827.55",
        locale: "en-GB",
        // An expired certificate is a page worth auditing, and arguably a
        // finding of its own — never a reason to refuse to look.
        ignoreHTTPSErrors: true,
      });
    });

    it("applies the caller's viewport and navigation timeout over the defaults", async () => {
      const { browser, context } = stubBrowser();

      await collect(URL_UNDER_TEST, {
        ...FAST,
        viewport: { width: 390, height: 844 },
        navigationTimeoutMs: 5_000,
      });

      expect(browser.newContext).toHaveBeenCalledWith(
        expect.objectContaining({ viewport: { width: 390, height: 844 } }),
      );
      expect(context.setDefaultNavigationTimeout).toHaveBeenCalledWith(5_000);
    });

    it("falls back to the default navigation timeout", async () => {
      const { context } = stubBrowser();

      await collect(URL_UNDER_TEST, FAST);

      expect(context.setDefaultNavigationTimeout).toHaveBeenCalledWith(20_000);
    });
  });

  describe("collect, the bytes it declines", () => {
    /**
     * Nothing in a `Snapshot` reads a pixel — image metadata comes from DOM
     * attributes — so on an image-heavy page this routing is the difference
     * between a six-second render and a twenty-second one. Stylesheets and
     * scripts must still load: layout-aware text is the whole reason a browser
     * is involved at all.
     */
    it.each(["image", "media", "font"])("aborts a %s request", async (type) => {
      const { context } = stubBrowser();
      await collect(URL_UNDER_TEST, FAST);

      const [, handler] = context.route.mock.calls[0] as unknown as [
        string,
        (route: ReturnType<typeof stubRoute>) => unknown,
      ];
      const route = stubRoute(type);
      await handler(route);

      expect(route.abort).toHaveBeenCalled();
      expect(route.continue).not.toHaveBeenCalled();
    });

    it.each(["document", "stylesheet", "script", "xhr"])(
      "lets a %s request through",
      async (type) => {
        const { context } = stubBrowser();
        await collect(URL_UNDER_TEST, FAST);

        const [, handler] = context.route.mock.calls[0] as unknown as [
          string,
          (route: ReturnType<typeof stubRoute>) => unknown,
        ];
        const route = stubRoute(type);
        await handler(route);

        expect(route.continue).toHaveBeenCalled();
        expect(route.abort).not.toHaveBeenCalled();
      },
    );
  });

  describe("collect, the snapshot it assembles", () => {
    it("reports the URL asked for and the one it landed on, separately", async () => {
      stubBrowser();

      const snapshot = await collect(URL_UNDER_TEST, FAST);

      expect(snapshot.url).toBe(URL_UNDER_TEST);
      expect(snapshot.finalUrl).toBe("https://example.com/landed");
      expect(snapshot.status).toBe(200);
    });

    it("navigates on domcontentloaded, not load", async () => {
      // One slow third-party script must not decide whether the audit happens.
      const { page } = stubBrowser();

      await collect(URL_UNDER_TEST, FAST);

      expect(page.goto).toHaveBeenCalledWith(URL_UNDER_TEST, {
        waitUntil: "domcontentloaded",
      });
    });

    it("carries the rendered DOM and the extracted page through", async () => {
      const { page } = stubBrowser();

      const snapshot = await collect(URL_UNDER_TEST, FAST);

      expect(extractMock).toHaveBeenCalledWith(page);
      expect(snapshot.html).toBe("<html>rendered</html>");
      // Normalisation is real here, so this also proves `toSnapshot` is fed the
      // extractor's output rather than a re-read of the page.
      expect(snapshot.title).toBe("Bright Smile Dental");
      expect(snapshot.headings).toEqual([
        { level: 1, text: "Bright Smile Dental" },
      ]);
    });

    it("stamps fetchedAt as an ISO instant", async () => {
      stubBrowser();

      const before = Date.now();
      const { fetchedAt } = await collect(URL_UNDER_TEST, FAST);

      expect(fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(Date.parse(fetchedAt)).toBeGreaterThanOrEqual(before - 1);
    });

    /**
     * The settle is a race, and the race is the contract: at most
     * `settleTimeoutMs` of extra waiting however busy the page is. The stubbed
     * `waitForLoadState` never resolves, so a collect that returns at all is
     * one that left through the timer.
     */
    it("stops waiting for network quiet after the settle timeout", async () => {
      const { page } = stubBrowser();

      await expect(
        collect(URL_UNDER_TEST, { settleTimeoutMs: 20 }),
      ).resolves.toBeDefined();
      expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle");
    });
  });

  describe("collect, its teardown", () => {
    it("closes the browser after a successful collect", async () => {
      const { browser } = stubBrowser();

      await collect(URL_UNDER_TEST, FAST);

      expect(browser.close).toHaveBeenCalledTimes(1);
    });

    /**
     * The leak that matters. On a warm serverless instance an unclosed browser
     * survives into the next invocation and takes several hundred MB of the
     * memory budget with it, so every exit from `collect` has to go through
     * `close` — the failing paths most of all, since those are the ones that
     * happen when something is already wrong.
     */
    it("closes the browser when the page fails", async () => {
      const page = makePage({
        goto: vi.fn(async () => {
          throw new Error("net::ERR_CONNECTION_RESET");
        }),
      });
      const { browser } = stubBrowser(page);

      await failureOf(collect(URL_UNDER_TEST, FAST));

      expect(browser.close).toHaveBeenCalledTimes(1);
    });

    it("does not let a failed close bury the snapshot", async () => {
      // A browser that has already died fails to close. That is a teardown
      // detail; the page was collected, and the caller should still get it.
      const { browser } = stubBrowser(makePage(), {
        close: vi.fn(async () => {
          throw new Error("Target page, context or browser has been closed");
        }),
      });

      await expect(collect(URL_UNDER_TEST, FAST)).resolves.toMatchObject({
        status: 200,
      });
      expect(browser.close).toHaveBeenCalled();
    });
  });

  describe("collect, when it fails", () => {
    it("treats a navigation that produced no response as blocked", async () => {
      stubBrowser(makePage({ goto: vi.fn(async () => null) }));

      const failure = await failureOf(collect(URL_UNDER_TEST, FAST));

      expect(failure.reason).toBe(CollectorErrorReason.Blocked);
    });

    /**
     * The reason travels to `app/api/runs/route.ts`, which turns it into a
     * status code — so a misclassification here is the wrong answer to "whose
     * fault is this", handed to the caller. `errors.test.ts` owns the mapping
     * itself; this owns the fact that `collect` runs everything through it.
     */
    it("maps a Chromium net error onto its reason", async () => {
      stubBrowser(
        makePage({
          goto: vi.fn(async () => {
            throw new Error(
              `page.goto: net::ERR_NAME_NOT_RESOLVED at ${URL_UNDER_TEST}`,
            );
          }),
        }),
      );

      const failure = await failureOf(collect(URL_UNDER_TEST, FAST));

      expect(failure).toBeInstanceOf(CollectorError);
      expect(failure.reason).toBe(CollectorErrorReason.Dns);
      expect(failure.message).toBe(`Could not collect ${URL_UNDER_TEST}.`);
    });

    it("lets a failure to launch surface as it was raised", async () => {
      // `launch` already classifies this one, and re-wrapping it as `blocked`
      // would blame the audited site for a machine with no Chromium on it.
      const browserFailure = new CollectorError(
        CollectorErrorReason.Browser,
        "Could not launch Chromium.",
      );
      launchMock.mockRejectedValue(browserFailure);

      const failure = await failureOf(collect(URL_UNDER_TEST, FAST));

      expect(failure).toBe(browserFailure);
    });
  });

  describe("collect, when it is cut short", () => {
    /**
     * Why an independent timer rather than tearing the context down: a
     * Playwright call already in flight never settles once its context closes —
     * not resolved, not rejected. `content` below is that call, and a budget
     * that could not interrupt it would hang the route for good.
     */
    it("rejects when the total budget expires, and still closes the browser", async () => {
      const { browser } = stubBrowser(
        makePage({ content: vi.fn(() => new Promise<string>(() => {})) }),
      );

      const failure = await failureOf(
        collect(URL_UNDER_TEST, { ...FAST, totalBudgetMs: 20 }),
      );

      expect(failure.reason).toBe(CollectorErrorReason.Timeout);
      expect(failure.message).toContain("20ms budget");
      expect(browser.close).toHaveBeenCalledTimes(1);
    });

    /**
     * The window `addEventListener` alone would miss: a signal that fires
     * during `launch` has already fired by the time the listener goes on, and
     * `addEventListener` on an aborted signal never calls back. Without the
     * re-check, this caller would be waited on for the entire budget.
     */
    it("notices a signal that fired while the browser was starting", async () => {
      const controller = new AbortController();
      const { browser } = stubBrowser(
        makePage({ content: vi.fn(() => new Promise<string>(() => {})) }),
      );
      launchMock.mockImplementation(async () => {
        controller.abort();
        return browser;
      });

      const failure = await failureOf(
        collect(URL_UNDER_TEST, { ...FAST, signal: controller.signal }),
      );

      expect(failure.reason).toBe(CollectorErrorReason.Aborted);
      expect(browser.close).toHaveBeenCalledTimes(1);
    });

    it("gives up when the caller aborts mid-render", async () => {
      const controller = new AbortController();
      stubBrowser(
        makePage({
          // Aborting from inside a call that never returns is the real shape of
          // it: a disconnected client, with a render still in flight.
          content: vi.fn(() => {
            controller.abort();
            return new Promise<string>(() => {});
          }),
        }),
      );

      const failure = await failureOf(
        collect(URL_UNDER_TEST, { ...FAST, signal: controller.signal }),
      );

      expect(failure.reason).toBe(CollectorErrorReason.Aborted);
    });

    /**
     * One signal outlives many collects — the route passes the same
     * `request.signal` to every page of a crawl — so a listener left behind is
     * a leak that grows with the crawl.
     */
    it("takes its abort listener back off the signal when it is done", async () => {
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, "removeEventListener");
      stubBrowser();

      await collect(URL_UNDER_TEST, { ...FAST, signal: controller.signal });

      expect(removeListener).toHaveBeenCalledWith(
        "abort",
        expect.any(Function),
      );
    });
  });
});
