import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStatus, Stage } from "@/app/types";

import { recordFailure, recordProgress, recordStage } from "./record";
import { patchRun, putStage } from "./runs";

/**
 * `record.ts` is the store's two writes with their failure swallowed, so the
 * store is a stub here: that a patch reaches KV is `runs.test.ts`'s subject.
 * What this file checks is which write each recorder issues, and what it does
 * when that write throws.
 */
vi.mock("./runs", () => ({
  patchRun: vi.fn(),
  putStage: vi.fn(),
}));

describe("record.ts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(patchRun).mockReset();
    vi.mocked(putStage).mockReset();
  });

  describe("recordProgress", () => {
    it("patches the run with the tick it was given", async () => {
      await recordProgress("run-1", {
        status: RunStatus.Running,
        stage: Stage.Snapshot,
      });

      expect(patchRun).toHaveBeenCalledWith("run-1", {
        status: RunStatus.Running,
        stage: "snapshot",
      });
      expect(putStage).not.toHaveBeenCalled();
    });
  });

  describe("recordStage", () => {
    it("puts the payload under the stage it names", async () => {
      const profile = { url: "https://example.com/", pages: ["/"], score: 72 };

      await recordStage("run-1", Stage.Profile, profile as never);

      expect(putStage).toHaveBeenCalledWith("run-1", Stage.Profile, profile);
      expect(patchRun).not.toHaveBeenCalled();
    });
  });

  describe("recordFailure", () => {
    it("ends the run on the message the client was given", async () => {
      await recordFailure("run-1", "timeout: the page took longer than 30s");

      // `stage: null` matters as much as the status: a failed run is not still
      // working on something.
      expect(patchRun).toHaveBeenCalledWith("run-1", {
        status: RunStatus.Failed,
        stage: null,
        error: "timeout: the page took longer than 30s",
      });
    });
  });

  describe("when the write throws", () => {
    it("logs and resolves, so bookkeeping cannot sink an audit", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const down = new Error("upstash unreachable");
      vi.mocked(patchRun).mockRejectedValue(down);
      vi.mocked(putStage).mockRejectedValue(down);

      await expect(
        recordProgress("run-1", { stage: Stage.Analysis }),
      ).resolves.toBeUndefined();
      await expect(
        recordStage("run-1", Stage.Analysis, {} as never),
      ).resolves.toBeUndefined();
      await expect(
        recordFailure("run-1", "Analysis failed."),
      ).resolves.toBeUndefined();

      // Swallowed, not silent: three failed writes, three lines in the log.
      expect(logged).toHaveBeenCalledTimes(3);
    });
  });
});
