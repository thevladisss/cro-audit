# Collector

One function: `collect(url) → Snapshot`. It renders a page in headless Chromium, reads
the DOM after scripts have run, and returns the shape in
[`app/types/Snapshot.type.ts`](../../types/Snapshot.type.ts) — the contract the rule
registry (`app/lib/rules`) and the second-opinion analyzer (`app/lib/analyze`) consume.

```ts
import { collect, CollectorError, CollectorErrorReason } from "@/app/lib/collector";

const snapshot = await collect("https://example.com/", { signal: request.signal });
```

That is the whole public surface: `collect`, its `CollectOptions`, and the error type.

---

## Why a browser

A fetch and a parse produce the same `Snapshot` shape for a fraction of the cost. They
also see source HTML. A large share of the small-business sites this audits render their
CTA, their form, or their entire body from script, and against those the deterministic
rules fire on the *renderer* rather than the page — every finding technically correct and
completely wrong.

Two things follow from rendering, and they are the ones worth protecting in a refactor:

- **`text` is `body.innerText`**, not `textContent`. It is layout-aware, so `<script>`
  bodies and `display:none` blocks are absent rather than stripped after the fact. A page
  whose only price sits in a JSON blob passes `conversion.no-pricing` under `textContent`.
- **A CTA can be recognised by how it is painted**, not only by what it is called. See
  below.

---

## Files

```
browser.ts     which Chromium, and nothing else
extract.ts     the in-page DOM walk — runs inside page.evaluate, returns raw records
normalize.ts   raw records → Snapshot members; pure Node functions
collector.ts   collect(): orchestration, budget, cancellation
errors.ts      CollectorError + the net::ERR_* → reason mapping
utils.ts       sleep — the settle race's other half
index.ts       barrel
```

Each layer, and what it owns:

| File | What it owns |
|---|---|
| `browser.ts` | Acquires a Chromium and nothing else — `@sparticuz/chromium` when `VERCEL` or `AWS_LAMBDA_FUNCTION_NAME` is set, Playwright's own install otherwise — plus the desktop user agent, which exists only to correct Playwright's default "HeadlessChrome" token. Hands the browser back and never closes one; that is the caller's job. |
| `extract.ts` | The only code that runs inside the page. Walks the DOM once and returns plain `Raw*` records: headings, CTA candidates with their rendered box, forms with resolved labels, images, links, and `innerText`. Gathers facts and judges nothing, because nothing here can be tested without a browser. |
| `normalize.ts` | Takes those raw records plus the `SnapshotMeta` only the caller knows — requested URL, final URL, status, fetch time, HTML — and assembles the `Snapshot`. Pure Node functions: whitespace collapsing, `alt` empty-vs-absent, dimension parsing that refuses percentages, `external` link classification, and `isCta`, the one real judgement, which [What counts as a CTA](#what-counts-as-a-cta) argues out in full. |
| `collector.ts` | The public `collect()`. Owns one browser per call and closes it unconditionally, applies the viewport and the resource blocklist, navigates on `domcontentloaded`, races `networkidle` against a fixed settle, and races the whole render against the total budget and the caller's `AbortSignal`. See [Lifecycle, budget, cancellation](#lifecycle-budget-cancellation). |
| `errors.ts` | `CollectorError` and its five reasons (`dns`, `timeout`, `blocked`, `browser`, `aborted`), plus `toCollectorError`, which maps Chromium's `net::ERR_*` strings onto them and defaults anything unrecognised to `blocked`. |
| `utils.ts` | `sleep`, the settle race's other half. |
| `index.ts` | The barrel, and the whole public surface: `collect`, `CollectOptions`, `CollectorError`, `CollectorErrorReason`. |

`errors.ts` is its own file rather than living in `collector.ts` because `browser.ts`
throws a `CollectorError` too, and would otherwise import the module that imports it.

### The extract/normalize split is the load-bearing decision

Code passed to `page.evaluate` is serialized and runs in the page: it cannot import,
cannot close over module state, and cannot be unit-tested without a browser. So the
in-page half does only what *requires* a DOM, and returns plain structured-clonable
records:

- absolute `href`/`src` — the DOM's own `.href`/`.src` properties resolve against the base
  URL for free; never hand-roll `new URL(attr, base)`,
- label resolution (`element.labels`, then `aria-label`, `aria-labelledby`, `placeholder`),
- `innerText`, heading levels, and attribute presence-vs-emptiness (`alt=""` and a missing
  `alt` are different answers, preserved as `string | null`),
- the rendered box of every CTA candidate, which is the one signal no parser has.

Everything judgemental happens in `normalize.ts`, in Node, as pure functions: whitespace
collapsing, empty-text dropping, `external` classification, CTA filtering, `width`/`height`
parsing. Those are the parts that will be wrong and need iterating, and they are the parts
a test reaches in milliseconds.

`extract.ts` ships its helpers to the page by concatenating their source
(`IN_PAGE_FUNCTIONS` → `inPageScript()`). Adding a helper without adding it to that array
is a `ReferenceError` at runtime, not a type error — `extract.test.ts` evaluates the real
concatenated string for exactly this reason.

---

## What counts as a CTA

`conversion.no-cta` is the registry's only `critical` rule, so this heuristic decides
whether the audit's heaviest finding can fire at all. Both kinds of error were observed on
real pages before it took its current shape:

| approach | what it did |
|---|---|
| count every `<button>` | `www.gov.uk` → 8 CTAs: a cookie banner, a menu toggle, two search submits, feedback buttons. The critical rule becomes unfireable on any modern site. |
| require a `btn\|button\|cta` class | `vercel.com` → 2, both nav dropdowns. Utility-class CSS is the norm now; "Deploy now" carries no such class. |

So the test is what a visitor sees. A candidate is a CTA when it is laid out, has visible
text, is **not** a disclosure (`aria-expanded`/`aria-haspopup`), **not** inside a
cookie/consent container, **not** inside a search form or ARIA search landmark, and is
either a real control (`<button>`, `<input type=submit|button>`, `<a role=button>`) or an
anchor that is *painted* as one: not `display:inline`, filled or outlined, 28–80px tall
and 48px to half the viewport wide.

The box is measured rather than the padding because a modern design system gives a button
its height with flex centring and no vertical padding at all. The size window is what
keeps painted cards, nav bars, and hero panels out — they are anchors with backgrounds
too, and the wrong shape.

Measured after: `gov.uk` 3 (feedback buttons — the page genuinely sells nothing),
`vercel.com` 5, `pizzaexpress.com` *Book a table · Order online · Get this offer*.

What it still misses is a `<div onclick>` with no button styling. That costs a finding the
model's second opinion tends to raise as a `divergence`, which is what that comparison is
for.

---

## Lifecycle, budget, cancellation

```
launch ─▶ newContext ─▶ route(**/*) ─▶ goto(domcontentloaded) ─▶ settle ─▶ content + evaluate ─▶ toSnapshot
                                                                                                    │
                                          finally: browser.close()  ◀───────────────────────────────┘
```

| step | cap | option |
|---|---|---|
| navigation | 20s | `navigationTimeoutMs` |
| post-load settle | 2.5s | `settleTimeoutMs` |
| everything | 30s | `totalBudgetMs` |

**One browser per collect, closed unconditionally.** On serverless that is mandatory: a
leaked browser survives into the next invocation on a warm instance and takes several
hundred MB of the memory budget with it. A dev-only cached browser was measured and
rejected — launch is 282ms cold and 80–120ms warm against a 1.5–3.5s collect, which is not
enough to buy a second code path that goes stale across an HMR reload and leaves
production as the only place teardown ever runs. Closing the browser disposes its
contexts, so there is one teardown line.

**The settle is a race**, `waitForLoadState("networkidle")` against a fixed `sleep`, and
the race is the contract: at most `settleTimeoutMs` of extra waiting however busy the page
is. `networkidle` never resolves on a page with an analytics heartbeat or an open socket,
which is most commercial sites. `domcontentloaded` rather than `load` for the same reason:
one slow third-party script must not decide whether the audit happens.

**The budget and the abort signal reject on their own**, raced against the work, rather
than tearing the context down. Closing a context resolves promptly and every Playwright
call already in flight on it then *never settles* — neither resolved nor rejected. An
independent timer is what makes the cap real; the close is only how memory is reclaimed.

**`signal` is checked twice.** Once before `launch`, so a caller who has already gone away
does not cost a browser start, and once after, because `addEventListener` on a signal that
already fired never calls back and `launch` sits between the two.

**Images, media and fonts are aborted** at the route handler. Image metadata comes from
DOM attributes, so no `Snapshot` field depends on the bytes arriving, and on an
image-heavy page this is the difference between a six-second render and a twenty-second
one. Stylesheets and scripts must load — layout-aware text and the painted-button test
both depend on them.

---

## Errors

Transport failures throw; HTTP failures do not. A 404 or a 503 is a `Snapshot` carrying
that `status` — whether to score a bot-blocked page is the route's call, and `status` is
how it decides.

`CollectorError` carries a `reason` so the route maps it onto a status code without
string-matching a message:

| reason | cause | route's answer |
|---|---|---|
| `dns` | host does not resolve | 400 — the user typed it wrong |
| `timeout` | navigation, or the total budget, expired | 504 |
| `blocked` | refused, reset, or the site turned us away | 502 |
| `browser` | Chromium would not start — missing binary, OOM | 500 — ours, not theirs |
| `aborted` | the caller went away | — |

Anything unrecognised becomes `blocked`. That is the honest default: we reached the
network, something refused, and guessing at a more specific cause puts a wrong explanation
in front of the user. The `net::ERR_*` code in Chromium's message is the only structured
thing Playwright passes through, so `errors.ts` matches on it — unlovely, but those codes
are Chromium's public error surface rather than Playwright's prose.

---

## Environments

| | serverless (`VERCEL` / `AWS_LAMBDA_FUNCTION_NAME`) | local |
|---|---|---|
| binary | `@sparticuz/chromium`, imported lazily | Playwright's own install, or `CHROMIUM_PATH` |
| flags | `chromium.args` (`--single-process` is not decoration — without it a Lambda runs out of shared memory partway through a page) | none |

`@sparticuz/chromium` is a ~50MB Linux binary; on macOS its `executablePath()` returns a
path that does not run. Hence `CHROMIUM_PATH` and `npx playwright install chromium` for
local work. `playwright-core` is the production import; the full `playwright` package is a
dev dependency and exists only for that installer.

**The version pins are load-bearing.** `playwright-core@1.61.0` bundles Chromium
149.0.7827.55 and `@sparticuz/chromium@149.0.0` ships the same major, so both are pinned
exactly rather than caret-ranged. Playwright speaks CDP to whatever binary it is handed
but is only *tested* against its own, so a routine `npm update` that moved one and not the
other would not fail loudly — it would hang a call and surface as a timeout on a page that
is fine. Move the two together or not at all.

The user agent is derived from `browser.version()` at launch rather than pasted in: a
Linux container claiming macOS, or a Chromium 150 claiming 149, is a mismatch a
fingerprinter reads. Playwright's default UA says `HeadlessChrome`, which a fair number of
sites reject outright; this is that string with the one token corrected, and it is the
whole of the anti-blocking effort. A site that blocks datacentre IPs blocks this too, and
the honest outcome is a `blocked` error the user can read.

---

## Tests

Unit only. No test in this module starts a browser or opens a socket, so `npm test` is
the whole suite and it runs anywhere.

```bash
npm test
```

| file | what it owns |
|---|---|
| `normalize.test.ts` | the judgements: CTA accept/reject, `external`, `alt` null-vs-empty, dimension parsing |
| `extract.test.ts` | the DOM walk, over jsdom — what is collected, with which attributes, in what order |
| `browser.test.ts` | binary and flag selection, with `playwright-core` stubbed |
| `errors.test.ts` | the `net::ERR_*` → reason mapping, against real Chromium and Node strings |
| `collector.test.ts` | orchestration, with Playwright stubbed: teardown on every path, the budget, cancellation, error wrapping |

Timing is the case where stubbing is strictly better: a budget test against a real
Chromium is a race with the machine it runs on, so `collector.test.ts` stubs a call that
never settles and gets a deterministic answer in milliseconds.

### What no test covers

The suite verifies every decision this module makes and none of the assumptions it makes
about Chromium. Specifically:

- **Nothing renders.** `extract.ts` is exercised over jsdom, which has no layout: it shims
  `innerText` to `textContent` and `getClientRects` to a `data-hidden` attribute, and
  `getBoundingClientRect` is all zeros whatever you do. So `isVisible` and `isButtonLike`
  — the painted-button test that the CTA heuristic rests on, and the strongest argument
  for running a browser at all — are never run against a real box. `looksLikeButton` is
  tested directly, but only as a pure function over a hand-written `RenderedBox`.
- **Nothing navigates.** `collector.test.ts`'s stubs are a model of Playwright, so they
  agree with it right up until Playwright changes. A `goto` that starts returning a
  different shape, an option renamed, a binary that no longer launches, `page.evaluate`
  rejecting the concatenated script — each of those passes here and fails in production.
- **The version pins are unverified.** Nothing checks that the `playwright-core` build and
  the `@sparticuz/chromium` major still match; the pins are the only thing holding that
  together.

Do not close these gaps by asserting them in `extract.test.ts` — under those shims such a
test passes for the wrong reason, which is worse than the gap. Closing them means a
browser-backed suite, which this module deliberately does not have. Until then, `collect`
against a real URL is a manual step before a deploy.

---

## Not collected, and why

`aboveFold`, element rectangles, WCAG contrast, rendered-vs-natural image size, Core Web
Vitals. A browser makes all of them reachable; no rule reads them yet, and a contract
grows a field when something consumes it, not before. They land with the rules that need
them.

One desktop viewport (1280×800), not the two the root README describes. A second render
doubles the slowest step in the audit and no rule reads layout yet; the mobile pass lands
with the above-the-fold rules that would need it.

Screenshots — nothing downstream renders them. Multi-page crawling: `SiteProfile.pages` is
derivable from the same-origin entries in `snapshot.links`, which is route assembly, not
collection.

**The SSRF guard is the route's job, and it does not exist yet.** A browser handed
`http://169.254.169.254/` fetches cloud credentials as happily as it fetches a dentist's
homepage. `collect` takes a URL and renders it; it is the wrong layer to know that, and
the guard lands before either route ships.

### Known gap

`collectImages` reads `currentSrc` for `<picture>`/`srcset` images, but source selection
is a side effect of the load — which the aborted image requests prevent. So such an image
currently lands as `src: ""`, which `Snapshot.type.ts` defines as "the attribute is
absent": the two cases are indistinguishable. Harmless while no rule reads `src`. The fix,
when one does, is to parse the `srcset` attribute rather than ask the browser which source
it picked, because it will not have picked one.

---

## Gaps in `collect()`

Everything above describes what the collector does. This is what it does not: the gaps in
the orchestration, as opposed to the extraction gap under [Known gap](#known-gap). None is
load-bearing today — they are written down because each one fails quietly rather than
loudly.

| gap | what happens | when it bites |
|---|---|---|
| **An explicit `undefined` option clobbers its default** | `{ ...DEFAULTS, ...options }` copies a key whose value is `undefined`, and `RenderSettings` being `Required<>` hides that from the type checker. `getExpiryPromise(url, undefined)` becomes `setTimeout(fn, undefined)`, which fires on the next tick — so every collect rejects with `timeout` immediately. | A caller forwarding config it did not check: `collect(url, { totalBudgetMs: env.budget })`. The fix is to drop `undefined` values before the spread rather than trust the type. |
| **The three caps are independent and unvalidated** | Nothing asserts `navigationTimeoutMs + settleTimeoutMs ≤ totalBudgetMs`. Raise the navigation cap past the budget and the budget always wins first. | The user sees `timeout` blamed on the total budget with nothing saying the navigation cap it was raised for could never have been reached. |
| **A redirect is never re-checked** | `goto` follows redirects and only `finalUrl` records where it landed. A route-level SSRF guard that validates the URL it was given is defeated by a 302 — and by DNS rebinding, which is the same shape without the redirect. | As soon as the guard above ships. Guarding the input URL is not the same as guarding what Chromium fetched. |
| **`html` is uncapped** | `page.content()` returns the whole serialized DOM, and it goes into the `Snapshot` whole. A heavy commercial page is several MB. | Storing a run, or handing a snapshot to a model. Nothing truncates or measures it at this layer. |
| **Nothing bounds concurrent collects** | One browser per collect is correct for one collect; *N* at once is *N* Chromiums against a fixed memory budget, with no semaphore anywhere. | The multi-page crawl on the roadmap — the first caller that maps `collect` over `snapshot.links` discovers this. |
| **A lost race abandons a promise that never settles** | When the budget or the abort wins, `render` is left running. `work.catch(() => {})` stops the unhandled rejection, but a Playwright call in flight on a closed context never settles either way, so that chain — and the `context` and `page` it closes over — is retained for the life of the process. | A long-lived dev server, where it accumulates. Serverless freezes the process, so it never shows up in production. |
| **A bad certificate leaves no trace** | `ignoreHTTPSErrors: true` is deliberate — an expired cert is still a page worth auditing — but the `Snapshot` has no field saying the cert was bad, so the finding the code comment calls for cannot be written. | Any rule that wants to report it. Recording the fact costs a boolean; recovering it later costs a re-render. |
| **The visitor is always in the UK** | `locale: "en-GB"` is hardcoded, with no timezone or geolocation set. A site that varies copy, currency, or entire sections by region is audited as one visitor, and the `Snapshot` does not record which. | Anything geo-varying. The audit is not wrong, but it silently describes one region's version of the page. |
| **No retry on a transient failure** | One `ECONNRESET` or one refused connection ends the collect. A single retry is cheap against a 30s budget, and `errors.ts` already distinguishes the reasons that would be worth retrying from the ones that would not. | A flaky network or a rate-limiting host, where a re-run would have succeeded and the user is told the site is `blocked`. |

