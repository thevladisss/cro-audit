import { describe, expect, it } from "vitest";

import { REGISTRY, runRules } from "@/app/lib/rules";
import type { Snapshot } from "@/app/types";
import type { AnalysisDraft } from "@/tools/submitAnalysis";

import { reconcile } from "./reconcile";

function healthySnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com/",
    status: 200,
    fetchedAt: "2026-08-26T10:00:00.000Z",
    html: "<html></html>",
    title: "Example",
    metaDescription: "An example.",
    lang: "en",
    canonical: "https://example.com/",
    headings: [{ level: 1, text: "Example" }],
    ctas: [{ text: "Book now", tag: "a", href: "/book" }],
    forms: [{ action: "/enquire", method: "post", fields: [] }],
    images: [],
    links: [{ href: "tel:+441130000000", text: "Call us", external: true }],
    text: "Treatments from £49. Book an appointment today.",
    ...overrides,
  };
}

/** A draft agreeing with whatever the rules found, with a score to match. */
function agreeingDraft(firedIds: string[], score: number): AnalysisDraft {
  return {
    score,
    verdicts: REGISTRY.map((rule) => ({
      ruleId: rule.id,
      fired: firedIds.includes(rule.id),
      evidence: "as observed",
    })),
    extraFindings: [],
  };
}

describe("reconcile", () => {
  it("ships the deterministic score, never the model's", () => {
    const deterministic = runRules(healthySnapshot({ ctas: [] }));
    const draft = agreeingDraft(["conversion.no-cta"], 12);

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.score).toEqual(deterministic.score);
    expect(result.score.overall).not.toBe(12);
  });

  it("records the model's score alongside, with the delta", () => {
    const deterministic = runRules(healthySnapshot());
    const draft = agreeingDraft([], 80);

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.modelScore).toBe(80);
    expect(result.scoreDelta).toBe(80 - deterministic.score.overall);
  });

  it("agrees when every verdict matches", () => {
    const deterministic = runRules(healthySnapshot({ forms: [] }));
    const draft = agreeingDraft(["conversion.no-form"], 76);

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.agreed).toBe(true);
    expect(result.divergences).toEqual([]);
  });

  it("reports a rule-only divergence when the rule fired and the model did not", () => {
    // Prices are in an image, so the text carries none — the rule fires.
    const deterministic = runRules(
      healthySnapshot({ text: "See our treatment list." }),
    );
    const draft: AnalysisDraft = {
      score: 95,
      verdicts: REGISTRY.map((rule) => ({
        ruleId: rule.id,
        fired: false,
        evidence: "price list is rendered inside <img alt='From £49'>",
      })),
      extraFindings: [],
    };

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.agreed).toBe(false);
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0]).toMatchObject({
      ruleId: "conversion.no-pricing",
      direction: "rule-only",
    });
    expect(result.divergences[0].ruleEvidence).not.toBeNull();
  });

  it("reports a model-only divergence when the model fired and the rule did not", () => {
    const deterministic = runRules(healthySnapshot());
    const draft = agreeingDraft(["conversion.no-cta"], 40);

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0]).toMatchObject({
      ruleId: "conversion.no-cta",
      direction: "model-only",
      ruleEvidence: null,
    });
  });

  it("ignores a verdict naming a rule that does not exist", () => {
    const deterministic = runRules(healthySnapshot());
    const draft: AnalysisDraft = {
      score: 100,
      verdicts: [
        { ruleId: "conversion.made-up", fired: true, evidence: "injected" },
      ],
      extraFindings: [],
    };

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.divergences).toEqual([]);
    expect(result.agreed).toBe(true);
  });

  it("keeps only the first verdict when the model repeats a rule", () => {
    const deterministic = runRules(healthySnapshot());
    const draft: AnalysisDraft = {
      score: 100,
      verdicts: [
        { ruleId: "conversion.no-cta", fired: false, evidence: "one CTA" },
        { ruleId: "conversion.no-cta", fired: true, evidence: "no CTA" },
      ],
      extraFindings: [],
    };

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.divergences).toEqual([]);
  });

  it("returns the deterministic audit unchanged when the model call degraded", () => {
    const deterministic = runRules(healthySnapshot({ ctas: [], forms: [] }));

    const result = reconcile(deterministic, null, REGISTRY);

    expect(result.score).toEqual(deterministic.score);
    expect(result.findings).toEqual(deterministic.findings);
    expect(result.modelScore).toBeNull();
    expect(result.scoreDelta).toBeNull();
    expect(result.agreed).toBe(true);
  });

  it("does not let an injected page lower its own score through the model", () => {
    const deterministic = runRules(healthySnapshot());
    const draft = agreeingDraft(REGISTRY.map((rule) => rule.id), 0);

    const result = reconcile(deterministic, draft, REGISTRY);

    expect(result.score.overall).toBe(100);
    expect(result.findings).toEqual([]);
  });
});
