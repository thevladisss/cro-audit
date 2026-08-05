# Agentic workflow

Takes a URL from the user, scans the website, and determines its topic. From there, three
subagents run in sequence under a main orchestrator, with the user confirming between
stages.

**Status: design document.** Nothing here is built.

This is the product's front door: one URL field, and submitting it starts the workflow.
It does **not** run start to finish unattended. It stops at a checkpoint after stage 1
and again after stage 2, showing the user what was found and waiting for them to confirm
or correct it before the next stage runs.

There is no separate entry point for the single-page CRO audit — that work
(`README.md`, `AGENTIC-REPORT.md`) runs inside stage 1.

The final deliverable is **one report containing both**: the CRO score and findings for
the user's own site, and the competitor-informed content strategy built on top of them.

```
URL ──▶ Website Analyzer ──▶ ✓ ──▶ Competitor Finder ──▶ ✓ ──▶ Content Strategist ──▶ report
                             │                          │
                        checkpoint                 checkpoint
```

---

## 1. Website Analyzer

The main orchestrator takes the website URL from user input and passes it down to a
dedicated subagent.

Website Analyzer is responsible for analyzing the website:

- Determines the niche
- Collects information about main services and location of the business
- Makes screenshots of main pages

The output is written to the run's temporary storage and sent back to the user for
confirmation or changes.

---

## 2. Competitor Finder

Using the niche and location from temporary storage — or directly from the user, per the
confirmation step above — the main orchestrator passes the information to the next
subagent.

Competitor Finder is responsible for finding competitors in the market:

- Uses the niche and location to search for competitors
- Collects information about competitors' websites, services, and locations

For each competitor found, basic data collection:

| Field | Description |
|---|---|
| Website URL | — |
| Name | — |
| Main services offered | — |
| Location of the business | — |
| Unique selling points | Any differentiators |

The information from this step is sent back to the user, and the findings are written to
temporary storage.

---

## 3. Content Strategist

Using the information from the previous steps, the main orchestrator passes the collected
data to the final subagent.

Content Strategist is responsible for creating a content strategy based on the information
collected from these websites:

- Analyzes competitors
- Provides recommendations for initial website updates

It sends the structured output back to the user.
