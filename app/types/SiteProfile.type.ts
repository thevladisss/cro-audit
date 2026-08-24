export type Pillar = "conversion" | "content" | "technical" | "performance";

export type SiteProfile = {
  url: string;
  name: string;
  niche: string;
  location: string;
  services: string[];
  pages: string[];
};
