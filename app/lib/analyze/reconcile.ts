import type { AnalysisDraft } from "@/tools/submitAnalysis";
import type { Finding, Score } from "@/app/types";

import type { Rule } from "@/app/lib/rules";

/**
 * Compare the deterministic verdict with the model's, rule by rule.
 *
 * The contract, and the reason this function exists rather than a `??`:
 * **`score` is always the deterministic one.** The model's number is recorded
 * beside it, never in place of it. The page is attacker-controlled text, so a
 * model score that could win is a model score an injected page can set.
 *
 * A divergence is therefore not an error to resolve at runtime — it is a signal
 * about the *rule*, surfaced for a human. `conversion.no-pricing` firing on a
 * page whose prices sit inside an image is a rule too literal; the model
 * catching that is the whole point of the second opinion.
 */

export type DivergenceDirection =
  /** Rules fired, the model did not — the rule may be too eager. */
  | "rule-only"
  /** The model fired, the rules did not — the rule may be too literal. */
  | "model-only";

export type Divergence = {
  ruleId: string;
  direction: DivergenceDirection;
  /** The model's justification, for the human reading the divergence. */
  modelEvidence: string;
  /** The rule's own evidence, when it fired. */
  ruleEvidence: string | null;
};

export type Reconciliation = {
  /** Deterministic. This is what ships, in every case. */
  score: Score;
  findings: Finding[];
  /** The model's 0-100, for comparison only. `null` when the call degraded. */
  modelScore: number | null;
  /** `modelScore - score.overall`. Positive means the model was kinder. */
  scoreDelta: number | null;
  divergences: Divergence[];
  /** True when every rule got the same verdict from both. */
  agreed: boolean;
};

export function reconcile(
  deterministic: { findings: Finding[]; score: Score },
  draft: AnalysisDraft | null,
  rules: Rule[],
): Reconciliation {
  const { findings, score } = deterministic;

  if (!draft) {
    // The model call degraded. The audit still stands — the agent is an
    // enhancement, never a gate (README.md:277).
    return {
      score,
      findings,
      modelScore: null,
      scoreDelta: null,
      divergences: [],
      agreed: true,
    };
  }

  const known = new Set(rules.map((rule) => rule.id));
  const firedByRules = new Map(
    findings.map((finding) => [finding.ruleId, finding]),
  );

  const divergences: Divergence[] = [];
  const seen = new Set<string>();

  for (const verdict of draft.verdicts) {
    // The schema enum should make this unreachable; keep it because a dropped
    // id is a cheaper failure than a divergence report about a phantom rule.
    if (!known.has(verdict.ruleId) || seen.has(verdict.ruleId)) continue;
    seen.add(verdict.ruleId);

    const ruleFinding = firedByRules.get(verdict.ruleId) ?? null;
    const ruleFired = ruleFinding !== null;
    if (ruleFired === verdict.fired) continue;

    divergences.push({
      ruleId: verdict.ruleId,
      direction: ruleFired ? "rule-only" : "model-only",
      modelEvidence: verdict.evidence,
      ruleEvidence: ruleFinding?.evidence ?? null,
    });
  }

  return {
    score,
    findings,
    modelScore: draft.score,
    scoreDelta: draft.score - score.overall,
    divergences,
    agreed: divergences.length === 0,
  };
}
