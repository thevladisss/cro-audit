import { describe, expect, it, vi } from "vitest";

import { StreamEventType } from "@/app/types";

import { readNdjson } from "./read";

type Result = { runId: string };

const encoder = new TextEncoder();

const PROGRESS_LINE = '{"type":"progress","stage":"snapshot","label":"rendering"}\n';
const RESULT_LINE_A = '{"type":"result","runId":"a"}\n';
const RESULT_LINE_B = '{"type":"result","runId":"b"}\n';

const PROGRESS_EVENT = {
  type: StreamEventType.Progress,
  stage: "snapshot",
  label: "rendering",
};
const RESULT_EVENT_A = { type: StreamEventType.Result, runId: "a" };
const RESULT_EVENT_B = { type: StreamEventType.Result, runId: "b" };

describe("readNdjson", () => {
  it("yields one event per line", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(PROGRESS_LINE));
        controller.enqueue(encoder.encode(RESULT_LINE_A));
        controller.close();
      },
    });

    const events = await Array.fromAsync(readNdjson<Result>(body));

    expect(events).toEqual([PROGRESS_EVENT, RESULT_EVENT_A]);
  });

  it("splits a chunk that carries several lines", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(RESULT_LINE_A + RESULT_LINE_B));
        controller.close();
      },
    });

    const events = await Array.fromAsync(readNdjson<Result>(body));

    expect(events).toEqual([RESULT_EVENT_A, RESULT_EVENT_B]);
  });

  it("joins a line split across chunks", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"res'));
        controller.enqueue(encoder.encode('ult","runId":'));
        controller.enqueue(encoder.encode('"a"}\n'));
        controller.close();
      },
    });

    const events = await Array.fromAsync(readNdjson<Result>(body));

    expect(events).toEqual([RESULT_EVENT_A]);
  });

  it("joins a multi-byte character split across chunks", async () => {
    const line = encoder.encode('{"type":"result","runId":"café"}\n');

    // Mid-way through the two bytes of `é`, which a decoder told to finish
    // would turn into U+FFFD.
    const split = line.indexOf(0xc3) + 1;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(line.slice(0, split));
        controller.enqueue(line.slice(split));
        controller.close();
      },
    });

    const events = await Array.fromAsync(readNdjson<Result>(body));

    expect(events).toEqual([{ type: StreamEventType.Result, runId: "café" }]);
  });

  it("skips blank lines", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("\n" + RESULT_LINE_A + "\n"));
        controller.close();
      },
    });

    const events = await Array.fromAsync(readNdjson<Result>(body));

    expect(events).toEqual([RESULT_EVENT_A]);
  });

  it("drops a truncated final line", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(RESULT_LINE_A + '{"type":"pro'));
        controller.close();
      },
    });

    const events = await Array.fromAsync(readNdjson<Result>(body));

    expect(events).toEqual([RESULT_EVENT_A]);
  });

  it("throws on a whole line that is not JSON", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<html>nope</html>\n"));
        controller.close();
      },
    });

    await expect(Array.fromAsync(readNdjson<Result>(body))).rejects.toThrow(
      "not JSON",
    );
  });

  it("cancels the body when the caller stops reading", async () => {
    const cancel = vi.fn();

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(RESULT_LINE_A + RESULT_LINE_B));
      },
      cancel,
    });

    for await (const event of readNdjson<Result>(body)) {
      expect(event).toEqual(RESULT_EVENT_A);
      break;
    }

    expect(cancel).toHaveBeenCalledOnce();
  });
});
