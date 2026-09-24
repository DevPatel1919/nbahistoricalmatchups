// Puzzle-set draws. Both policies read only pre-game selection metadata; the
// candidate lists are prepared server-side from the private pool artifact.

import type { Rng } from "../tournament/prng";
import { BANDS, PUZZLES_PER_SET, UNRANKED_COMPOSITION, type Band } from "./types";

/** k distinct items, uniformly, in random order (partial Fisher-Yates on a copy). */
export function sampleDistinct<T>(items: readonly T[], k: number, rng: Rng): T[] {
  if (k > items.length) throw new Error("Not enough candidates to draw " + k);
  const pool = items.slice();
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

/** Unranked: 1 lock-band, 2 favourite-band, and 2 toss-up puzzles, shuffled. */
export function drawUnrankedSet(byBand: Readonly<Record<Band, readonly string[]>>, rng: Rng): string[] {
  const ids = BANDS.flatMap((band) => sampleDistinct(byBand[band], UNRANKED_COMPOSITION[band], rng));
  return sampleDistinct(ids, ids.length, rng);
}

/** Ranked: any five unused signal-divergent puzzles. */
export function drawRankedSet(unused: readonly string[], rng: Rng): string[] {
  return sampleDistinct(unused, PUZZLES_PER_SET, rng);
}
