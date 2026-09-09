import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sleep } from "./utils";

/**
 * Fake clocks, not real waiting: the point of a timer helper is *when* it
 * settles, and a test that proves that by sleeping is a test that costs the
 * suite the very seconds it is measuring.
 */
describe("utils.ts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("sleep", () => {
    it("resolves once the time has passed, and not a tick before", async () => {
      const settled = vi.fn();
      void sleep(2_500).then(settled);

      await vi.advanceTimersByTimeAsync(2_499);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("still yields to the event loop at zero", async () => {
      // The settle race passes a caller-supplied number; 0 must not resolve
      // synchronously, or `Promise.race` would decide before the work it is
      // racing has had a chance to start.
      const settled = vi.fn();
      void sleep(0).then(settled);

      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it("loses a race to work that finishes first, and wins one against work that does not", async () => {
      // Both halves of how `render` uses it: the settle cap is a ceiling on
      // waiting, never a floor.
      const quick = Promise.resolve("loaded");
      await expect(Promise.race([quick, sleep(2_500)])).resolves.toBe("loaded");

      const stalled = new Promise(() => {});
      const raced = Promise.race([stalled, sleep(2_500).then(() => "gave up")]);
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(raced).resolves.toBe("gave up");
    });

    it("runs concurrent sleeps on one clock, in delay order", async () => {
      const order: number[] = [];
      void sleep(30).then(() => order.push(30));
      void sleep(10).then(() => order.push(10));
      void sleep(20).then(() => order.push(20));

      await vi.advanceTimersByTimeAsync(30);

      expect(order).toEqual([10, 20, 30]);
    });
  });
});
