import { afterEach, describe, expect, it, vi } from "vitest";

import { Stage, StreamEventType, type StreamEvent } from "@/app/types";

import { ndjsonResponse, type Emit } from "./ndjson";

/** The payload a `result` line spreads, so `T` is something concrete here. */
type TestResult = { value: number };

const progress: StreamEvent<TestResult> = {
  type: StreamEventType.Progress,
  stage: Stage.Snapshot,
  label: "rendering the page in a real browser",
};

const result: StreamEvent<TestResult> = {
  type: StreamEventType.Result,
  value: 1,
};

/** The lines as a client would parse them: split on `\n`, drop the trailing empty. */
function lines(body: string): unknown[] {
  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ndjsonResponse", () => {
  it("answers as an unbuffered, uncacheable NDJSON stream", async () => {
    const response = ndjsonResponse<TestResult>(async (emit) => {
      emit(result);
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Without it a proxy may hold the early lines until the body completes,
    // which is the whole feature.
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });

  it("merges the caller's headers over its own", async () => {
    const response = ndjsonResponse<TestResult>(
      async (emit) => {
        emit(result);
      },
      { headers: { "x-run-id": "run-1" } },
    );

    expect(response.headers.get("x-run-id")).toBe("run-1");
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  });

  it("writes one JSON object per line, each line terminated", async () => {
    const response = ndjsonResponse<TestResult>(async (emit) => {
      emit(progress);
      emit(result);
    });

    const body = await response.text();

    expect(body).toBe(
      `${JSON.stringify(progress)}\n${JSON.stringify(result)}\n`,
    );
    expect(lines(body)).toEqual([progress, result]);
  });

  it("keeps a newline inside a value from breaking the line", async () => {
    const response = ndjsonResponse<TestResult>(async (emit) => {
      emit({ ...progress, label: "rendering\nthe page" });
    });

    const body = await response.text();

    // One line, however many newlines the payload contains.
    expect(body.split("\n").filter((line) => line.length > 0)).toHaveLength(1);
    expect(lines(body)).toEqual([{ ...progress, label: "rendering\nthe page" }]);
  });

  it("closes the stream when the body resolves", async () => {
    const response = ndjsonResponse<TestResult>(async (emit) => {
      emit(result);
    });

    // `text()` only settles on a closed stream.
    await expect(response.text()).resolves.toContain('"type":"result"');
  });

  it("drops an emit that arrives after the body is done", async () => {
    const captured: { emit?: Emit<TestResult> } = {};

    const response = ndjsonResponse<TestResult>(async (emit) => {
      captured.emit = emit;
      emit(progress);
    });

    const body = await response.text();

    // A progress tick is not worth a throw from a closed controller.
    expect(() => captured.emit?.(result)).not.toThrow();
    expect(lines(body)).toEqual([progress]);
  });

  it("closes rather than truncates when the body throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = ndjsonResponse<TestResult>(async (emit) => {
      emit(progress);
      throw new Error("the pipeline failed to handle its own failure");
    });

    // Not a rejection: an errored stream is the one outcome a client cannot
    // tell apart from a dropped connection.
    const body = await response.text();

    expect(lines(body)).toEqual([progress]);
    expect(logged).toHaveBeenCalledOnce();
  });

  it("aborts the body's signal when the reader goes away", async () => {
    const stopped = Promise.withResolvers<void>();
    const captured: { signal?: AbortSignal } = {};

    const response = ndjsonResponse<TestResult>(async (emit, signal) => {
      captured.signal = signal;
      emit(progress);

      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve());
      });

      stopped.resolve();
    });

    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    // The render behind the stream stops with it — a client that hung up
    // leaves nothing running.
    await stopped.promise;
    expect(captured.signal?.aborted).toBe(true);
  });

  it("does not abort a body that ran to completion", async () => {
    const captured: { signal?: AbortSignal } = {};

    const response = ndjsonResponse<TestResult>(async (emit, signal) => {
      captured.signal = signal;
      emit(result);
    });

    await response.text();

    expect(captured.signal?.aborted).toBe(false);
  });
});
