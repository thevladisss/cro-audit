# Wire the client through all three workflow stages

## Context

The three stage endpoints exist and stream correctly against fixtures —
`POST /api/runs`, `POST /api/runs/[runId]/competitors`, `POST /api/runs/[runId]/strategy`,
one per LLM call, with `GET /api/runs/[runId]` to read a run back. `lib/runs.ts` already
holds each run under an unguessable `run_…` key with a 24h TTL.

The client is wired to none of it. `app/page.tsx` still POSTs to `/api/audit` — a 6-second
stub that returns `{url, status:"ok"}` and streams nothing — and fakes progress with a
`FAKE_SCHEDULE` of `setTimeout` calls. `AuditState` models four steps (`idle`, `scanning`,
`done`, `error`), so there is nowhere for a checkpoint to live.

**Outcome:** the workflow becomes clickable end to end on mock data — submit a URL, watch
real streamed progress, correct the niche, confirm the competitor set, read the merged
report. The server keeps its fixtures; nothing here needs the collector, the rules, or an
API key.

### Decisions carried in

- **Server stays mocked.** No `@anthropic-ai/sdk`, no collector. Stages 1 and 2 are blocked
  on README Phases 1–3; this work does not touch them.
- **`lib/runs.ts` keeps its in-process `Map`.** It already has the KV shape and async
  signatures. Known limits stay: no survival across a dev-server restart, and in production
  two requests in one run can hit different instances. Fine for driving the flow locally.
- **`/api/audit` is retired.** Three LLM calls, three endpoints — it isn't one of them.

## Approach

### 1. Extend the state machine — `types/AuditState.type.ts`

Replace the four-step union with the full workflow. `runId` threads through from the first
response; every later step carries the artifacts confirmed before it, so an impossible
combination still can't be represented.

```ts
| { step: "idle"; url: string }
| { step: "analyzing"; url: string; progress: ProgressEvent[] }
| { step: "profile-review"; url: string; runId: string; siteProfile: SiteProfile }
| { step: "finding-competitors"; …; siteProfile: SiteProfile; progress: ProgressEvent[] }
| { step: "competitor-review"; …; competitors: Competitor[] }
| { step: "strategizing"; …; competitors: Competitor[]; progress: ProgressEvent[] }
| { step: "result"; …; strategy: ContentStrategy }
| { step: "error"; url: string; message: string; retryable: boolean }
```

`done` goes away — `result` is the real terminal step.

### 2. Read the NDJSON stream — new `lib/stream.ts`

The one genuinely new primitive. `lib/ndjson.ts` writes the stream; nothing reads it.

```ts
export async function readRunStream<T>(
  response: Response,
  onProgress: (event: ProgressEvent) => void,
): Promise<T>
```

Decode with `TextDecoder` in streaming mode, **buffer the partial trailing line across
chunk boundaries** (the bug that makes this look flaky under load), split on `\n`, parse
each line as `RunStreamEvent<T>` from `types/Progress.type.ts`. A `progress` line calls
`onProgress`; a `result` line resolves; an `error` line throws with its `message` and
`retryable`. A stream that ends with neither throws rather than resolving `undefined`.

Pure enough to unit-test by constructing a `Response` over a `ReadableStream` — no browser,
no server.

### 3. Rewire `app/page.tsx`

Delete `FAKE_SCHEDULE` and the `/api/audit` fetch. One `runStage` helper POSTs, pipes
`readRunStream` into `dispatch({type:"progress"})`, and dispatches the stage's success
action; the three running steps each invoke it with their own URL and body:

| From step | Call | Body | To step |
|---|---|---|---|
| `analyzing` | `POST /api/runs` | `{ url }` | `profile-review` |
| `finding-competitors` | `POST /api/runs/{runId}/competitors` | `{ siteProfile }` (as edited) | `competitor-review` |
| `strategizing` | `POST /api/runs/{runId}/strategy` | `{ competitors }` (as confirmed) | `result` |

Keep the existing `AbortController` cleanup — the comment about not leaving a browser alive
on the server is still the reason. The checkpoint steps run no effect at all; they are the
pause between two requests, which is the whole point of the split.

### 4. Screens

`ScanProgress` is **already** built for this — it takes `stages` and `title` props and
exports `ANALYZE_STAGES`, `COMPETITOR_STAGES`, `STRATEGY_STAGES`. Reuse it unchanged for
all three running steps. Do not write a second progress component.

Three new components under `app/components/audit/`, following the house layout
(`<Name>.tsx`, `<Name>.module.css`, `<Name>.test.tsx`, `index.ts`, then append to the
barrel) and reusing `Button`, `TextField`, `TextArea`, `Card` from `app/components/ui`:

- **`ProfileReview`** — the stage-1 checkpoint. `niche` and `location` as `TextField`s,
  `services` as a `TextArea` one-per-line (split on newline when submitting). Score and
  page list read-only. Continue passes the *edited* profile up.
- **`CompetitorReview`** — the stage-2 checkpoint. One card per competitor showing name,
  URL, `services`, and `claims` **visually distinct** — `claims` are the competitor's own
  marketing copy and must read as attributed, not as fact (`CONCERNS.md` §5). Show
  `confidence`. Allow removing a competitor. Handle the empty array with a real message.
- **`StrategyReport`** — the terminal screen. Score, then recommendations in order, each
  with its `effort`/`impact` and its `evidence` shown as the source it came from.

### 5. Delete `app/api/audit/route.ts`

Remove the directory. Nothing will reference it once `page.tsx` is rewired.

## Files

| Path | Change |
|---|---|
| `types/AuditState.type.ts` | Rewrite the union |
| `lib/stream.ts` | New — NDJSON reader |
| `lib/stream.test.ts` | New — partial lines, error line, truncated stream |
| `app/page.tsx` | Rewrite reducer + effects; drop `FAKE_SCHEDULE` |
| `app/components/audit/ProfileReview/*` | New (4 files) |
| `app/components/audit/CompetitorReview/*` | New (4 files) |
| `app/components/audit/StrategyReport/*` | New (4 files) |
| `app/components/audit/index.ts` | Append the three exports |
| `app/api/audit/route.ts` | Delete |

No changes to `lib/runs.ts`, `lib/ndjson.ts`, the three stage routes, or `types/` beyond
`AuditState`.

## Verify

```bash
npm test
npx tsc --noEmit
npm run lint
```

All three clean. Then drive the real flow:

```bash
npm run dev
```

Walk it end to end at `localhost:3000` and confirm each of these:

1. Submitting a URL shows progress lines that **arrive one at a time** from the server, not
   on a fixed timer — the stage list should advance in step with the route's script.
2. The stage-1 checkpoint renders the fixture profile; editing the niche and continuing
   sends the **edited** value (check the Network tab request body, not just the UI).
3. Removing a competitor at the stage-2 checkpoint excludes it from the strategy request.
4. The final screen shows score, competitors, and recommendations together.
5. Cancel mid-stage aborts the request and returns to the form with the URL still filled.
6. `curl localhost:3000/api/audit -X POST -d '{}'` now 404s.

Report any step that could not be verified rather than claiming it passed.

## Notes

- The `Map` store means a dev-server restart mid-run produces a 404 at the next checkpoint.
  That is expected, not a bug to chase — it is the tradeoff recorded above.
- `AuditStage` still carries `deriving-questions` and `generating-narrative`, marked pending
  the `CONCERNS.md` §1 decision (questions screen vs. checkpoints). Leave both in place;
  this work does not resolve that.
