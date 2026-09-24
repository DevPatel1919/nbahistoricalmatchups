// Public interface of the tournament engine (F03). F04 imports from here only.
// Documented in docs/product/features/F03-tournament-engine.md.

export {
  ENGINE_VERSION,
  type BracketResult,
  type EngineError,
  type EngineErrorCode,
  type EntrantOdds,
  type Result,
  type SeriesBestOf,
  type SeriesResult,
  type TitleOddsResult,
  type TournamentDefinition,
  type TournamentMode,
  type TournamentSize,
} from "./types";
export { createRng, type Rng } from "./prng";
export { buildMatchupTable, type MatchupTable } from "./matchups";
export { generateSeed, validateDefinition } from "./definition";
export {
  DEFAULT_TITLE_ODDS_RUNS,
  MAX_TITLE_ODDS_RUNS,
  bracketOrder,
  runBracket,
  runTitleOdds,
  seedByStrength,
} from "./simulate";
export { MAX_ENCODED_LENGTH, decodeTournament, encodeTournament } from "./serialize";
