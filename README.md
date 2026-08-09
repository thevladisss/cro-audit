# CRO Audit

## ⏰ Project is in active development phase.

**Give it a URL. Get back a scored conversion audit of your site, a profile of who
you're competing with, and a content strategy where every recommendation cites the
evidence it came from.**

A Next.js application whose backend is an agentic workflow: one orchestrator holds the
run, and three role-based subagents run in sequence — with the user confirming the
findings between stages.

<div align="center">

`Next.js 16` · `React 19` · `TypeScript` · `Tailwind v4` · `Claude API (Opus 5)` · `Vitest`

</div>

---

## The flow

The product has one input — a URL field — and pauses twice to let the user correct what
was found before spending the next stage on it.

```
                 ┌──────────── the orchestrator holds the run ────────────┐
                 │      run store: SiteProfile → Competitor[] → Strategy  │
                 └───────┬───────────────┬────────────────┬──────────────-┘
                         │               │                │
  URL ──▶  ① Website Analyzer  ─✓─▶  ② Competitor Finder  ─✓─▶  ③ Content Strategist  ──▶  report
                         │               │                │
                    renders the      searches the      compares, prioritizes,
                    site, scores     market, fetches   and writes the plan
                    ~30 CRO rules,   rivals over
                    profiles the     plain HTTP
                    business
                                    ✓ = checkpoint: the user confirms or edits
                                        before the next stage runs
```

Each stage is its own HTTP request that streams **NDJSON progress** while it works, then
sends its structured result as the final line. A checkpoint is not a request — it is the
pause *between* two, which is exactly why the run has to live somewhere other than the
client.

| Stage | Endpoint | Produces |
|---|---|---|
| ① Website Analyzer | `POST /api/runs` | `SiteProfile` — niche, location, services, pages, score |
| ② Competitor Finder | `POST /api/runs/[runId]/competitors` | `Competitor[]` — observed services vs. claimed marketing copy |
| ③ Content Strategist | `POST /api/runs/[runId]/strategy` | `ContentStrategy` — recommendations, each with `Evidence[]` |
| — | `GET /api/runs/[runId]` | Resume a run after a refresh or a closed laptop |

---

## Tools

Three model calls, one per stage, each **stateless** — no conversation crosses a stage
boundary, and what passes between them is a typed artifact, not a transcript. Each call
ends by *calling a tool* rather than returning free text: `strict: true`,
`additionalProperties: false`, every field `required`. That guarantees the input validates,
and gives one obvious place to run the checks.

| Stage | Tool | What the model authors |
|---|---|---|
| ① Website Analyzer | `submit_profile` | `name` · `niche` · `location` · `services[]` |
| ② Competitor Finder | `submit_competitors` | per record — `url` · `name` · `services[]` · `location` · `claims[]` · `confidence` |
| ③ Content Strategist | `submit_strategy` | `summary` · `recommendations[]`, each `title` · `rationale` · `effort` · `impact` · `evidence[]` |

**An agent never returns a field the code already knows or can compute.** Not `score` — the
rules produced it. Not `url` — the user typed it. Not `pages` — the collector found them.
Not a recommendation `id` — it's derived from the title. So each tool takes a *draft*, a
strict subset, and code assembles the real type around it:

---

## Architecture notes

The parts worth a look, and why they're built that way.

### The score is deterministic; the model writes the prose

Roughly 30 CRO rules are **pure functions over a page snapshot** — no browser in the
test run, and a re-run of an unchanged page produces an identical score. The model
orders, explains, recommends, and asks questions. It never returns a number.

That split exists for reproducibility, but it doubles as the primary defense against
prompt injection: the page being audited is attacker-controlled text, and the worst a
successful injection achieves is bad prose attached to an unchanged score.

### Prompt injection is treated as the design constraint, not a footnote

Four structural defenses, in descending order of how much they actually carry:

1. **The score is computed before the agent runs**, and the agent cannot write it.
2. **Every tool is read-only** — pure functions over an in-memory object. No writes, no
   network, no re-collection. There is no side effect for an injection to reach.
3. **Output is schema-constrained and validated.** The agent finishes by calling a
   terminal `submit_draft` tool with `strict: true`; any `ruleId` it returns that isn't
   in the deterministic finding set is dropped, not trusted.
4. **Untrusted content is delimited and labelled** at every boundary, and never reaches
   the system prompt.

### Claimed vs. observed

Every competitor homepage says "the region's leading provider." A naive pipeline files
that under *unique selling points*, and stage 3 then tells the user competitors offer
something nobody actually offers. So `Competitor` splits the two:

```ts
services: string[];   // observed — present on the fetched page
claims:   string[];   // claimed  — marketing copy, attributed, never asserted as true
confidence: "high" | "medium" | "low";
```

This is a **data quality** problem before it is a security one — it fires on completely
innocent sites, on run one, with no adversary involved.

### Every recommendation cites its evidence

A recommendation that can't point at something we actually saw is dropped rather than
surfaced:

```ts
type Evidence =
  | { source: "competitor"; competitorUrl: string; observation: string }
  | { source: "finding";    ruleId: string;        observation: string };
```

Grounding does double duty: better recommendations, *and* it makes the claimed-vs-observed
problem above visible instead of invisible.

### Real browser for your site, plain HTTP for competitors

Above-the-fold layout is a *rendering* question, so the user's own site gets Chromium.
Nothing about a competitor record is — name, services, location, and USPs all live in
HTML, meta tags, or JSON-LD. Eight competitors × ~30s of browser each is ~240s and
can't be parallelized under the memory budget; plain fetch is ~1–2s each and does
parallelize, so the whole stage is ~15s.

The SSRF guard runs on competitor URLs too, and that's the sharper threat model: the
user typed their own URL and owns the consequence, but competitor URLs come out of a
search result and are fetched by the server.

### Progress is a real stage list, not a spinner

A cold start plus a render plus rule evaluation is 20–60s. A bare spinner for a minute
reads as broken, so the stream carries the actual stages — *resolving URL · launching
browser · rendering desktop · running 30 rules · scoring* — which also makes a stall
visibly a stall. Structured payloads are sent whole as the final line: half an object
renders as nothing.

---

## The agent layer

Claude Opus 5 via the SDK's **Tool Runner** (`client.beta.messages.toolRunner`) — the
loop is driven by the SDK, and this app supplies the tool functions and the per-iteration
hooks that map tool calls onto the progress stream.

The argument for a tool loop is *selective retrieval*, and only that. Dumping a full page
snapshot into one call wastes tokens on noise: a CTA finding needs the button text and
surrounding copy, a headline finding needs the H1 and first paragraph. The model knows
which of those it needs; a deterministic pipeline doesn't.

```ts
const runner = client.beta.messages.toolRunner({
  model: "claude-opus-5",
  max_tokens: 64000,
  thinking: { type: "adaptive" },
  output_config: { effort: "high" },
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",        // a CRO audit of a security vendor is the benign-adjacent
  tools: [...readOnlyTools, submitDraft],   // case that trips safety classifiers
  max_iterations: 12,
  stream: true,
});
```

Six read-only tools (`get_page_overview`, `get_findings`, `get_elements`,
`get_copy_near`, `get_metrics`) plus the terminal `submit_draft`. Tool descriptions are
prescriptive about *when* to call, not just what they return.

**Every failure path ends in a rendered report.** No API key, a refusal, iteration
exhaustion, an unknown `ruleId`, or a blown wall-clock budget all degrade to templated
narrative built from the deterministic findings. The agent is an enhancement, never a
gate.

---

## Project structure

```
app/
  page.tsx                    the whole flow at one URL — a useReducer state machine
  api/
    runs/route.ts             ① Website Analyzer
    runs/[runId]/route.ts        resume a run
    runs/[runId]/competitors/    ② Competitor Finder
    runs/[runId]/strategy/       ③ Content Strategist
  components/
    ui/                       Button · Card · Dropdown · TextField · TextArea
    audit/                    UrlForm · ScanProgress
lib/
  ndjson.ts                   progress streaming + abort handling
  runs.ts                     run store (24h TTL)
  mock/fixtures.ts            one coherent scenario across all three stages
types/                        one type per concern, barrelled through index.ts
```

Types live in `types/` rather than beside their implementation because nearly all of them
cross a boundary — produced on the server, rendered on the client, or serialized in both
directions. One home means one definition of the wire format. Anything used inside a
single file stays in that file.

---

## Getting started

```bash
npm install
npm run dev          # → http://localhost:3000
npm test             # vitest
npm run lint
npm run build
```

The app runs end to end today against the fixtures — enter a URL, watch the real progress
stream, get a stage-1 result. No API key is needed until the agents are real.

> **Note:** this is Next.js 16, which has breaking changes from earlier versions
> (see `AGENTS.md`). The test setup uses jsdom 30, which requires Node ^22.22 or ^24.15+.

---

## How this was built

The repo is spec-first, and the specs are checked in. Design documents came before code,
open questions were logged rather than silently resolved, and each unbuilt stage has a
**Claude Code skill** in `.claude/skills/` that encodes how to build it — which documents
are authoritative, which neighbouring file to match, and which constraints are
non-negotiable.

| Document | What's in it |
|---|---|
| [`AGENTIC-WORKFLOW.md`](./AGENTIC-WORKFLOW.md) | The three-stage flow and what each stage owes |
| [`AUDIT-DESIGN.md`](./AUDIT-DESIGN.md) | The CRO audit inside stage 1 — decisions, rule set, scoring, SSRF, delivery phases |
| [`AGENTIC-REPORT.md`](./AGENTIC-REPORT.md) | The agent: tool surface, injection defenses, request config, failure modes |
| [`SCREEN-HOME.md`](./SCREEN-HOME.md) | The home screen down to component boundaries |
| [`CONCERNS.md`](./CONCERNS.md) | Open issues across all three, ordered by when they bite |

`CONCERNS.md` is the one worth reading if you only read one — it's the record of the
design critiquing itself, including the two collisions between documents that had to be
resolved before any of this could be built.

---

## Roadmap

- [ ] **Stage 1 real** — Playwright collector (local Chromium in dev, `@sparticuz/chromium` on Vercel), the ~30-rule registry, scoring
- [ ] **Stage 2 real** — market search, parallel HTTP fetch behind the SSRF guard, claimed/observed extraction
- [ ] **Stage 3 real** — the grounded strategy agent and final report assembly
- [ ] **Checkpoint + report screens** — editable profile, competitor confirmation, score dial, prioritized findings
- [ ] **Durable run store** — KV keyed by `runId` + Blob for screenshots, 24h TTL
- [ ] **Injection red-teaming** — a fixture corpus of pages carrying payloads in body copy, alt text, hidden divs, and meta tags, asserting the score is unchanged and no invented finding survives
