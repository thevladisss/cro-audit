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
          include: ["app/**/*.test.{ts,tsx}"],
          exclude: ["app/lib/**"],
        },
      },
      {
        resolve: { tsconfigPaths: true },
        test: {
          name: "server",
          environment: "node",
          include: ["app/lib/**/*.test.ts", "tools/**/*.test.ts"],
        },
      },
    ],
  },
});
