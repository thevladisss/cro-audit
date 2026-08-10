/**
 * One terminal tool per stage. Each agent call is stateless and ends by calling
 * its tool rather than returning free text — `strict: true`,
 * `additionalProperties: false`, every field `required`, so the input is
 * guaranteed to validate and there is one obvious place to run the checks the
 * schema cannot express.
 *
 * There are no retrieval tools: a stage is given what it needs in the request.
 */
export { SUBMIT_PROFILE } from "./submitProfile";
export type { ProfileDraft } from "./submitProfile";

export { SUBMIT_COMPETITORS } from "./submitCompetitors";
export type { CompetitorDraft, CompetitorsDraft } from "./submitCompetitors";

export { SUBMIT_STRATEGY } from "./submitStrategy";
export type { RecommendationDraft, StrategyDraft } from "./submitStrategy";
