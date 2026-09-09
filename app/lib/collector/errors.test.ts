import { describe, expect, it } from "vitest";

import {
  CollectorError,
  CollectorErrorReason,
  toCollectorError,
} from "./errors";

const getChromiumError = (code: string, url = "https://example.com/") =>
  new Error(`page.goto: net::${code} at ${url}\nCall log:\n  - navigating to "${url}"`);

describe("errors.ts", () => {
  describe("CollectorError", () => {
    it("is an Error that carries its reason and keeps the original as cause", () => {
      const cause = new Error("net::ERR_CONNECTION_RESET");
      const error = new CollectorError(
        CollectorErrorReason.Blocked,
        "Could not collect https://example.com/.",
        cause,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("CollectorError");
      expect(error.reason).toBe(CollectorErrorReason.Blocked);
      expect(error.message).toBe("Could not collect https://example.com/.");
      // The Chromium text is not shown to the user, but losing it would leave
      // nothing to debug a misclassification with.
      expect(error.cause).toBe(cause);
    });

    it("is valid without a cause, for the failures we raise ourselves", () => {
      // `aborted` and `browser` are thrown directly, not translated from anything.
      const error = new CollectorError(
        CollectorErrorReason.Aborted,
        "Collecting https://example.com/ was aborted.",
      );

      expect(error.cause).toBeUndefined();
      expect(error.reason).toBe(CollectorErrorReason.Aborted);
    });
  });

  describe("toCollectorError", () => {
    it("returns an existing CollectorError untouched", () => {
      // Re-wrapping has to be idempotent: `collect` funnels every failure through
      // here, including the ones it raised itself a few frames earlier. Replacing
      // the reason would turn a precise `aborted` into a vague `blocked`.
      const original = new CollectorError(
        CollectorErrorReason.Aborted,
        "Collecting https://example.com/ was aborted.",
      );

      const result = toCollectorError(original, "Could not collect the page.");

      expect(result).toBe(original);
      expect(result.reason).toBe(CollectorErrorReason.Aborted);
      expect(result.message).toBe("Collecting https://example.com/ was aborted.");
    });

    describe("reads the net:: code Chromium puts in the message", () => {
      it.each([
        ["ERR_NAME_NOT_RESOLVED", CollectorErrorReason.Dns],
        ["ERR_NAME_RESOLUTION_FAILED", CollectorErrorReason.Dns],
        ["ERR_TIMED_OUT", CollectorErrorReason.Timeout],
        ["ERR_CONNECTION_TIMED_OUT", CollectorErrorReason.Timeout],
      ])("files %s as %s", (code, reason) => {
        expect(toCollectorError(getChromiumError(code), "msg").reason).toBe(reason);
      });

      it("files a Node resolver failure as dns too", () => {
        // The same condition reported from the other side of the stack: Chromium
        // says ERR_NAME_NOT_RESOLVED, Node says getaddrinfo. Both are "the host
        // does not exist", and the caller should see one answer, not two.
        const error = new Error("getaddrinfo ENOTFOUND example.invalid");
        expect(toCollectorError(error, "msg").reason).toBe(CollectorErrorReason.Dns);
      });

      it("files Playwright's own timeout phrasing as timeout", () => {
        const error = new Error("Timeout 30000ms exceeded.");
        expect(toCollectorError(error, "msg").reason).toBe(
          CollectorErrorReason.Timeout,
        );
      });

      it("matches regardless of case", () => {
        const error = new Error("getAddrInfo ENOTFOUND example.invalid");
        expect(toCollectorError(error, "msg").reason).toBe(CollectorErrorReason.Dns);
      });
    });

    it("falls back to the error's name when the message says nothing", () => {
      // Playwright throws a typed TimeoutError whose message does not always
      // carry the phrase the table looks for.
      const error = new Error("waiting for navigation");
      error.name = "TimeoutError";

      expect(toCollectorError(error, "msg").reason).toBe(
        CollectorErrorReason.Timeout,
      );
    });

    it("prefers the code in the message over the error's name", () => {
      // A TimeoutError that failed because the host does not exist is a dns
      // failure — the specific signal beats the generic one, which is why the
      // table is consulted before the name.
      const error = getChromiumError("ERR_NAME_NOT_RESOLVED");
      error.name = "TimeoutError";

      expect(toCollectorError(error, "msg").reason).toBe(CollectorErrorReason.Dns);
    });

    describe("defaults to blocked", () => {
      it("for a recognised refusal", () => {
        // We reached the network and something said no. Guessing at anything more
        // specific would put a wrong explanation in front of the user.
        expect(
          toCollectorError(getChromiumError("ERR_CONNECTION_REFUSED"), "msg").reason,
        ).toBe(CollectorErrorReason.Blocked);
      });

      it.each([
        ["a string", "something went wrong"],
        ["null", null],
        ["undefined", undefined],
        ["a plain object", { code: 500 }],
      ])("for %s, without throwing on the way", (_label, thrown) => {
        // `collect` wraps whatever a `catch` gave it, and JavaScript permits
        // throwing anything at all.
        const result = toCollectorError(thrown, "Could not collect the page.");

        expect(result).toBeInstanceOf(CollectorError);
        expect(result.reason).toBe(CollectorErrorReason.Blocked);
        expect(result.cause).toBe(thrown);
      });
    });

    it("uses the caller's message and keeps the original underneath", () => {
      // The user reads the message; the cause is what a maintainer reads.
      const cause = getChromiumError("ERR_CONNECTION_REFUSED");
      const result = toCollectorError(cause, "Could not collect https://example.com/.");

      expect(result.message).toBe("Could not collect https://example.com/.");
      expect(result.cause).toBe(cause);
    });

    it("never invents a browser or aborted reason", () => {
      // Those two are raised at their call sites — `browser.ts` when Chromium
      // will not start, `collector.ts` when the caller gives up — because neither
      // can be inferred from a network error string. If this function ever starts
      // producing them, a real cause has been papered over.
      const reasons = [
        getChromiumError("ERR_NAME_NOT_RESOLVED"),
        getChromiumError("ERR_TIMED_OUT"),
        getChromiumError("ERR_CONNECTION_REFUSED"),
        new Error("Target page, context or browser has been closed"),
        "not an error at all",
      ].map((thrown) => toCollectorError(thrown, "msg").reason);

      expect(reasons).not.toContain(CollectorErrorReason.Browser);
      expect(reasons).not.toContain(CollectorErrorReason.Aborted);
    });
  });
});
