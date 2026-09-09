import type { Finding, ScoredPillar, Severity, Snapshot } from "@/app/types";

/**
 * What a rule's `run` returns: the finding minus the three fields the rule
 * already declares. Those are lifted onto the `Rule` itself so each one is
 * written once — and so scoring can total the penalty a registry *could*
 * incur without running anything.
 */
export type RuleFinding = Omit<Finding, "ruleId" | "pillar" | "severity">;

/**
 * A rule is a pure function over a `Snapshot`. No browser, no network, no
 * model — same snapshot in, same finding out, which is what makes a re-run of
 * an unchanged page produce an identical score (README.md:175).
 *
 * That determinism doubles as the primary prompt-injection defense: the page
 * being audited is attacker-controlled text, and because the score is computed
 * here rather than authored by the agent, the worst a successful injection
 * achieves is bad prose attached to an unchanged number (README.md:186).
 *
 * What the shape does NOT buy: a rule cannot ask a follow-up question, cannot
 * fetch a second page, and cannot see anything the collector did not put in the
 * snapshot. Layout-derived checks — above-the-fold, element rects, contrast,
 * rendered image size — are unwritable against an HTML parse and stay
 * unwritable until a headless renderer replaces the scraper.
 */
export type Rule = {
  /**
   * Namespaced by pillar: `"conversion.no-pricing"`. Stage ③ cites these and
   * drops any recommendation naming an id not in this run (README.md:51), so
   * the set has to be finite and owned by code.
   */
  id: string;
  pillar: ScoredPillar;
  /**
   * The criterion in one sentence, phrased as what makes the rule *fire*.
   * This is the text the model is scored against, so it has to be checkable
   * from the page alone — not a rationale, and not advice.
   */
  description: string;
  /** Fixed per rule, not per page — it is the weight, so it cannot vary. */
  severity: Severity;
  /**
   * `null` means the rule passed. A rule never throws — a gap in the snapshot
   * is a pass, not a crash, because one bad selector must not fail the audit.
   */
  run(snapshot: Snapshot): RuleFinding | null;
};
