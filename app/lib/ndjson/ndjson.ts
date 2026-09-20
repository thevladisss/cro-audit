import { StreamEventType, type StreamEvent } from "@/app/types";

/**
 * The NDJSON half of a stage endpoint: a `ReadableStream` carrying one JSON
 * object per line, and the `emit` a pipeline calls as it goes.
 *
 * NDJSON rather than SSE because these streams answer a `POST` with a body, and
 * `EventSource` is GET-only — so SSE would mean hand-parsing `event:`/`data:`
 * out of `fetch`, which discards the only thing SSE offers. Its auto-reconnect
 * would also be an anti-feature here: a dropped connection must not silently
 * re-run a non-idempotent 60s pipeline.
 *
 * This module knows nothing about runs, stages or the store — `emit` takes a
 * `StreamEvent` and that is the entire contract. Joining "what the pipeline is
 * doing" to "what the client is told" belongs to the route, the only layer that
 * already holds both.
 *
 * No heartbeat, deliberately (README.md:240): a stall inside a 30s render has
 * to read as a stall. A keep-alive line makes a hung Chromium look exactly like
 * a slow one, which is the diagnosis this stream exists to give.
 */

/** One per process — `TextEncoder` is stateless. */
const encoder = new TextEncoder();

export type Emit<T> = (event: StreamEvent<T>) => void;

export type NdjsonInit = {
  /** Merged over the three below, for a caller that has its own to send. */
  headers?: HeadersInit;
};

export function ndjsonResponse<T>(
  run: (emit: Emit<T>, signal: AbortSignal) => Promise<void>,
  init: NdjsonInit = {},
): Response {
  /**
   * The hang-up signal. Dropping writes is not enough on its own: a client that
   * goes away mid-render leaves a Chromium page and two model calls running for
   * nobody. `cancel` below is where the platform says so, and this is how the
   * body gets told — the pipeline aborts the same way it would on a timeout.
   */
  const hangup = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      /**
       * Flipped once and never back. `enqueue` on a controller whose client
       * hung up throws, and a progress tick is not worth failing a run over —
       * the argument `lib/runs/record.ts` already makes for the store writes.
       */
      let open = true;

      const emit: Emit<T> = (event) => {
        if (!open) return;

        try {
          // One `stringify`, one `enqueue`: a payload is a whole line or it is
          // not sent (README.md:242). `stringify` escapes newlines inside
          // string values, so a break can never appear mid-object.
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };

      /**
       * Not awaited, and not returned. A promise returned from `start` has no
       * error channel but erroring the stream — a truncated body with no
       * `error` line, which is the one outcome a client cannot tell apart from
       * a dropped connection. Running it here names every exit instead: the
       * `catch` logs a throw the caller failed to handle, and the `finally`
       * closes exactly once.
       */
      void (async () => {
        try {
          await run(emit, hangup.signal);
        } catch (error) {
          console.error("[lib/ndjson] the stream body threw:", error);
        } finally {
          open = false;

          try {
            controller.close();
          } catch {
            // Already closed or errored — the client is gone either way.
          }
        }
      })();
    },

    /**
     * The reader went away: a closed tab, an aborted `fetch`, a proxy that gave
     * up. Nothing will read another line, so the work behind it stops too.
     */
    cancel(reason) {
      hangup.abort(reason);
    },
  });

  const headers = new Headers({
    "content-type": "application/x-ndjson",
    // Progress is not a resource. An intermediary caching this would serve
    // one run's stages as another run's.
    "cache-control": "no-store",
    // nginx and the Vercel edge both read it. Without it a proxy may hold the
    // early lines until the body completes, which is the whole feature.
    "x-accel-buffering": "no",
  });

  // Last writer wins, so a caller can override any of the three — it is the
  // caller that knows whether this stream is the usual case.
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));

  // `new Response(stream)` is the pattern Next 16 documents for a route handler
  // — route.md:401-439. No framework helper is involved.
  return new Response(stream, { headers });
}

/** Named only so the barrel can re-export the enum consumers discriminate on. */
export { StreamEventType };
