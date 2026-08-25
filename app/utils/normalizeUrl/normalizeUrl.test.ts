import { describe, expect, it } from "vitest";

import { normalizeUrl } from "./normalizeUrl";

describe("normalizeUrl", () => {
  it("prepends https to a bare hostname", () => {
    expect(normalizeUrl("example.com")).toEqual({
      url: "https://example.com/",
    });
  });

  it("keeps an explicit http scheme", () => {
    expect(normalizeUrl("http://example.com/pricing")).toEqual({
      url: "http://example.com/pricing",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeUrl("  example.com  ")).toEqual({
      url: "https://example.com/",
    });
  });

  it("rejects an empty value", () => {
    expect(normalizeUrl("   ")).toEqual({ error: "Enter a URL to audit." });
  });

  it("rejects a non-http scheme", () => {
    expect(normalizeUrl("ftp://example.com")).toEqual({
      error: "Only http and https URLs are supported.",
    });
  });

  it("rejects a hostname without a dot", () => {
    expect(normalizeUrl("localhost")).toEqual({
      error: "That doesn't look like a valid URL.",
    });
  });
});
