/** What stage 1 (Website Analyzer) produces — see AGENTIC-WORKFLOW.md §1. */

export type ProfiledPage = {
  url: string;
  title: string;
  /** Blob URL. Absent until Phase 8 storage exists. */
  screenshotUrl?: string;
};

export type SiteProfile = {
  url: string;
  name: string;
  /** Editable at the stage-1 checkpoint. */
  niche: string;
  /** Editable at the stage-1 checkpoint. */
  location: string;
  /** Editable at the stage-1 checkpoint. */
  services: string[];
  pages: ProfiledPage[];
  /** 0–100, from the deterministic rules that run inside stage 1 (AUDIT-DESIGN §5). */
  score: number;
};
