import { describe, expect, it } from "vitest";

import { normalizeUrl } from "./normalizeUrl";

describe("normalizeUrl.ts", () => {
  it("prepends https to a bare hostname", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
  });

  it("keeps an explicit http scheme", () => {
    expect(normalizeUrl("http://example.com/pricing")).toBe(
      "http://example.com/pricing",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  example.com  ")).toBe("https://example.com/");
  });

  it("is null for an empty value", () => {
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("is null for a scheme the collector cannot fetch", () => {
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });

  it("is null for a hostname without a dot", () => {
    expect(normalizeUrl("localhost")).toBeNull();
  });

  // The contract, not an edge case: `new URL` throws on all of these, and the
  // whole point of the helper is that its callers never have to know that.
  it.each(["https://", "http://[", "://example.com", "https://:8080"])(
    "returns null rather than throwing on %j",
    (raw) => {
      expect(() => normalizeUrl(raw)).not.toThrow();
      expect(normalizeUrl(raw)).toBeNull();
    },
  );
});
