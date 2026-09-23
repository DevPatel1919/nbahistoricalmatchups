// Bracket simulation. Every game is an independent draw at the exported
// neutral win probability: no era, fatigue, injury, or roster adjustment.

import { validateDefinition } from "./definition";
import type { MatchupTable } from "./matchups";
import { createRng, type Rng } from "./prng";
import {
  ENGINE_VERSION,
  fail,
  ok,
  type BracketResult,
  type EntrantOdds,
  type Result,
  type SeriesResult,
  type TitleOddsResult,
  type TournamentDefinition,
} from "./types";

export const DEFAULT_TITLE_ODDS_RUNS = 10_000;
export const MAX_TITLE_ODDS_RUNS = 100_000;

/**
 * Standard bracket placement by seed number (1-based), top to bottom:
 * 8 -> 1,8,4,5,2,7,3,6. The top two seeds can only meet in the final.
 */
export function bracketOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Resolved entrants plus an n x n probability matrix indexed by seed position. */
interface Field {
  definition: TournamentDefinition;
  n: number;
  /** p[i * n + j] = probability that entrants[i] beats entrants[j]. */
  p: Float64Array;
  /** Entrant indices in bracket order. */
  slots: number[];
  winsNeeded: number;
}

function prepare(definition: TournamentDefinition, table: MatchupTable): Result<Field> {
  const valid = validateDefinition(definition, table.keys);
  if (!valid.ok) return valid;
  const { entrants } = definition;
  const n = entrants.length;
  const p = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pij = table.probability(entrants[i], entrants[j]);
      if (pij === undefined) {
        return fail("missing-matchup", `No exported result for ${entrants[i]} vs ${entrants[j]}.`);
      }
      p[i * n + j] = pij;
      p[j * n + i] = 1 - pij;
    }
  }
  return ok({
    definition,
    n,
    p,
    slots: bracketOrder(n).map((s) => s - 1),
    winsNeeded: Math.ceil(definition.seriesBestOf / 2),
  });
}

/**
 * Plays one series; returns true when `top` wins. Draws one random number per
 * game, and stops as soon as either side reaches `winsNeeded`. When `games` is
 * given, each game's winner (true = top) is appended to it.
 */
function playSeries(pTop: number, winsNeeded: number, rng: Rng, games?: boolean[]): boolean {
  let top = 0;
  let bottom = 0;
  while (top < winsNeeded && bottom < winsNeeded) {
    const topWon = rng() < pTop;
    if (topWon) top++;
    else bottom++;
    games?.push(topWon);
  }
  return top === winsNeeded;
}

// Separate streams keep the story bracket and the odds independent of each
// other. The engine version is part of the stream name, so a future engine
// cannot silently replay an old link differently under the same version.
function streamSeed(mode: string, definition: TournamentDefinition): string {
  return `ct-v${ENGINE_VERSION}|${mode}|${definition.seed}`;
}

/** Plays one seeded, reproducible bracket: the shareable "story" mode. */
export function runBracket(definition: TournamentDefinition, table: MatchupTable): Result<BracketResult> {
  const prepared = prepare(definition, table);
  if (!prepared.ok) return prepared;
  const { n, p, slots, winsNeeded } = prepared.value;
  const { entrants } = definition;
  const rng = createRng(streamSeed("single-bracket", definition));

  const rounds: SeriesResult[][] = [];
  let alive = slots;
  while (alive.length > 1) {
    const round: SeriesResult[] = [];
    const next: number[] = [];
    for (let s = 0; s < alive.length; s += 2) {
      const top = alive[s];
      const bottom = alive[s + 1];
      const pTop = p[top * n + bottom];
      const gameLog: boolean[] = [];
      const topWon = playSeries(pTop, winsNeeded, rng, gameLog);
      const topWins = gameLog.filter(Boolean).length;
      round.push({
        top: entrants[top],
        bottom: entrants[bottom],
        topWinProbability: pTop,
        games: gameLog.map((g) => (g ? entrants[top] : entrants[bottom])),
        topWins,
        bottomWins: gameLog.length - topWins,
        winner: topWon ? entrants[top] : entrants[bottom],
      });
      next.push(topWon ? top : bottom);
    }
    rounds.push(round);
    alive = next;
  }

  return ok({
    engineVersion: ENGINE_VERSION,
    mode: "single-bracket",
    definition,
    rounds,
    champion: entrants[alive[0]],
  });
}

/**
 * Runs `runs` seeded Monte Carlo tournaments and reports how often each
 * entrant won each round. Deterministic for a given definition and run count.
 */
export function runTitleOdds(
  definition: TournamentDefinition,
  table: MatchupTable,
  runs: number = DEFAULT_TITLE_ODDS_RUNS,
): Result<TitleOddsResult> {
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_TITLE_ODDS_RUNS) {
    return fail("invalid-run-count", `Run count must be an integer from 1 to ${MAX_TITLE_ODDS_RUNS}, got ${runs}.`);
  }
  const prepared = prepare(definition, table);
  if (!prepared.ok) return prepared;
  const { n, p, slots, winsNeeded } = prepared.value;
  const rng = createRng(streamSeed("title-odds", definition));

  // log2 of a power of two, in integer arithmetic (Math.log2 is allowed to be
  // approximate by the spec).
  const roundCount = 31 - Math.clz32(n);
  // wins[i * roundCount + r] = runs in which entrant i won round r.
  const wins = new Uint32Array(n * roundCount);
  const alive = new Int32Array(n);

  for (let run = 0; run < runs; run++) {
    for (let s = 0; s < n; s++) alive[s] = slots[s];
    let size = n;
    for (let r = 0; r < roundCount; r++) {
      for (let s = 0; s < size; s += 2) {
        const top = alive[s];
        const bottom = alive[s + 1];
        const winner = playSeries(p[top * n + bottom], winsNeeded, rng) ? top : bottom;
        wins[winner * roundCount + r]++;
        alive[s >> 1] = winner;
      }
      size >>= 1;
    }
  }

  const entrants: EntrantOdds[] = definition.entrants.map((key, i) => {
    const advancement: number[] = [];
    for (let r = 0; r < roundCount; r++) advancement.push(wins[i * roundCount + r] / runs);
    const titles = wins[i * roundCount + roundCount - 1];
    return { key, seed: i + 1, advancement, titles, titleProbability: titles / runs };
  });

  return ok({ engineVersion: ENGINE_VERSION, mode: "title-odds", definition, runs, entrants });
}

/**
 * Orders a field by the model: each entrant's mean neutral win probability
 * against the rest of the field, strongest first, ties broken by key. The
 * result is independent of the input order.
 */
export function seedByStrength(entrants: readonly string[], table: MatchupTable): Result<string[]> {
  const sorted = [...entrants].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      return fail("duplicate-entrant", `"${sorted[i]}" is entered more than once.`);
    }
  }
  const strength = new Map<string, number>();
  for (const a of sorted) {
    let total = 0;
    for (const b of sorted) {
      if (a === b) continue;
      const pab = table.probability(a, b);
      if (pab === undefined) return fail("missing-matchup", `No exported result for ${a} vs ${b}.`);
      total += pab;
    }
    strength.set(a, total / Math.max(1, sorted.length - 1));
  }
  return ok(sorted.sort((a, b) => strength.get(b)! - strength.get(a)! || (a < b ? -1 : 1)));
}
