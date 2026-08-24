export type CompetitorConfidence = "high" | "medium" | "low";

export type Competitor = {
  url: string;
  name: string;
  services: string[];
  location: string;
  claims: string[];
  confidence: CompetitorConfidence;
};
