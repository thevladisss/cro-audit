import { describe, expect, it } from "vitest";

import { canonicalUrl } from "./canonicalUrl";

describe("canonicalUrl.ts", () => {
  it("gives one spelling to the same site typed two ways", () => {
    expect(canonicalUrl("example.com")).toBe(
      canonicalUrl("https://example.com/"),
    );
  });

  it("falls back to the trimmed input when the URL is not one", () => {
    expect(canonicalUrl("  localhost  ")).toBe("localhost");
  });
});
