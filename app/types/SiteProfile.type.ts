export type Pillar = "conversion" | "content" | "technical" | "performance";

/**
 * The pillars that have rules today.
 *
 * `content`, `technical`, and `performance` are deliberately absent rather than
 * scored 100 or scored 0. A pillar reported as a number the product did not
 * measure is worse than a pillar the product does not report — and in
 * `performance`'s case it is not merely unwritten but unwritable, since Core
 * Web Vitals and above-the-fold layout need a browser rather than an HTML parse.
 *
 * Widen this toward `Pillar` as rules land — `Score` and every consumer follow
 * automatically, and `overall` re-derives from whatever is present.
 */
export type ScoredPillar = Extract<Pillar, "conversion">;

/**
 * `overall` is the unweighted mean of `pillars` (README.md:73). With a single
 * scored pillar it equals that pillar; the mean is kept so widening
 * `ScoredPillar` changes nothing here.
 */
export type Score = {
  overall: number;
  pillars: Record<ScoredPillar, number>;
};

export type SiteProfile = {
  url: string;
  name: string;
  niche: string;
  location: string;
  services: string[];
  pages: string[];
  score: Score;
};
