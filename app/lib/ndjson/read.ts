import type { StreamEvent } from "@/app/types";

export async function* readNdjson<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent<T>> {
  const reader = body.getReader();
  // `stream: true` on every decode: a chunk boundary can land inside a
  // multi-byte character, and a decoder told to finish would emit U+FFFD.
  const decoder = new TextDecoder();

  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // A chunk arrives on no particular boundary: it may carry several lines,
      // one, or half of one. Splitting on the newline separates what is whole
      // from what is not — the last piece has no newline after it yet, so it
      // goes back in the buffer to be finished by a later chunk. It is `""`
      // when the chunk happened to end on a line break.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length === 0) continue;

        try {
          const parsed = JSON.parse(line) as StreamEvent<T>;
          yield parsed;
        } catch (cause) {
          throw new Error("The stream carried a line that is not JSON.", { cause });
        }
      }
    }

    // Anything still in the buffer is a line with no newline after it, which
    // the writer never produces — `emit` encodes the object and the newline in
    // one call. So a remainder means the body was truncated, and the half
    // object is dropped rather than parsed.
  } finally {
    /**
     * Reached on a `break` in the caller's loop as much as on a clean end.
     * Cancelling is what tells the server nobody is reading: the route's
     * `cancel` aborts Chromium and the model calls. It rejects on a body that
     * already errored, which is not news worth raising here.
     */
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
