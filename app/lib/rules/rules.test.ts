import { describe, expect, it, vi } from "vitest";

import type { Snapshot } from "@/app/types";

import { keepGroundedRuleIds, runRules, REGISTRY } from "./registry";
import { scoreFindings } from "./score";

/** A snapshot that passes every rule; each test breaks exactly one thing. */
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

describe("runRules", () => {
  it("returns no findings for a page that passes every rule", () => {
    const { findings } = runRules(healthySnapshot());

    expect(findings).toEqual([]);
  });

  it("scores a passing page 100", () => {
    const { score } = runRules(healthySnapshot());

    expect(score).toEqual({ overall: 100, pillars: { conversion: 100 } });
  });

  it("reports progress once per rule in the registry", () => {
    const onRule = vi.fn();

    runRules(healthySnapshot(), onRule);

    expect(onRule).toHaveBeenCalledTimes(REGISTRY.length);
    expect(onRule).toHaveBeenLastCalledWith(REGISTRY.length, REGISTRY.length);
  });

  it("flags a page with no call to action", () => {
    const { findings } = runRules(healthySnapshot({ ctas: [] }));

    expect(findings.map((finding) => finding.ruleId)).toContain(
      "conversion.no-cta",
    );
  });

  it("flags a page with no enquiry form", () => {
    const { findings } = runRules(healthySnapshot({ forms: [] }));

    expect(findings.map((finding) => finding.ruleId)).toContain(
      "conversion.no-form",
    );
  });

  it("flags a page whose copy names no price", () => {
    const { findings } = runRules(
      healthySnapshot({ text: "Call today for a free quote." }),
    );

    expect(findings.map((finding) => finding.ruleId)).toContain(
      "conversion.no-pricing",
    );
  });

  it("accepts a price written in any supported currency", () => {
    for (const text of ["From £49", "Only $99", "€120 per session", "49.00 GBP"]) {
      const { findings } = runRules(healthySnapshot({ text }));

      expect(findings.map((finding) => finding.ruleId)).not.toContain(
        "conversion.no-pricing",
      );
    }
  });

  it("does not read 'call for a quote' as pricing", () => {
    const { findings } = runRules(
      healthySnapshot({ text: "Call for a quote — no obligation." }),
    );

    expect(findings.map((finding) => finding.ruleId)).toContain(
      "conversion.no-pricing",
    );
  });

  it("flags a page with no tappable phone or email link", () => {
    const { findings } = runRules(
      healthySnapshot({
        links: [{ href: "/about", text: "About", external: false }],
      }),
    );

    expect(findings.map((finding) => finding.ruleId)).toContain(
      "conversion.no-contact-link",
    );
  });

  it("counts a mailto: link as contactable", () => {
    const { findings } = runRules(
      healthySnapshot({
        links: [{ href: "mailto:hi@example.com", text: "Email", external: true }],
      }),
    );

    expect(findings.map((finding) => finding.ruleId)).not.toContain(
      "conversion.no-contact-link",
    );
  });

  it("skips a rule that throws rather than failing the whole sweep", () => {
    // `headings` is absent entirely — a malformed snapshot, not a valid one.
    const malformed = { ...healthySnapshot(), ctas: undefined } as unknown as Snapshot;

    expect(() => runRules(malformed)).not.toThrow();
  });

  it("gives every finding an evidence string that quantifies the claim", () => {
    const { findings } = runRules(
      healthySnapshot({ ctas: [], forms: [], links: [], text: "Hello." }),
    );

    expect(findings).not.toHaveLength(0);
    for (const finding of findings) {
      expect(finding.evidence).toMatch(/\S/);
      expect(finding.recommendation).toMatch(/\S/);
    }
  });
});

describe("scoreFindings", () => {
  it("scores an empty finding set 100", () => {
    expect(scoreFindings([], REGISTRY)).toEqual({
      overall: 100,
      pillars: { conversion: 100 },
    });
  });

  it("scores the share of available penalty the page did not incur", () => {
    const { score } = runRules(healthySnapshot({ ctas: [] }));

    // no-cta is critical (25) out of 25 + 15 + 15 + 8 = 63 available.
    expect(score.pillars.conversion).toBe(Math.round(100 * (1 - 25 / 63)));
  });

  it("scores a page that fails every rule zero, not a floor above it", () => {
    const { score } = runRules(
      healthySnapshot({ ctas: [], forms: [], links: [], text: "Hello." }),
    );

    expect(score.overall).toBe(0);
  });

  it("mirrors the single scored pillar into overall", () => {
    const { score } = runRules(healthySnapshot({ ctas: [], forms: [] }));

    expect(score.overall).toBe(score.pillars.conversion);
  });
});

describe("keepGroundedRuleIds", () => {
  it("keeps a ruleId the deterministic sweep actually produced", () => {
    const { findings } = runRules(healthySnapshot({ ctas: [] }));

    expect(keepGroundedRuleIds(["conversion.no-cta"], findings)).toEqual([
      "conversion.no-cta",
    ]);
  });

  it("drops a ruleId the model invented", () => {
    const { findings } = runRules(healthySnapshot({ ctas: [] }));

    expect(
      keepGroundedRuleIds(["conversion.no-cta", "conversion.made-up"], findings),
    ).toEqual(["conversion.no-cta"]);
  });

  it("drops a real ruleId that did not fire on this page", () => {
    const { findings } = runRules(healthySnapshot({ ctas: [] }));

    expect(keepGroundedRuleIds(["conversion.no-pricing"], findings)).toEqual([]);
  });
});
