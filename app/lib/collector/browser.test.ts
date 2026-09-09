import { afterEach, describe, expect, it, vi } from "vitest";

import { CollectorError, CollectorErrorReason } from "./errors";

/**
 * Launching is tested without launching.
 *
 * Everything this module decides — which binary, which flags, what to do when
 * Chromium will not start — is decided *before* a process exists, so mocking
 * `playwright-core` tests the decisions and not the browser. Whether the binary
 * it picks then launches is not covered anywhere: the suite is unit-only, so a
 * broken install shows up the first time someone runs `collect`, not here.
 *
 * The serverless branch is the reason this matters. It only ever runs on Vercel
 * or Lambda, so without a test it is verified by deploying and finding out.
 */
const launchMock = vi.hoisted(() => vi.fn());

vi.mock("playwright-core", () => ({
  chromium: { launch: launchMock },
}));

/**
 * The real package is a ~50MB Linux binary that a laptop cannot run and should
 * not resolve. The shape below is all `launch` touches.
 */
vi.mock("@sparticuz/chromium", () => ({
  default: {
    args: ["--no-sandbox", "--single-process"],
    executablePath: async () => "/tmp/chromium/chrome",
  },
}));

import { desktopUserAgent, isServerless, launch } from "./browser";

/** Stand-in for a real `Browser`; `launch` only ever passes it through. */
const fakeBrowser = { name: "chromium" } as never;

describe("browser.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    launchMock.mockReset();
  });

  describe("isServerless", () => {
    it("is false on a developer machine", () => {
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);

      expect(isServerless()).toBe(false);
    });

    it('runs on VERCEL', () => {
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
      vi.stubEnv('VERCEL', '1');

      expect(isServerless()).toBe(true);
    })

    it('runs on LAMBDA', () => {
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
      vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'cro-audit-collect');

      expect(isServerless()).toBe(true);

    })
  });

  describe("desktopUserAgent", () => {
    it("keeps only the major version, as Chrome itself reports it", () => {
      // Chrome has frozen the last three components at 0.0.0 since v90; sending
      // the real build number would be the unusual thing, not the safe one.
      //
      // `process.platform` is a read-only accessor, so a spy is the only way to
      // sit a Linux container's answer in front of a macOS test run.
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");

      expect(desktopUserAgent("149.0.7827.55")).toContain("Chrome/149.0.0.0");
    });

    it("never says HeadlessChrome, which is the whole point of it", () => {
      // Playwright's default UA carries that token and a fair number of sites
      // reject it outright. If this assertion ever fails, collects start coming
      // back `blocked` from sites that are perfectly reachable.
      vi.spyOn(process, "platform", "get").mockReturnValue("linux");

      expect(desktopUserAgent("149.0.7827.55")).not.toContain("HeadlessChrome");
    });

    it.each([
      ["darwin", "Macintosh; Intel Mac OS X 10_15_7"],
      ["win32", "Windows NT 10.0; Win64; x64"],
      ["linux", "X11; Linux x86_64"],
    ])("claims the platform it is actually running on: %s", (platform, expected) => {
      // The point of deriving this rather than pasting a constant: a Linux
      // container claiming macOS is a mismatch a fingerprinter can see.
      vi.spyOn(process, "platform", "get").mockReturnValue(platform as NodeJS.Platform);

      expect(desktopUserAgent("149.0.7827.55")).toContain(`(${expected})`);
    });

    it("falls back to the X11 string on anything exotic", () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("freebsd");

      expect(desktopUserAgent("149.0.7827.55")).toContain("(X11; Linux x86_64)");
    });
  });

  describe("launch", () => {
    it("uses Playwright's own install locally, and returns the browser", async () => {
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
      vi.stubEnv("CHROMIUM_PATH", undefined);
      launchMock.mockResolvedValue(fakeBrowser);

      await expect(launch()).resolves.toBe(fakeBrowser);
      expect(launchMock).toHaveBeenCalledWith({
        headless: true,
        // Undefined, not omitted: Playwright reads that as "find your own".
        executablePath: undefined,
      });
    });

    it("honours CHROMIUM_PATH as the local escape hatch", async () => {
      vi.stubEnv("VERCEL", undefined);
      vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
      vi.stubEnv("CHROMIUM_PATH", "/opt/homebrew/bin/chromium");
      launchMock.mockResolvedValue(fakeBrowser);

      await launch();

      expect(launchMock).toHaveBeenCalledWith({
        headless: true,
        executablePath: "/opt/homebrew/bin/chromium",
      });
    });

    it("takes the binary and the flags from @sparticuz/chromium when serverless", async () => {
      // The branch that only ever executes in production. Its flags are not
      // optional decoration — a Lambda without `--single-process` runs out of
      // shared memory partway through a page.
      vi.stubEnv("VERCEL", "1");
      launchMock.mockResolvedValue(fakeBrowser);

      await launch();

      expect(launchMock).toHaveBeenCalledWith({
        args: ["--no-sandbox", "--single-process"],
        executablePath: "/tmp/chromium/chrome",
        headless: true,
      });
    });

    it("reports a failure to start as ours, not the site's", async () => {
      // A missing binary is the commonest first-run failure, and it must not
      // reach the caller as `blocked` — that would blame the audited site for a
      // machine that never opened a socket. The route maps `browser` to a 500.
      vi.stubEnv("VERCEL", undefined);
      const cause = new Error("Executable doesn't exist at /ms-playwright/chromium/chrome");
      launchMock.mockRejectedValue(cause);

      const failure = await launch().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(CollectorError);
      expect((failure as CollectorError).reason).toBe(CollectorErrorReason.Browser);
      expect((failure as CollectorError).cause).toBe(cause);
      // The message has to tell a developer what to run next.
      expect((failure as CollectorError).message).toContain(
        "npx playwright install chromium",
      );
    });

    it("wraps a serverless failure the same way", async () => {
      // The lazy import is inside the same try, so a package that fails to
      // resolve on Lambda is still a `browser` failure rather than a raw throw.
      vi.stubEnv("VERCEL", "1");
      launchMock.mockRejectedValue(new Error("libnss3.so: cannot open shared object file"));

      const failure = await launch().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(CollectorError);
      expect((failure as CollectorError).reason).toBe(CollectorErrorReason.Browser);
    });
  });
});
