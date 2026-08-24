# CRO Audit App — Implementation Plan

A web app that takes a target URL, renders it in a real browser, runs deterministic
CRO heuristics against the rendered page, and returns a scored, prioritized report.

**Stack:** Next.js 16.2 (App Router) · React 19.2 · TypeScript · Tailwind v4 · Vitest
**Target deploy:** Vercel (Node runtime, Fluid Compute)

---

## 1. Decisions

These were settled up front. Each is recorded with its rationale so we can revisit
deliberately rather than by accident.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Real browser rendering** via `playwright-core` + `@sparticuz/chromium`, behind a swappable `Collector` interface | CRO's core signals — above-the-fold CTAs, viewport layout, mobile vs. desktop — are *rendering* questions. Raw HTML parsing cannot answer them. The interface keeps a remote-browser swap cheap. |
| D2 | **Deterministic rules + LLM narrative layer** | Scores must be reproducible and unit-testable; a re-run of an unchanged page must produce an identical score. The LLM writes the prose ("why this matters, how to fix"), never the score. |
| D3 | **No database in v1.** Audit runs synchronously and streams progress | Vercel now allows 300s on every plan; an audit takes ~20–60s. A job queue + store is real complexity that buys nothing until we want history and shareable links (Phase 8). |
| D4 | **Four pillars in v1**, with uneven depth | Conversion + Content are the product's reason to exist and get deep rule coverage. Technical/Trust is broad but shallow. Performance uses CDP metrics, not a full Lighthouse run. |

### Assumptions I made without asking

Flag any of these and I'll revise — this document is cheap to change, code isn't.

- Single-page audit, not a site crawl. v1 audits exactly the URL given.
- Anonymous usage. No auth, no accounts, no per-user rate limits beyond IP.
- Desktop **and** mobile viewport captured per audit (needed for responsive rules).
- English-language pages only for the content/messaging rules.

---

## 2. Why Playwright works on Vercel (verified)

Confirmed against `node_modules/next/dist/docs/` and Vercel's current docs:

- `playwright`, `playwright-core`, `@sparticuz/chromium` are **already in Next 16's
  built-in `serverExternalPackages` list**. No `next.config.ts` change needed — the
  "mark it external or path resolution breaks" advice in most blog posts is handled.
- Route handlers default to `runtime = 'nodejs'`. Do **not** set `'edge'`.
- Bundle budget: 250 MB uncompressed. `playwright-core` (~5 MB) + sparticuz Chromium
  (~40–50 MB Brotli) fits comfortably. Full `playwright` (~280 MB/browser) does not.
- Duration: 300s default on all plans. We set `maxDuration = 120` explicitly.
- Memory: Hobby 2 GB / 1 vCPU, Pro 4 GB / 2 vCPU. Chromium wants ~1 GB — one page at
  a time per invocation, always.
- Response body cap is **4.5 MB**, so screenshots never travel inline in a JSON
  response. Stream them, or (Phase 8) put them in Blob storage.

**Known risks:** ~2–5s cold-start cost to decompress the Brotli binary, and there are
[reports of Fluid Compute breaking Playwright](https://community.vercel.com/t/enabling-fluid-compute-broke-playwright-scraping/8840).
Phase 7 deploys a trivial screenshot endpoint to production *early* to de-risk both,
rather than discovering them at launch.

---

## 3. Architecture

```
app/
  page.tsx                     the entire flow — one URL, three screens (§4)
  api/audit/route.ts           POST → NDJSON progress → findings + questions
  api/audit/report/route.ts    POST → NDJSON → final narrated report
  components/
    ui/                        existing primitives (Button, TextField, Dropdown, Card, …)
    audit/
      UrlForm.tsx              home screen
      ScanProgress.tsx         streamed progress, used by both loading states
      QuestionForm.tsx         clarifying questions
      ReportView.tsx           ScoreDial, PillarCard, FindingList, ScreenshotPane
lib/
  collector/
    types.ts                   Snapshot, Collector
    playwright.ts              local Chromium (dev) + sparticuz (prod)
    remote.ts                  Phase 9: connectOverCDP
  rules/
    types.ts                   Rule, Finding, Severity
    registry.ts                all rules, one array
    conversion/*.ts
    content/*.ts
    technical/*.ts
    performance/*.ts
  scoring.ts                   Finding[] → pillar scores → overall
  questions.ts                 Finding[] → clarifying questions (§4)
  narrative.ts                 Claude summary over findings + answers
  safety.ts                    SSRF guard, URL normalization
  report.ts                    assemble final Report
```

### The central contract: `Snapshot`

Everything hinges on this. Rules never touch a browser — they are pure functions over
a `Snapshot`, which makes the entire rule layer unit-testable against fixtures with no
Chromium in the test run.

```ts
type Snapshot = {
  url: string;
  finalUrl: string;          // after redirects
  status: number;
  fetchedAt: string;
  viewport: "desktop" | "mobile";

  html: string;
  title: string | null;
  metaDescription: string | null;
  lang: string | null;
  canonical: string | null;

  headings: { level: number; text: string; aboveFold: boolean }[];
  ctas: {
    text: string; tag: string; href: string | null;
    rect: { x: number; y: number; w: number; h: number };
    aboveFold: boolean; visible: boolean; contrastRatio: number | null;
  }[];
  forms: {
    action: string | null; method: string;
    fields: { name: string; type: string; required: boolean; label: string | null }[];
  }[];
  images: {
    src: string; alt: string | null; natural: { w: number; h: number };
    rendered: { w: number; h: number }; bytes: number | null;
    format: string; loading: string | null;
  }[];
  links: { href: string; text: string; external: boolean }[];
  text: string;              // visible innerText, for readability rules

  metrics: {
    lcp: number | null; cls: number | null; ttfb: number;
    domContentLoaded: number; transferBytes: number; requestCount: number;
  };
  screenshots: { aboveFold: Buffer; full: Buffer };
  consoleErrors: { level: string; text: string }[];
};

interface Collector {
  collect(url: string, viewport: "desktop" | "mobile"): Promise<Snapshot>;
  dispose(): Promise<void>;
}
```

### Rules

```ts
type Severity = "critical" | "high" | "medium" | "low" | "info";
type Pillar = "conversion" | "content" | "technical" | "performance";

type Finding = {
  ruleId: string;
  pillar: Pillar;
  severity: Severity;
  title: string;
  evidence: string;          // what we actually observed, with numbers
  recommendation: string;
  impact: 1 | 2 | 3;         // for the impact/effort priority matrix
  effort: 1 | 2 | 3;
  selector?: string;         // for highlighting on the screenshot
};

type Rule = {
  id: string;
  pillar: Pillar;
  weight: number;
  // Receives both viewports so responsive rules can compare them.
  run(snapshots: { desktop: Snapshot; mobile: Snapshot }): Finding[];
};
```

A rule returning `[]` means "passed". Every rule ships with a fixture test.

---

## 4. Screens

Three screens, **one URL**. `app/page.tsx` owns the whole flow as a client-side state
machine — no route segments, no `router.push`, no `/report` path. The address bar never
changes from `/`.

```
idle ──submit──▶ scanning ──▶ questioning ──answers──▶ finalizing ──▶ result
                    │              │                        │            │
                    └──────────────┴────── error ◀──────────┘            │
                                             │                           │
                                             └───── start over ◀─────────┘
```

| Screen | State(s) | What the user sees | Primitives |
|---|---|---|---|
| **Home** | `idle`, `scanning` | URL field + Submit, replaced in place by streamed progress | `TextField`, `Button` |
| **Questions** | `questioning` | 3–5 clarifying questions from the backend, with Skip | `Dropdown`, `TextArea`, `Button` |
| **Result** | `finalizing`, `result` | Narrative generation progress, then the scored report | `Card`, audit components |

### State shape

One discriminated union, one `useReducer` in `page.tsx`. Every screen is a function of
`state.step`, so an impossible combination (questions showing while a scan runs) can't
be represented.

```ts
type AuditState =
  | { step: "idle" }
  | { step: "scanning"; url: string; progress: ProgressEvent[] }
  | { step: "questioning"; url: string; draft: AuditDraft; questions: Question[] }
  | { step: "finalizing"; url: string; draft: AuditDraft; progress: ProgressEvent[] }
  | { step: "result"; report: Report }
  | { step: "error"; message: string; retryable: boolean };

/** Everything the first pass produced, minus the narrative. */
type AuditDraft = {
  url: string;
  findings: Finding[];
  scores: { overall: number; pillars: Record<Pillar, number> };
};

type Question = {
  id: string;
  prompt: string;
  kind: "single" | "multi" | "text";
  options?: { label: string; value: string }[];
  /** Why we're asking — rendered as hint text under the control. */
  rationale?: string;
};

type Answer = { questionId: string; value: string | string[] };
```

### Screen 1 — Home

URL input and submit. On submit the form is replaced in place by progress; the URL bar
does not move.

**The loader shows real steps, not a spinner.** We already stream NDJSON progress
(Phase 4), and §2 puts cold start at 2–5s on top of a 20–60s audit. A bare spinner for
a minute reads as broken. Render the actual stages as they arrive — *resolving URL ·
launching browser · rendering desktop · rendering mobile · running 30 rules · scoring* —
so the wait is legible and a stall is visibly a stall.

Submit is disabled while scanning, and the in-flight request is abortable so "start over"
doesn't leak a browser on the server.

### Screen 2 — Questions

After the rules run, the backend returns clarifying questions alongside the draft
findings. `lib/questions.ts` derives them from what the rules actually found, so they're
specific rather than generic — a page with three competing CTAs gets asked which action
matters most; a page with no pricing gets asked whether pricing is deliberate.

Two constraints worth stating plainly:

- **Answers never touch the score.** D2 promises a re-run of an unchanged page produces
  an identical score. Answers feed the *narrative*, the ordering of findings, and which
  recommendations get emphasized — never `scoring.ts`. If answers moved the number, the
  score would stop being reproducible and D2 would be dead.
- **The screen is skippable.** Questions are an enhancement, not a gate. Skip goes
  straight to `finalizing` with an empty answer set and produces the generic report.

Cap at five questions. This is a tool someone tries on a whim; a long form before any
value is shown is where they leave.

### Screen 3 — Result

Narrative generation streams into the same progress component, then the report renders:
score dial, pillar breakdown, prioritized findings, screenshot pane. "Start over" resets
to `idle`.

### What one URL costs us

These are real trade-offs, not oversights:

| Cost | Detail | Mitigation |
|---|---|---|
| **No deep links** | Nothing is shareable or bookmarkable; a refresh loses the audit | Accepted in v1 — D3 has no persistence to link *to*. Phase 8's `/report/[id]` is where sharing arrives |
| **Back button leaves the app** | Browser back exits rather than stepping back a screen | If unacceptable: `history.pushState` per step with a `popstate` handler. Same path, history entries only — cheap, and doesn't break the single-URL rule |
| **State is memory-only** | Closed tab or crash loses an in-flight scan | Accepted in v1 |

### API implication

The questions step splits the single endpoint in two. A serverless function cannot hold
a response stream open waiting on human input — that burns compute against the 300s cap
for as long as the user is reading.

| Call | Request | Response |
|---|---|---|
| `POST /api/audit` | `{ url }` | NDJSON progress → `{ draft, questions }` |
| `POST /api/audit/report` | `{ draft, answers }` | NDJSON progress → `Report` |

Because D3 rules out a database, **the draft round-trips through the client.** Thirty
findings of compact JSON is a few KB, so this is fine — but screenshots are not: they
blow the 4.5 MB response cap (§2). They stay client-side as object URLs from the first
response and are never posted back. Phase 8's Blob storage removes the round-trip
entirely. This is the one part of the screen design that amends an existing decision,
so it is logged as an open question (§9.4) rather than quietly changing D3.

---

## 5. v1 rule set

Roughly 30 rules. Not exhaustive — the registry is designed so adding a rule is one
file plus one test, no wiring elsewhere.

**Conversion (weight 40%)**
- No CTA above the fold · CTA count (zero / too many competing) · CTA contrast below
  3:1 · vague CTA copy ("Submit", "Click here") · form field count > 5 · required
  fields that needn't be · multiple competing primary actions · no visible phone/contact
  path · trust signals absent (testimonials, logos, guarantees, review counts)

**Content & messaging (weight 25%)**
- Missing or unclear H1 · H1 doesn't state a value proposition · heading hierarchy
  skips levels · reading grade > 12 · feature-heavy vs. benefit-heavy language ratio ·
  no social proof text · wall-of-text blocks with no scannable structure

**Technical & trust (weight 20%)**
- Not HTTPS · mobile viewport meta missing · horizontal scroll on mobile · tap targets
  under 44px · images missing alt · form inputs missing labels · no privacy/terms link ·
  broken internal links · console errors on load

**Performance (weight 15%)**
- LCP > 2.5s · CLS > 0.1 · page weight > 2 MB · unoptimized images (natural dimensions
  far exceeding rendered) · request count > 100 · render-blocking resources

### Scoring

Per pillar: start at 100, subtract `severity_penalty × rule.weight` for each finding,
floor at 0. Overall = weighted mean of pillar scores. Penalties live in one table in
`scoring.ts` so the curve is tunable in a single place. Pure function, fully unit-tested.

---

## 6. Delivery phases

Each phase ends in something runnable. No phase depends on a later one.

| Phase | Deliverable | Done when |
|---|---|---|
| **0 — Foundations** | `lib/` skeleton, all types, HTML fixtures, `safety.ts` SSRF guard | `npm test` green; SSRF guard rejects the full hostile-URL corpus |
| **1 — Collector** | `PlaywrightCollector`, local Chromium in dev | CLI script prints a real `Snapshot` for a live URL |
| **2 — Rule engine** | `registry.ts` + ~30 rules, all fixture-tested | Every rule has a passing and a failing fixture |
| **3 — Scoring** | `scoring.ts`, `report.ts` | Golden-file test: fixture site → stable `Report` |
| **4 — API** | `POST /api/audit` + `POST /api/audit/report`, NDJSON progress on both; `lib/questions.ts` | `curl` streams progress, returns questions, then accepts answers and streams a report |
| **5 — UI** | The three screens of §4 behind one URL: state machine, URL form, streamed progress, question form, report view | Full flow works locally end to end, including Skip |
| **6 — Narrative** | `narrative.ts` via Claude API; degrades to templated text | Report reads well with the key absent |
| **7 — Vercel hardening** | sparticuz path, `maxDuration`, concurrency guard, deploy | Audit of a real site completes in production |
| **8 — Persistence** *(post-v1)* | Postgres + Blob, history, shareable `/report/[id]` | — |
| **9 — Remote browser** *(post-v1)* | `RemoteCollector` via `connectOverCDP` | — |

**Phase 7 gets pulled forward as a spike.** Before Phase 2, deploy a throwaway route
that launches sparticuz Chromium and screenshots `example.com`. If that fails on Vercel,
D1 is wrong and we need to know before writing 30 rules on top of it.

---

## 7. Security & correctness risks

**SSRF is the serious one.** We fetch a user-supplied URL server-side, which is a
textbook SSRF primitive. `lib/safety.ts` must, before *and again after* every redirect:

- allow `http:`/`https:` only — no `file:`, `gopher:`, `data:`
- resolve DNS and reject private/reserved ranges: `127.0.0.0/8`, `10/8`, `172.16/12`,
  `192.168/16`, `169.254/16` (cloud metadata), `::1`, `fc00::/7`
- reject non-standard ports
- cap redirect depth

Redirect re-validation matters: a public hostname can 302 to `169.254.169.254`.
Playwright must run with a request interceptor enforcing this per-navigation, not just
on the initial URL.

**Other risks**

| Risk | Mitigation |
|---|---|
| Bot blocking (Cloudflare etc.) | Realistic UA + viewport; detect challenge pages and report "could not audit" honestly rather than scoring a CAPTCHA page |
| Concurrency exhausting memory | Module-level semaphore, one browser per invocation, `dispose()` in `finally` |
| Cold start ~2–5s | Accept in v1; surface as a progress step |
| Non-deterministic pages (A/B tests, carousels) | Fixed viewport, disable animations, settle timeout before capture |
| LLM cost/latency | Narrative is one call over compact findings JSON, not raw HTML; feature-flagged |
| Screenshot vs. 4.5 MB cap | JPEG q75, downscaled; streamed, never in a JSON body |

---

## 8. Testing

Vitest + Testing Library are already configured.

- **Rules** — pure functions over fixture `Snapshot`s. Fast, no browser. This is the
  bulk of the suite and the reason rules never touch Playwright directly.
- **Scoring** — golden-file tests pinning the score curve.
- **Collector** — integration tests behind `RUN_BROWSER_TESTS=1`, skipped by default so
  CI stays fast and offline.
- **Safety** — a hostile-URL corpus (metadata IPs, redirect chains, exotic schemes).
- **UI** — component tests per the existing `app/components/ui/` house style; the
  `ui-component` skill covers new primitives.

---

## 9. Open questions

1. **Rate limiting** — anonymous audits are abusable as a scanning proxy. IP throttle in
   v1, or defer to Phase 8 with accounts?
2. **`robots.txt`** — honor it? Auditing a competitor's site is a legitimate CRO use
   case, but ignoring robots is a defensible-conduct question worth an explicit call.
3. **Score calibration** — the penalty weights in §5 are an informed first guess. They
   need tuning against 10–20 real sites with known conversion performance before the
   number means anything.
4. **Draft round-trip vs. a store** — the two-call API in §4 posts the draft findings
   back from the client because D3 has no database. That works, but it means the server
   trusts client-supplied findings when generating the narrative. Options: sign the
   draft (HMAC) so tampering is detectable, accept it as harmless in an anonymous
   single-user tool, or pull Phase 8 persistence forward. **Needs a call before Phase 4.**
5. **Where questions come from** — `lib/questions.ts` derives them from findings
   deterministically in this plan. The alternative is an LLM generating them per-audit:
   better questions, but a second model call before the user sees anything, and
   non-deterministic tests. Deterministic first, revisit after real usage.

---

## 10. Immediate next steps

1. Phase 7 spike — prove sparticuz Chromium runs on Vercel (**do this first**).
2. Phase 0 — types, fixtures, SSRF guard.
3. Phase 1 — `PlaywrightCollector` against local Chromium.
