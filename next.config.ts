import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Both halves of the browser reach for files by a path they compute at
   * runtime, which file tracing cannot follow — so neither ships with the
   * deployed function unless named here.
   *
   * `playwright-core` reads its browser registry with
   * `require(path.join(linkTarget, "browsers.json"))` (`lib/coreBundle.js`).
   *
   * `@sparticuz/chromium` inflates the Chromium binary out of `bin/*.br`,
   * located with `join(dirname(fileURLToPath(import.meta.url)), "..", "bin")`
   * (`build/index.js`). That is ~69MB — the bulk of the function — and all of
   * it is required: `al2023.tar.br` is what the Amazon Linux 2023 runtime
   * Vercel uses needs, and the binary refuses to start without the fonts and
   * swiftshader archives.
   */
  outputFileTracingIncludes: {
    "/api/runs": [
      "./node_modules/playwright-core/browsers.json",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;
