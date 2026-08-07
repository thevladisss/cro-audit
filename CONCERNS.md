# Concerns

Open issues with the design in `AGENTIC-WORKFLOW.md`, `AGENTIC-REPORT.md`, and `AUDIT-DESIGN.md`,
ordered by when they bite. Nothing here is built yet, so all of it is cheap now.

---

## 1. Two "ask the user" designs collide

AUDIT-DESIGN §4 has a clarifying-questions screen after the audit — 3–5 derived questions,
skippable. `AGENTIC-WORKFLOW.md` has checkpoints after stages 1 and 2. Both interrupt the
user to refine the same run, and stacking all three means **three interruptions before any
output** on a tool someone is trying on a whim.

**Why it blocks:** `AuditState.type.ts` can't be written until this is decided, and Phase 5
builds the state machine on top of it.

**My read:** the checkpoints win and the questions screen folds into the stage-1 checkpoint.
The audit's questions were derived from findings; stage 1 already has to show the user what
it found and ask them to confirm it. Same screen, more useful content.

## 2. Stage outputs have no defined shape

The workflow doc describes each stage's output in prose ("determines the niche, collects
services and location"). Three things break while that's true:

- **The checkpoint UI can't be built.** "Confirm or correct what was found" needs fields.
  `Niche: [dental clinic]` with an edit box is a checkpoint; a paragraph with a Continue
  button is a speed bump.
- **Stage 2 can't be tested.** If its input is prose there's no fixture. If it's
  `{ niche, location }` the test can be written today.
- **Nothing can be validated.** Same reason the audit uses a strict terminal tool.

**What's needed:** `SiteProfile`, `Competitor[]`, `ContentStrategy` in `types/`, defined once
alongside the audit's types, referenced from the doc rather than described in prose.

## 3. Stage 1 probably doesn't fit one invocation

Against AUDIT-DESIGN §2's numbers — 20–60s per rendered page, 2–5s cold start, one Chromium per
invocation — "screenshots of main pages" is unbounded and dangerous:

| | Cost |
|---|---|
| 5 pages × ~30s, desktop only | ~150s |
| Same × 2 viewports (as the audit does today) | ~300s, over the platform cap |

**What's needed:** cap pages (3–5), define how they're discovered (sitemap.xml, nav links, or
a fixed guess list), decide whether secondary pages are desktop-only, and say explicitly
whether stage 1 is one request or a job.

## 4. Competitors must not be rendered in a browser

8 competitors × ~30s sequential ≈ 240s, and it can't be parallelized — AUDIT-DESIGN §7 mandates one
browser per invocation because Chromium wants ~1 GB against Hobby's 2 GB.

Plain HTTP fetch is ~1–2s each **and parallelizes**, so the whole stage is ~15s. The trade is
narrow: you lose JS-rendered content and anything layout-dependent, but every field in the
competitor schema (name, services, location, USP) lives in HTML, meta tags, or JSON-LD. D1's
argument for a real browser was that above-the-fold layout is a *rendering* question — nothing
about a competitor record is.

**Real browser for the user's site, plain fetch for competitors.**

## 5. The tool treats marketing copy as market data

This is a **data quality** problem, not a security one — it fires on completely innocent
websites, on run one, with no adversary involved.

Every competitor homepage says "the region's leading provider," "award-winning," "the only
clinic offering same-day service." Stage 2 files that under "unique selling points." Stage 3
reads it and tells the user *"competitors differentiate on same-day service — consider adding
it"* — when in reality nobody offers it, they just all say it.

Two fixes, both cheap and both worth having for quality alone:

- **Attribution.** "Acme's site claims same-day service" is useful; "competitors offer
  same-day service" is false. Same sentence, one word of provenance.
- **Split claimed vs. observed.** "Has a pricing page" is observed — we fetched it, it's
  there. "Best value in town" is claimed. Different fields, different trust.

*Deliberate injection — a competitor planting text aimed at AI readers — is the same mechanism
with an adversary attached. It's unlikely today for local-business niches and isn't worth
designing around, but the two fixes above cap it for free.*

## 6. `safety.ts` must run on competitor URLs

The one item here that stays a security concern. AUDIT-DESIGN §7 built the SSRF guard for a
**user-supplied** URL — someone types it and owns the consequence. In this workflow the model
picks URLs out of search results and the server fetches them. Same guard, different threat
model, and it's a couple of lines to point it at the new call site: allow http/https only,
resolve DNS and reject private ranges, re-validate after every redirect.

## 7. Sections the workflow doc doesn't have

| Missing | Why it matters |
|---|---|
| **Failure modes, per stage** | Zero competitors, bot-blocked site, search returns nothing, user rejects the niche twice. The audit's rule is "every path ends in a rendered report" — this needs its equivalent or the first weird site produces a blank screen |
| **Budget table** | Same shape as AGENTIC-REPORT §3. Concerns 3 and 4 above are what a budget table would have caught |
| **`robots.txt` posture** | AUDIT-DESIGN §9.2 flags it for the audit. Fetching one competitor because the user asked is defensible; systematically fetching eight *we* selected, every run, is a different conversation |
| **Open questions** | Both sibling docs end with one |

## 8. Competitor data source is unnamed

Web search and a Places/Maps API give materially different answers, and the doc picks neither:

- **Web search** — finds websites well; "location" is whatever the page claims. Free-ish, works
  for any niche.
- **Places/Maps API** — verified name/address/phone, which is the point for a local business.
  Costs per call, and not every listing has a website.

For a local-services niche Places is the better ground truth; for SaaS or national brands
location is close to meaningless and search is the only option. Pick one, or branch on whether
the niche is location-bound — but say which, because field quality differs enormously.

Related: add a `confidence` per competitor. "Unique selling points" scraped from a homepage is
the model *inferring* a differentiator from sales copy — the least reliable field in the set,
and the one most likely to drive a bad recommendation downstream.

## 9. Content Strategist is one sentence of spec

"Provides recommendations for initial website updates" is the entire specification of the thing
the user came for. It needs an output schema, prioritization (effort vs. impact — thirty
undifferentiated suggestions is not a strategy), and a **grounding rule**: every recommendation
cites a specific competitor observation or a specific finding on the user's own site.

Grounding does double duty — it's a better recommendation *and* it's what makes concern 5
visible instead of invisible.

## 10. Smaller items

- **`Report.type.ts` has no merged shape.** The deliverable is now score + strategy in one
  document; the type describes only the scored audit. Probably `Report` gains a `strategy`
  field rather than a new top-level type — decide when writing it.
- **A stage that never calls its terminal tool looks like success.** `stop_reason` is
  `"tool_use"` on the happy path; on iteration exhaustion you get a normal-looking response
  with no tool call. Guard for it explicitly.
- **`stop_reason: "refusal"` needs handling before reading `content`.** Opus 5's classifiers can
  decline; `content` is then empty or partial. This workflow feeds it arbitrary third-party
  sites, so a competitor in a sensitive niche is a realistic trigger.
- **Retention line missing from AUDIT-DESIGN §7.** Flagged in §9.4 already: the run store holds
  scraped third-party content, and a 24h TTL is much easier to defend than an indefinite table.
  Write it when the store gets built.
