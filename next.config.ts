import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `playwright-core` reads its browser registry with a computed require —
   * `require(path.join(linkTarget, "browsers.json"))` in `lib/coreBundle.js` —
   * which file tracing cannot follow, so the file is left out of the deployed
   * function and `launch()` fails on the first call. Everything else the
   * package needs is traced normally; this is the one asset it misses.
   */
  outputFileTracingIncludes: {
    "/api/runs": ["./node_modules/playwright-core/browsers.json"],
  },
};

export default nextConfig;
