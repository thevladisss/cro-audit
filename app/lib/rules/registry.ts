import type { Finding, Score, Snapshot } from "@/app/types";

import { CONVERSION_RULES } from "./conversion";
import { scoreFindings } from "./score";
import type { Rule } from "./types";

/**
 * The registry and the sweep over it.
 *
 * One pillar has rules today. `content` and `technical` are unwritten;
 * `performance` is unwritable against an HTML parse. Adding a pillar means
 * adding its rules here and widening `ScoredPillar` — scoring derives its
 * pillars from this array, so nothing else changes.
 *
 * Array order is emission order, and the report renders this list top-down.
 */

export const REGISTRY: Rule[] = [...CONVERSION_RULES];

export type RuleRunResult = { findings: Finding[]; score: Score };

/**
 * `onRule` reports `(done, total)` so the `rules` stage of the NDJSON stream
 * carries a real count rather than one after-the-fact line.
 *
 * A rule that throws is skipped rather than fatal: one bad rule must not fail an
 * audit the others can still produce. The failure mode of a CRO report is a
 * missing finding, never a 500. Note the consequence — a thrown rule is scored
 * as a pass, so a rule that throws on every page silently inflates the score.
 */
export function runRules(
  snapshot: Snapshot,
  onRule?: (done: number, total: number) => void,
  rules: Rule[] = REGISTRY,
): RuleRunResult {
  const findings: Finding[] = [];

  rules.forEach((rule, index) => {
    try {
      const result = rule.run(snapshot);
      if (result) {
        findings.push({
          ruleId: rule.id,
          pillar: rule.pillar,
          severity: rule.severity,
          ...result,
        });
      }
    } catch {
      // Deliberately swallowed — see the note above.
    }
    onRule?.(index + 1, rules.length);
  });

  return { findings, score: scoreFindings(findings, rules) };
}

/**
 * Stage ①'s half of README.md:191 — the model may cite `ruleId`s in its prose,
 * and any id not in the deterministic finding set is dropped rather than
 * trusted. An invented id is the cheapest injection to attempt and the cheapest
 * to defeat.
 */
export function keepGroundedRuleIds(
  cited: string[],
  findings: Finding[],
): string[] {
  const real = new Set(findings.map((finding) => finding.ruleId));
  return cited.filter((id) => real.has(id));
}
