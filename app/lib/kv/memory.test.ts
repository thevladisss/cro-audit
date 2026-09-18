import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryDriver } from "./memory";

/**
 * The driver `next dev` and vitest run on, tested for the two things it claims
 * to do that a `Map` does not: hand back copies, and forget on schedule.
 *
 * Nothing resets the store between tests — there is no seam to do it with, by
 * design — so each test names its own keys.
 */

describe("memory.ts", () => {
  const driver = createMemoryDriver();

  /** Seconds, the unit `KvDriver.set` takes. */
  const HOUR = 60 * 60;

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("round trip", () => {
    it("returns what was stored", async () => {
      const run = { runId: "a", status: "pending" };

      await driver.set("trip:run", run, { ex: HOUR });

      await expect(driver.get("trip:run")).resolves.toEqual({
        runId: "a",
        status: "pending",
      });
    });

    it("is null for a key that was never written", async () => {
      await expect(driver.get("trip:nothing-here")).resolves.toBeNull();
    });
  });

  /**
   * Redis stores bytes. A driver that stores the caller's object instead is a
   * driver that behaves differently in dev than in production — and the direction
   * of that difference is the worst one: the bug passes locally and appears on
   * Vercel.
   */
  describe("value semantics", () => {
    it("does not move when the caller mutates what it wrote", async () => {
      const run = { runId: "b", stage: "snapshot" };

      await driver.set("copy:written", run, { ex: HOUR });
      run.stage = "analysis";

      await expect(driver.get("copy:written")).resolves.toEqual({
        runId: "b",
        stage: "snapshot",
      });
    });

    it("hands every read its own object", async () => {
      await driver.set(
        "copy:read",
        { runId: "c", stage: "snapshot" },
        { ex: HOUR },
      );

      const first = await driver.get<{ stage: string }>("copy:read");
      first!.stage = "mutated by the caller";

      await expect(driver.get("copy:read")).resolves.toEqual({
        runId: "c",
        stage: "snapshot",
      });
    });
  });

  describe("expiry", () => {
    it("keeps a value right up to its last moment", async () => {
      vi.useFakeTimers();
      await driver.set("ttl:alive", { runId: "d" }, { ex: HOUR });

      vi.advanceTimersByTime(HOUR * 1000 - 1);

      await expect(driver.get("ttl:alive")).resolves.toEqual({ runId: "d" });
    });

    it("forgets it once the budget passes", async () => {
      vi.useFakeTimers();
      await driver.set("ttl:expired", { runId: "e" }, { ex: HOUR });

      vi.advanceTimersByTime(HOUR * 1000);

      await expect(driver.get("ttl:expired")).resolves.toBeNull();
    });

    it("starts the budget over on a rewrite", async () => {
      vi.useFakeTimers();
      await driver.set("ttl:refreshed", { runId: "f", tick: 1 }, {
        ex: HOUR,
      });

      // Most of the budget spent, then written again: the second write is what
      // the next hour is measured from, which is why an active run cannot expire
      // mid-pipeline.
      vi.advanceTimersByTime(HOUR * 1000 - 1000);
      await driver.set("ttl:refreshed", { runId: "f", tick: 2 }, { ex: HOUR });
      vi.advanceTimersByTime(HOUR * 1000 - 1000);

      await expect(driver.get("ttl:refreshed")).resolves.toEqual({
        runId: "f",
        tick: 2,
      });
    });
  });
});
