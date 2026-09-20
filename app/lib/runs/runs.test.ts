import { afterEach, describe, expect, it, vi } from "vitest";

import type { Snapshot } from "@/app/types";
import { RunStatus, Stage } from "@/app/types";

import { TTL } from "./keys";
import {
  createRun,
  findRunByUrl,
  getRun,
  getStage,
  patchRun,
  persistedSnapshot,
  putStage,
} from "./runs";

/**
 * No env, so `kv` resolves to the in-memory driver — the same property that
 * makes `lib/rules` and `lib/analyze` runnable without a network.
 *
 * Nothing resets that store between tests, and nothing needs to: run keys are
 * UUIDs, and vitest gives each test file its own process. `run:url:{url}` is
 * the one key two tests could collide on, so a test that needs a url nobody has
 * audited names a host of its own.
 */

describe("runs.ts", () => {
  function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
    return {
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      fetchedAt: "2026-09-16T10:00:00.000Z",
      html: "<html><body>a rendered DOM</body></html>",
      title: "Example",
      metaDescription: null,
      lang: "en",
      canonical: null,
      headings: [{ level: 1, text: "Example" }],
      ctas: [],
      forms: [],
      images: [],
      links: [],
      text: "Example",
      ...overrides,
    };
  }

  describe("createRun", () => {
    it("stores a pending run addressable by id", async () => {
      const run = await createRun("https://example.com/");

      expect(run.status).toBe(RunStatus.Pending);
      expect(run.stage).toBeNull();
      expect(run.error).toBeNull();
      await expect(getRun(run.runId)).resolves.toEqual(run);
    });

    it("indexes the run under its normalized url", async () => {
      const run = await createRun("example.com");

      expect(run.url).toBe("https://example.com/");
      // The form submits bare hostnames; both spellings are the same site.
      await expect(findRunByUrl("https://example.com/")).resolves.toEqual(run);
      await expect(findRunByUrl("example.com")).resolves.toEqual(run);
    });

    it("points the url index at the newest run", async () => {
      await createRun("https://example.com/");
      const second = await createRun("https://example.com/");

      await expect(findRunByUrl("https://example.com/")).resolves.toEqual(
        second,
      );
    });

    it("has no run for a url that was never audited", async () => {
      await expect(
        findRunByUrl("https://nothing-here.test/"),
      ).resolves.toBeNull();
    });
  });

  describe("patchRun", () => {
    it("merges the patch and moves updatedAt, not createdAt", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-16T10:00:00.000Z"));
      const run = await createRun("https://example.com/");

      vi.setSystemTime(new Date("2026-09-16T10:00:05.000Z"));
      await patchRun(run.runId, { status: RunStatus.Running, stage: Stage.Snapshot });

      const patched = await getRun(run.runId);
      expect(patched).toEqual({
        ...run,
        status: RunStatus.Running,
        stage: "snapshot",
        updatedAt: "2026-09-16T10:00:05.000Z",
      });
      vi.useRealTimers();
    });

    it("records the failure message on the run", async () => {
      const run = await createRun("https://example.com/");

      await patchRun(run.runId, {
        status: RunStatus.Failed,
        stage: null,
        error: "timeout: the page took longer than 30s",
      });

      const failed = await getRun(run.runId);
      expect(failed?.status).toBe(RunStatus.Failed);
      expect(failed?.error).toBe("timeout: the page took longer than 30s");
    });

    it("is a no-op for an id the store never issued", async () => {
      await patchRun("not-a-run", { status: RunStatus.Done });

      await expect(getRun("not-a-run")).resolves.toBeNull();
    });
  });

  describe("stages", () => {
    it("round-trips a stage payload", async () => {
      const run = await createRun("https://example.com/");
      const persisted = persistedSnapshot(snapshot());

      await putStage(run.runId, Stage.Snapshot, persisted);

      await expect(getStage(run.runId, Stage.Snapshot)).resolves.toEqual(
        persisted,
      );
    });

    it("is null for a stage that has not run", async () => {
      const run = await createRun("https://example.com/");

      await expect(getStage(run.runId, Stage.Analysis)).resolves.toBeNull();
    });

    it("keeps the rendered DOM out of the store", async () => {
      const persisted = persistedSnapshot(snapshot());

      expect(persisted).not.toHaveProperty("html");
      expect(persisted.finalUrl).toBe("https://example.com/");
      expect(persisted.text).toBe("Example");
    });
  });

  describe("ttl", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("forgets a run once the 24h budget passes", async () => {
      vi.useFakeTimers();
      const run = await createRun("https://example.com/");

      vi.advanceTimersByTime((TTL + 1) * 1000);

      await expect(getRun(run.runId)).resolves.toBeNull();
      await expect(findRunByUrl("https://example.com/")).resolves.toBeNull();
    });

    it("refreshes the budget on every write, so an active run survives", async () => {
      vi.useFakeTimers();
      const run = await createRun("https://example.com/");

      // Two patches, each most of a day apart: 36h of wall clock, never 24h quiet.
      vi.advanceTimersByTime(18 * 60 * 60 * 1000);
      await patchRun(run.runId, { status: RunStatus.Running });
      vi.advanceTimersByTime(18 * 60 * 60 * 1000);
      await patchRun(run.runId, { stage: Stage.Analysis });

      const alive = await getRun(run.runId);
      expect(alive?.status).toBe(RunStatus.Running);
      expect(alive?.stage).toBe("analysis");
    });
  });
});
