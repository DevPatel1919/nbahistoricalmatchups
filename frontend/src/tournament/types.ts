// Public domain types for the tournament engine (F03). Screens live in F04;
// nothing in src/tournament/ may import React, browser storage, analytics, or
// fetch data.

/**
 * Bumped whenever a change would alter any result for an existing definition
 * (PRNG, stream derivation, bracket order, or series rules). Results carry it
 * so a shared link can tell which engine produced the story it shows.
 */
export const ENGINE_VERSION = 1;

export type TournamentSize = 8 | 16;
export type TournamentMode = "single-bracket" | "title-odds";
export type SeriesBestOf = 1 | 3 | 5 | 7;

export interface TournamentDefinition {
  /** Definition (serialization) format version. */
  version: 1;
  /**
   * Exported team-season keys in SEED ORDER: entrants[0] is the 1 seed. Use
   * `seedByStrength` to order a field by the model, or keep a curated order.
   */
  entrants: string[];
  /** 1-32 characters of [A-Za-z0-9_-]. Same seed, same story. */
  seed: string;
  seriesBestOf: SeriesBestOf;
}

export type EngineErrorCode =
  | "unsupported-version"
  | "invalid-size"
  | "invalid-entrant-key"
  | "duplicate-entrant"
  | "unknown-entrant"
  | "invalid-seed"
  | "invalid-best-of"
  | "invalid-run-count"
  | "missing-matchup"
  | "invalid-probability"
  | "malformed"
  | "too-long";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

/** Engine functions never throw on bad input; they return an error result. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(code: EngineErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

/** One series between two bracket slots. `top` is the higher-placed slot. */
export interface SeriesResult {
  top: string;
  bottom: string;
  /** Neutral single-game probability that `top` beats `bottom`. */
  topWinProbability: number;
  /** Winner key of each game, in order. */
  games: string[];
  topWins: number;
  bottomWins: number;
  winner: string;
}

export interface BracketResult {
  engineVersion: number;
  mode: "single-bracket";
  definition: TournamentDefinition;
  /** rounds[0] is the first round; the last round holds only the final. */
  rounds: SeriesResult[][];
  champion: string;
}

export interface EntrantOdds {
  key: string;
  /** 1-based seed (position in `definition.entrants`). */
  seed: number;
  /** advancement[r] = share of runs in which the entrant won round r. */
  advancement: number[];
  titles: number;
  /** titles / runs; the last entry of `advancement`. */
  titleProbability: number;
}

export interface TitleOddsResult {
  engineVersion: number;
  mode: "title-odds";
  definition: TournamentDefinition;
  runs: number;
  /** In seed order. */
  entrants: EntrantOdds[];
}
