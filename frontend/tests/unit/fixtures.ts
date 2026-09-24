// Test fixtures. Real matchup values are read from the exported team files
// under public/data/teams/ rather than copied into tests, so the fixtures can
// never drift from the export.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TeamFile } from "../../src/types";
import { buildMatchupTable, createRng, type MatchupTable } from "../../src/tournament";

const TEAMS_DIR = fileURLToPath(new URL("../../public/data/teams/", import.meta.url));

export function readTeamFile(key: string): TeamFile {
  return JSON.parse(readFileSync(`${TEAMS_DIR}${key}.json`, "utf8")) as TeamFile;
}

/** A 16-team field of well-known team-seasons, deliberately NOT in seed order. */
export const REAL_FIELD_16 = [
  "2019-raptors",
  "1998-bulls",
  "2008-celtics",
  "2017-warriors",
  "2004-pistons",
  "2016-warriors",
  "1998-jazz",
  "2001-lakers",
  "2011-mavericks",
  "2014-spurs",
  "2013-heat",
  "2016-cavaliers",
  "2021-bucks",
  "2023-nuggets",
  "2024-celtics",
  "2020-lakers",
];

export const REAL_FIELD_8 = REAL_FIELD_16.slice(0, 8);

export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(`Expected ok, got error: ${result.error.message}`);
  return result.value;
}

export function realTable(keys: readonly string[]): MatchupTable {
  return unwrap(buildMatchupTable(keys.map(readTeamFile)));
}

/**
 * A synthetic field with arbitrary pairwise probabilities, built the way the
 * export is: each file lists every opponent from its own perspective.
 */
export function syntheticField(size: number, seed: string): { keys: string[]; files: TeamFile[] } {
  const rng = createRng(`fixture|${seed}`);
  const keys = Array.from({ length: size }, (_, i) => `${1998 + i}-team${i}`);
  const files: TeamFile[] = keys.map((key) => ({ key, opponents: {} }));
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      // Spread across (0.01, 0.99), including lopsided pairs.
      const p = Math.round((0.01 + 0.98 * rng()) * 1e4) / 1e4;
      files[i].opponents[keys[j]] = { p, m: 0 };
      files[j].opponents[keys[i]] = { p: Math.round((1 - p) * 1e4) / 1e4, m: 0 };
    }
  }
  return { keys, files };
}

/** P(top wins a best-of series) with independent games at probability p. */
export function exactSeriesProbability(p: number, bestOf: number): number {
  const need = Math.ceil(bestOf / 2);
  let total = 0;
  let binom = 1; // C(need - 1 + k, k)
  for (let k = 0; k < need; k++) {
    if (k > 0) binom = (binom * (need - 1 + k)) / k;
    total += binom * p ** need * (1 - p) ** k;
  }
  return total;
}
