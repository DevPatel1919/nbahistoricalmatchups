// Public interface of the duel domain (F09 Session 2). Pure: no network,
// storage, or React. The Worker scores with it; the frontend only displays.

export * from "./types";
export { expectedPoints, pointsFor, scoreModel, scorePick, scoreSet, totalPoints, type ScoredPick } from "./scoring";
export { resolveDuel, type DuelOutcome, type DuelResolution } from "./duel";
export {
  ELO_K,
  ELO_PROVISIONAL_DUELS,
  ELO_PROVISIONAL_K,
  ELO_START,
  applyElo,
  expectedScore,
  kFactor,
  type EloUpdate,
  type RatedPlayer,
} from "./elo";
export {
  BOT_DISCLOSURE,
  BOT_DISPLAY_NAME,
  BOT_HISTORY_WINDOW,
  drawBotPicks,
  sampleBotAccuracy,
  type RecentPick,
} from "./bot";
export { drawRankedSet, drawUnrankedSet, sampleDistinct } from "./selection";
export { createRng, type Rng } from "../tournament/prng";
