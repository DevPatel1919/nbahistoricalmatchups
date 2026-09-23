// Validation for tournament definitions. Every entry point (run, encode,
// decode) goes through here, so a definition that passes is safe to simulate.

import { fail, ok, type Result, type SeriesBestOf, type TournamentDefinition } from "./types";

export const TOURNAMENT_SIZES: readonly number[] = [8, 16];
export const SERIES_BEST_OF: readonly number[] = [1, 3, 5, 7];

/** Exported team-season key: season year, then a lowercase hyphenated name. */
const ENTRANT_KEY = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_ENTRANT_KEY_LENGTH = 40;
const SEED = /^[A-Za-z0-9_-]{1,32}$/;

export function isSeriesBestOf(value: number): value is SeriesBestOf {
  return SERIES_BEST_OF.includes(value);
}

/**
 * Checks shape, size, keys, uniqueness, seed, and series length. When
 * `knownKeys` is given (e.g. from index.json), entrants outside it are
 * rejected as unsupported.
 */
export function validateDefinition(
  definition: TournamentDefinition,
  knownKeys?: ReadonlySet<string>,
): Result<TournamentDefinition> {
  if (definition.version !== 1) {
    return fail("unsupported-version", `Definition version ${String(definition.version)} is not supported.`);
  }
  const { entrants, seed, seriesBestOf } = definition;
  if (!Array.isArray(entrants) || !TOURNAMENT_SIZES.includes(entrants.length)) {
    return fail("invalid-size", `A tournament needs 8 or 16 entrants, got ${entrants?.length ?? 0}.`);
  }
  const seen = new Set<string>();
  for (const key of entrants) {
    if (typeof key !== "string" || key.length > MAX_ENTRANT_KEY_LENGTH || !ENTRANT_KEY.test(key)) {
      return fail("invalid-entrant-key", `"${String(key)}" is not a team-season key.`);
    }
    if (seen.has(key)) {
      return fail("duplicate-entrant", `"${key}" is entered more than once; a team cannot play itself.`);
    }
    if (knownKeys && !knownKeys.has(key)) {
      return fail("unknown-entrant", `"${key}" is not a supported team-season.`);
    }
    seen.add(key);
  }
  if (typeof seed !== "string" || !SEED.test(seed)) {
    return fail("invalid-seed", "The seed must be 1-32 characters of letters, digits, '-' or '_'.");
  }
  if (typeof seriesBestOf !== "number" || !isSeriesBestOf(seriesBestOf)) {
    return fail("invalid-best-of", `Series length must be 1, 3, 5, or 7, got ${String(seriesBestOf)}.`);
  }
  return ok(definition);
}

const SEED_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/**
 * Makes a fresh 10-character seed for a NEW tournament. Pass the randomness
 * in (e.g. Math.random): picking a seed is not a shareable outcome, but
 * everything derived from the seed afterwards is deterministic.
 */
export function generateSeed(random: () => number): string {
  let seed = "";
  for (let i = 0; i < 10; i++) {
    seed += SEED_ALPHABET[Math.floor(random() * SEED_ALPHABET.length) % SEED_ALPHABET.length];
  }
  return seed;
}
