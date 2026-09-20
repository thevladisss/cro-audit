import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CollectorError, CollectorErrorReason } from "@/app/lib/collector";
import { REGISTRY } from "@/app/lib/rules";
import type { Run, Snapshot } from "@/app/types";
import { RunStatus, Stage, StreamEventType } from "@/app/types";

/**
 * The route is the only layer that composes, so this suite mocks everything it
 * composes: no Chromium, no API key, no KV. What it tests is the wiring —
 * which lines go out, in what order, and what reaches the store when the
 * pipeline fails.
 */

const { collect } = vi.hoisted(() => ({ collect: vi.fn() }));

const store = vi.hoisted(() => ({
  createRun: vi.fn(),
  recordProgress: vi.fn(),
  recordStage: vi.fn(),
  recordFailure: vi.fn(),
}));

const model = vi.hoisted(() => ({
  analyzeWithModel: vi.fn(),
  profileWithModel: vi.fn(),
}));

// `CollectorError` and its reasons stay real: the route branches on
// `instanceof`, so a stubbed class would pass a test the route would fail.
vi.mock("@/app/lib/collector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/collector")>()),
  collect,
}));

// `persistedSnapshot` stays real — what it strips is part of what is asserted.
vi.mock("@/app/lib/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/runs")>()),
  ...store,
}));

// `reconcile` stays real, so the `result` line is the shape it ships.
vi.mock("@/app/lib/analyze", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/analyze")>()),
  ...model,
}));

const { POST } = await import("./route");

const RUN: Run = {
  runId: "run-1",
  url: "https://example.com/",
  status: RunStatus.Pending,
  stage: null,
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  error: null,
};

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    status: 200,
    fetchedAt: "2026-09-19T10:00:00.000Z",
    html: "<html><body>a rendered DOM</body></html>",
    title: "Example",
    metaDescription: "An example.",
    lang: "en",
    canonical: "https://example.com/",
    headings: [{ level: 1, text: "Example" }],
    ctas: [{ text: "Book now", tag: "a", href: "/book" }],
    forms: [{ action: "/enquire", method: "post", fields: [] }],
    images: [],
    links: [{ href: "https://example.com/about", text: "About", external: false }],
    text: "Treatments from £49. Book an appointment today.",
    ...overrides,
  };
}

function request(body: unknown, raw?: string): Request {
  return new Request("http://localhost:3000/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

/** The lines as a client would parse them. */
async function lines(response: Response): Promise<Record<string, unknown>[]> {
  const body = await response.text();

  return body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  store.createRun.mockResolvedValue(RUN);
  store.recordProgress.mockResolvedValue(undefined);
  store.recordStage.mockResolvedValue(undefined);
  store.recordFailure.mockResolvedValue(undefined);
  collect.mockResolvedValue(snapshot());
  // No API key is the normal local case: both calls degrade to `null`.
  model.analyzeWithModel.mockResolvedValue(null);
  model.profileWithModel.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("POST /api/runs — the stream", () => {
  it("streams NDJSON with the run's id in the headers", async () => {
    const response = await POST(request({ url: "https://example.com" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    // A client that drops before the `result` line can still resume from this.
    expect(response.headers.get("x-run-id")).toBe("run-1");
  });

  it("announces each phase before it runs, then the result", async () => {
    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    expect(emitted.map((line) => [line.type, line.stage])).toEqual([
      [StreamEventType.Progress, Stage.Snapshot],
      [StreamEventType.Progress, Stage.Analysis],
      [StreamEventType.Progress, Stage.Analysis],
      [StreamEventType.Progress, Stage.Profile],
      [StreamEventType.Result, undefined],
    ]);
  });

  it("counts the rules from the registry rather than a literal", async () => {
    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    expect(emitted[1].label).toBe(`running ${REGISTRY.length} rules`);
  });

  it("ships the deterministic score and the run's id on the result line", async () => {
    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );
    const result = emitted.at(-1)!;

    expect(result.type).toBe(StreamEventType.Result);
    expect(result.runId).toBe("run-1");
    expect(result.score).toBeDefined();
    expect(result.findings).toBeDefined();
    // The model degraded, so there is no profile to hand stage ②.
    expect(result.profile).toBeNull();
  });

  it("never puts the rendered DOM on the wire", async () => {
    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    expect(JSON.stringify(emitted)).not.toContain("a rendered DOM");
  });

  it("treats an HTTP failure as a page, not an error", async () => {
    collect.mockResolvedValue(snapshot({ status: 404 }));

    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    // A 404 is a page worth auditing — it arrives as `snapshot.status`.
    expect(emitted.at(-1)!.type).toBe(StreamEventType.Result);
  });
});

describe("POST /api/runs — the store", () => {
  it("records the stages it finished", async () => {
    await lines(await POST(request({ url: "https://example.com" })));

    const stages = store.recordStage.mock.calls.map(([, stage]) => stage);
    expect(stages).toEqual([Stage.Snapshot, Stage.Analysis]);

    // Persisted without `html`: Upstash caps a value near 1MB.
    const [, , persisted] = store.recordStage.mock.calls[0];
    expect(persisted).not.toHaveProperty("html");
  });

  it("marks the run done when the result goes out", async () => {
    await lines(await POST(request({ url: "https://example.com" })));

    expect(store.recordProgress).toHaveBeenLastCalledWith("run-1", {
      status: RunStatus.Done,
      stage: null,
    });
  });
});

describe("POST /api/runs — failures after the stream opens", () => {
  it("sends one error line, still under a 200", async () => {
    collect.mockRejectedValue(
      new CollectorError(CollectorErrorReason.Dns, "example.com not found"),
    );

    const response = await POST(request({ url: "https://example.com" }));
    const emitted = await lines(response);

    // The status was sent before the collector was ever called.
    expect(response.status).toBe(200);
    expect(emitted.at(-1)).toEqual({
      type: StreamEventType.Error,
      reason: CollectorErrorReason.Dns,
      message: "example.com not found",
      // The host does not resolve: the input is wrong, not the internet.
      retryable: false,
    });
    expect(store.recordFailure).toHaveBeenCalledWith(
      "run-1",
      "dns: example.com not found",
    );
  });

  it("marks a timeout worth retrying and a refusal not", async () => {
    collect.mockRejectedValue(
      new CollectorError(CollectorErrorReason.Timeout, "the budget expired"),
    );
    const timedOut = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    collect.mockRejectedValue(
      new CollectorError(CollectorErrorReason.Blocked, "403 from the origin"),
    );
    const blocked = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    expect(timedOut.at(-1)!.retryable).toBe(true);
    expect(blocked.at(-1)!.retryable).toBe(false);
  });

  it("says nothing to a client that is the one who left", async () => {
    collect.mockRejectedValue(
      new CollectorError(CollectorErrorReason.Aborted, "the caller went away"),
    );

    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    // Nothing is listening, but the run is honest about how it ended.
    expect(emitted.every((line) => line.type === StreamEventType.Progress)).toBe(
      true,
    );
    expect(store.recordFailure).toHaveBeenCalledWith(
      "run-1",
      "aborted: the caller went away",
    );
  });

  it("does not hand a client a cause chain out of Playwright", async () => {
    collect.mockRejectedValue(new Error("page.goto: net::ERR_FAILED at …"));

    const emitted = await lines(
      await POST(request({ url: "https://example.com" })),
    );

    expect(emitted.at(-1)).toEqual({
      type: StreamEventType.Error,
      reason: null,
      message: "Analysis failed.",
      retryable: false,
    });
    expect(store.recordFailure).toHaveBeenCalledWith("run-1", "Analysis failed.");
  });
});

describe("POST /api/runs — failures before the stream opens", () => {
  it("answers a malformed body with a 400 and no stream", async () => {
    const response = await POST(request(null, "not json"));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Request body must be JSON.",
    });
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it("answers a body the schema rejects with a 422", async () => {
    const response = await POST(request({ url: 123 }));

    expect(response.status).toBe(422);
    expect(collect).not.toHaveBeenCalled();
  });

  it("answers a store it cannot write to with a 503", async () => {
    store.createRun.mockRejectedValue(new Error("upstash is down"));

    const response = await POST(request({ url: "https://example.com" }));

    // Nothing has been spent yet, and a caller handed no `runId` has no way to
    // reach stages ② and ③ — so this one is fatal.
    expect(response.status).toBe(503);
    expect(collect).not.toHaveBeenCalled();
  });
});
