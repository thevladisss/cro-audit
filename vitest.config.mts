import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Two projects, because two kinds of test live under `app/`.
 *
 * Component tests need jsdom and the RTL setup file. Server modules — the rule
 * registry, scoring, the analyzer — are pure functions that need neither, and
 * under jsdom 30 they do not merely run slowly: the environment fails to boot
 * at all (`html-encoding-sniffer` requires an ESM dependency), so a `node`
 * project is the fix rather than a preference.
 *
 * `environmentMatchGlobs` was removed in vitest 4 — `projects` replaces it.
 *
 * The extension picks the project: `.tsx` needs a DOM, `.ts` does not. Listing
 * paths instead is what let two `app/utils` specs match no project at all and
 * never run, with nothing to show for it — the file was collected by neither
 * and reported by neither. A `.ts` test that does want a DOM is the one case
 * this does not cover; name it `.test.tsx` or give it its own entry.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { tsconfigPaths: true },
        test: {
          name: "client",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["app/**/*.test.tsx"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "server",
          environment: "node",
          include: ["**/*.{test,spec}.ts"],
        },
      },
    ],
  },
});
