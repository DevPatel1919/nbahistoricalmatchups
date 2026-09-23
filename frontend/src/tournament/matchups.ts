// Neutral game probabilities between entrants, read from the exported team
// files (frontend/public/data/teams/*.json). The engine never fetches: the
// caller loads the entrants' files (F04 uses lib/dataLoader) and passes them in.

import type { TeamFile } from "../types";
import { fail, ok, type Result } from "./types";

export interface MatchupTable {
  /** Keys whose team files were supplied. */
  readonly keys: ReadonlySet<string>;
  /**
   * Neutral probability that `a` beats `b`, or undefined when the pair is not
   * covered by the supplied files. For any covered pair,
   * probability(b, a) === 1 - probability(a, b).
   */
  probability(a: string, b: string): number | undefined;
}

/**
 * Builds a table from exported team files. Every exported file lists all of
 * its opponents from its own perspective, so each pair appears twice with
 * values rounded independently. To make the two lookup directions exactly
 * complementary, a pair is always read from the file of the alphabetically
 * smaller key and complemented for the other direction.
 */
export function buildMatchupTable(files: readonly TeamFile[]): Result<MatchupTable> {
  const byKey = new Map<string, TeamFile>();
  for (const file of files) {
    if (byKey.has(file.key)) {
      return fail("duplicate-entrant", `Team file "${file.key}" was supplied twice.`);
    }
    for (const [opponent, result] of Object.entries(file.opponents)) {
      if (!Number.isFinite(result.p) || result.p < 0 || result.p > 1) {
        return fail("invalid-probability", `${file.key} vs ${opponent} has probability ${result.p}.`);
      }
    }
    byKey.set(file.key, file);
  }

  const probability = (a: string, b: string): number | undefined => {
    if (a === b) return undefined;
    const [first, second] = a < b ? [a, b] : [b, a];
    const p = byKey.get(first)?.opponents[second]?.p;
    if (p === undefined) return undefined;
    return first === a ? p : 1 - p;
  };

  return ok({ keys: new Set(byKey.keys()), probability });
}
