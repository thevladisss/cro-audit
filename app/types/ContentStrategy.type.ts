export type CompetitorEvidence = {
  source: "competitor";
  competitorUrl: string;
  observation: string;
};

export type FindingEvidence = {
  source: "finding";
  ruleId: string;
  observation: string;
};

export type Evidence = CompetitorEvidence | FindingEvidence;

export type RecommendationScale = "low" | "medium" | "high";

export type Recommendation = {
  id: string;
  title: string;
  rationale: string;
  evidence: Evidence[];
  effort: RecommendationScale;
  impact: RecommendationScale;
};

export type ContentStrategy = {
  summary: string;
  recommendations: Recommendation[];
};
