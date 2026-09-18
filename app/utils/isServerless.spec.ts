import { afterEach, describe, expect, it, vi } from "vitest";

import { isServerless } from "./isServerless";

/**
 * Both variables are cleared before each case: the suite itself runs on CI,
 * which may well be a machine that sets one of them.
 */
describe("isServerless.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function withNoPlatformEnv() {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", undefined);
  }

  it("is false on a developer machine", () => {
    withNoPlatformEnv();

    expect(isServerless()).toBe(false);
  });

  it("is true on Vercel", () => {
    withNoPlatformEnv();
    vi.stubEnv("VERCEL", "1");

    expect(isServerless()).toBe(true);
  });

  it("is true on Lambda", () => {
    withNoPlatformEnv();
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "cro-audit-collect");

    expect(isServerless()).toBe(true);
  });
});
