import type { Finding, ScoredPillar, Score, Severity } from "@/app/types";

import type { Rule } from "./types";

/**
 * Scoring: `Finding[]` → `Score`. Deterministic, and deliberately dull.
 *
 * A pillar scores the share of its available penalty the page did NOT incur:
 *
 *     pillar = 100 × (1 − incurred / possible)
 *
 * The alternative — a flat `100 − incurred` — was wrong at this registry size.
 * With four conversion rules the total available penalty is 63, so a page with
 * no CTA, no form, no pricing and nothing to tap scored 37 and could go no
 * lower. Normalising puts a total conversion failure at 0 and a clean page at
 * 100, and re-calibrates itself as rules are added.
 *
 * What that does NOT buy: scores are comparable within a registry version, not
 * across them. Adding a rule grows the denominator and shifts every past score,
 * so a stored score is only meaningful next to the registry that produced it.
 * If cross-version comparison ever matters, version the registry rather than
 * going back to absolute penalties.
 *
 * `impact` and `effort` are not inputs here. They are 1–3 scales the report
 * sorts by and stage ③ prioritizes on; folding them in would score the same
 * finding twice.
 */

const PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function total(items: { severity: Severity }[]): number {
  return items.reduce((sum, item) => sum + PENALTY[item.severity], 0);
}

export function scoreFindings(findings: Finding[], rules: Rule[]): Score {
  const pillarNames = [...new Set(rules.map((rule) => rule.pillar))];

  const pillars = Object.fromEntries(
    pillarNames.map((pillar) => {
      const possible = total(rules.filter((rule) => rule.pillar === pillar));
      const incurred = total(
        findings.filter((finding) => finding.pillar === pillar),
      );

      // A pillar whose rules are all `info` can incur nothing; it scores 100
      // rather than dividing by zero.
      const score = possible === 0 ? 100 : 100 * (1 - incurred / possible);
      return [pillar, clamp(score)];
    }),
  ) as Record<ScoredPillar, number>;

  // The unweighted mean, which is what README.md:73's own example resolves to:
  // (48 + 66 + 72 + 58) / 4 = 61. Averaging only the pillars that have rules
  // keeps `overall` honest as further pillars land.
  const values = pillarNames.map((pillar) => pillars[pillar]);
  const overall = values.length
    ? clamp(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 100;

  return { overall, pillars };
}
