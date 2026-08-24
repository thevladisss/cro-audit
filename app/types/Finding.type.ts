import type { Pillar } from "./SiteProfile.type";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingScale = 1 | 2 | 3;

export type Finding = {
  ruleId: string;
  pillar: Pillar;
  severity: Severity;
  title: string;
  evidence: string;
  recommendation: string;
  impact: FindingScale;
  effort: FindingScale;
  selector?: string;
};
