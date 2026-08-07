# Run lifecycle

How the client state machine and the three stage endpoints drive one run between them.
Companion to [AGENTIC-WORKFLOW.md](./AGENTIC-WORKFLOW.md), which describes *what* the three
stages do; this covers *how control passes* between browser and server.

**Status:** the server half is built and mocked — the four routes stream real NDJSON over
fixtures. The client half is designed, not built: `app/page.tsx` still calls the `/api/audit`
stub and fakes progress with `setTimeout`.

---

## 1. There are two state machines

One per side, tracking the same run. They are not the same object and they do not always
agree — the interesting part is knowing where and why.

| Machine | Lives in | Holds |
|---|---|---|
| `Run.status` | `types/Run.type.ts`, persisted in `lib/runs.ts` | Where the run is resting |
| `AuditState.step` | React state in `app/page.tsx` | What is on screen |

They correspond exactly:

| Client `step` | Server `status` | Who is working | Request open? |
|---|---|---|---|
| `idle` | *(no run yet)* | nobody | no |
| `analyzing` | `analyzing` | **server** | yes |
| `profile-review` | `profiled` | **user** | no |
| `finding-competitors` | `finding-competitors` | **server** | yes |
| `competitor-review` | `competitors-found` | **user** | no |
| `strategizing` | `strategizing` | **server** | yes |
| `result` | `complete` | nobody | no |
| `error` | `failed` *(see §7)* | nobody | no |

The grammar gives it away. The server's present participles — `analyzing`,
`finding-competitors`, `strategizing` — are the client's running states. Its past tenses —
`profiled`, `competitors-found`, `complete` — are the client's checkpoints and terminal.
Same fact, two vantage points.

---

## 2. Endpoints

Three LLM calls, three POSTs. The fourth is a read.

| Endpoint | Body | Streams | Returns |
|---|---|---|---|
| `POST /api/runs` | `{ url }` | progress | `{ runId, siteProfile }` |
| `POST /api/runs/[runId]/competitors` | `{ siteProfile }` *(as edited)* | progress | `Competitor[]` |
| `POST /api/runs/[runId]/strategy` | `{ competitors }` *(as confirmed)* | progress | `{ siteProfile, competitors, strategy }` |
| `GET /api/runs/[runId]` | — | — | the whole `Run` |

There is no endpoint for a checkpoint. A checkpoint is the pause *between* two requests, so
the user's correction rides in as the body of the next one — see §4.

---

## 3. Who moves the machines

**During a request, both move together.** Every stage route writes status twice — once
before the work, once after — so the client's `progress` dispatches and the server's status
change are the same interval seen from either end.

**Between requests, only the client moves.** At a checkpoint the server sits at `profiled`
indefinitely. Nothing on the server knows a human is reading, editing, or has closed the
laptop: no connection is open and no timer is running. The only thing that wakes it is the
next POST.

That asymmetry is the reason for the split in the first place — a serverless function
cannot hold a stream open across a human's attention span.

---

## 4. The divergence window

At a checkpoint the two sides deliberately hold different data:

- The server has the **original** `siteProfile` from stage 1.
- The client has the user's **edited** copy — corrected niche, fixed location.

They disagree for exactly as long as the user is editing, and the next POST reconciles it,
because each stage endpoint does **two jobs**: commit the previous checkpoint's edit, then
run this stage.

That dual role is why no `PATCH /api/runs/[runId]/profile` exists. A checkpoint edit is not
a separate write — it is the body of the next request.

---

## 5. Server end

The shape every stage route already follows. Reuse `streamRun` from `lib/ndjson.ts` and the
store helpers from `lib/runs.ts`; never hand-roll a stream or touch the `Map` directly.

```ts
// app/api/runs/[runId]/competitors/route.ts — condensed
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  const run = await getRun(runId);
  if (!run) {
    return Response.json({ message: "Run not found." }, { status: 404 });
  }

  const { siteProfile } = await request.json();
  if (!isSiteProfile(siteProfile)) {
    return Response.json({ message: "A confirmed siteProfile is required." }, { status: 400 });
  }

  // Job 1 — commit the stage-1 checkpoint's edit, and mark the run in flight.
  await patchRun(runId, { siteProfile, status: "finding-competitors" });

  // Job 2 — run the stage. Progress lines stream as they happen; the payload is
  // the final `result` line, sent whole.
  return streamRun<Competitor[]>(
    SCRIPT,
    async () => {
      const competitors = await findCompetitors(siteProfile);
      await patchRun(runId, { competitors, status: "competitors-found" });
      return competitors;
    },
    request.signal,
  );
}
```

The wire format is one JSON object per line (`types/Progress.type.ts`):

```ts
type RunStreamEvent<T> =
  | { type: "progress"; event: ProgressEvent }
  | { type: "result"; data: T }
  | { type: "error"; message: string; retryable: boolean };
```

Exactly one `result` **or** one `error`, always last. Progress streams; the payload does
not — half a structured object renders as nothing.

---

## 6. Client end

### The union

Each transition adds a field and never removes one. Running states carry `progress`;
checkpoint states carry the artifact under review and no progress at all.

```ts
export type AuditState =
  | { step: "idle"; url: string }
  | { step: "analyzing"; url: string; progress: ProgressEvent[] }
  | { step: "profile-review"; url: string; runId: string; siteProfile: SiteProfile }
  | { step: "finding-competitors"; url: string; runId: string;
      siteProfile: SiteProfile; progress: ProgressEvent[] }
  | { step: "competitor-review"; url: string; runId: string;
      siteProfile: SiteProfile; competitors: Competitor[] }
  | { step: "strategizing"; url: string; runId: string; siteProfile: SiteProfile;
      competitors: Competitor[]; progress: ProgressEvent[] }
  | { step: "result"; url: string; runId: string; siteProfile: SiteProfile;
      competitors: Competitor[]; strategy: ContentStrategy }
  | { step: "error"; url: string; message: string; retryable: boolean };
```

`finding-competitors` cannot exist without a `siteProfile`, so the stage-2 request can never
be built from nothing. Same for `strategizing` and `competitors`.

### Reading the stream

`lib/ndjson.ts` writes the format; this reads it. The detail that matters is buffering the
partial trailing line across chunk boundaries — skip it and the stream looks flaky under
load.

```ts
export async function readRunStream<T>(
  response: Response,
  onProgress: (event: ProgressEvent) => void,
): Promise<T> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";           // keep the incomplete tail

    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line) as RunStreamEvent<T>;

      if (event.type === "progress") onProgress(event.event);
      else if (event.type === "result") return event.data;
      else throw new StageError(event.message, event.retryable);
    }
  }

  throw new StageError("The stage ended without a result.", true);
}
```

### Driving the three stages

One effect. It derives a request from the current step — checkpoints derive `null`, so
nothing fires and the machine simply waits.

```tsx
const request =
  state.step === "analyzing"
    ? { path: "/api/runs", body: { url: state.url }, done: profiled }
  : state.step === "finding-competitors"
    ? { path: `/api/runs/${state.runId}/competitors`,
        body: { siteProfile: state.siteProfile }, done: competitorsFound }
  : state.step === "strategizing"
    ? { path: `/api/runs/${state.runId}/strategy`,
        body: { competitors: state.competitors }, done: strategyReady }
  : null;

useEffect(() => {
  if (!request) return;
  const controller = new AbortController();

  void (async () => {
    try {
      const response = await fetch(request.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      if (!response.ok) return dispatch(failed(await readErrorMessage(response)));

      const data = await readRunStream(response, (event) =>
        dispatch({ type: "progress", event }),
      );
      dispatch(request.done(data));
    } catch (error) {
      if (controller.signal.aborted) return;   // cancel and unmount both land here
      dispatch(failed(messageFrom(error)));
    }
  })();

  // Without this the server keeps working on a run nobody is waiting for.
  return () => controller.abort();
}, [state.step]);
```

### The checkpoint transition

The user's edit lives in the checkpoint component's local state — typing does not touch the
machine. Continue dispatches it, and the reducer carries the *edited* value into the next
running step, where the effect picks it up as the request body:

```ts
case "confirm-profile":
  if (state.step !== "profile-review") return state;
  return {
    step: "finding-competitors",
    url: state.url,
    runId: state.runId,
    siteProfile: action.siteProfile,   // ← the edit, not the original
    progress: [],
  };
```

Every case guards on the current step, so a late dispatch from an aborted request cannot
resurrect a dead state.

---

## 7. Known gaps

**`"failed"` is declared but never written.** `RunStatus` has it; nothing sets it. When a
stage throws, `streamRun` sends an `error` line and leaves the run untouched — so the client
shows `error` while the server still reads `finding-competitors` forever. The two machines
desynchronise on exactly the path where you most want to know what happened. One `patchRun`
in `streamRun`'s catch block closes it.

**`setStatus` in `lib/runs.ts` is never called.** Every route uses `patchRun` with an inline
status, because they always write an artifact at the same time. Either delete it or use it
in the failure path above — a status change with no artifact is precisely what that needs.

**Nothing calls `GET /api/runs/[runId]`.** The §1 table *is* the resync function —
`profiled` → `profile-review`, `competitors-found` → `competitor-review`,
`complete` → `result` — and every field each step needs is already on the `Run`. Refresh at
a checkpoint is recoverable in principle; the endpoint exists, the mapping is total, and no
code walks it yet.

**`error` drops the `runId`.** A failure at stage 2 sends the user back to re-run stage 1
from scratch — a render they already paid for. Carrying `runId` on the error state would
make "resume" possible once the point above is wired.

**The store is an in-process `Map`.** It does not survive a dev-server restart, and in
production two requests in one run can land on different instances and 404. `lib/runs.ts`
is written so the KV swap is a body change, not a signature change (AUDIT-DESIGN §9.4).
