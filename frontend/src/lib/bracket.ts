// Personal prediction brackets (F04): the fan's picks, how they propagate
// through the rounds, and how they are scored against the model's seeded
// story bracket. Pure functions only; the simulation itself belongs to the
// engine in src/tournament/.

import { bracketOrder, type BracketResult, type MatchupTable, type SeriesBestOf } from "../tournament";
import { seriesWinProbability } from "./series";

/** picks[r][i] = the key picked to win series i of round r, or null. */
export type Picks = (string | null)[][];

export interface Slot {
  top: string | null;
  bottom: string | null;
}

/** Points for one correct pick in round r: 10, 20, 40, 80. Every round of a 16-team bracket is worth 80. */
export function roundPoints(round: number): number {
  return 10 * 2 ** round;
}

/** Short display name for a team-season, e.g. "1998 Bulls". */
export function teamLabel(team: { season: number; name: string }): string {
  return `${team.season} ${team.name}`;
}

export function roundCount(size: number): number {
  return Math.log2(size);
}

export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - 1 - round;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return "First round";
}

export function emptyPicks(size: number): Picks {
  const picks: Picks = [];
  for (let games = size / 2; games >= 1; games /= 2) {
    picks.push(Array<string | null>(games).fill(null));
  }
  return picks;
}

/**
 * The series the fan's own bracket produces: round 0 comes from standard
 * seeded placement, later rounds from the fan's earlier picks.
 */
export function pickSlots(entrants: readonly string[], picks: Picks): Slot[][] {
  const order = bracketOrder(entrants.length);
  let feed: (string | null)[] = order.map((seed) => entrants[seed - 1]);
  const slots: Slot[][] = [];
  for (let r = 0; r < picks.length; r++) {
    const round: Slot[] = [];
    for (let i = 0; i < feed.length; i += 2) {
      round.push({ top: feed[i], bottom: feed[i + 1] });
    }
    slots.push(round);
    feed = picks[r];
  }
  return slots;
}

/**
 * Sets one pick and clears every later pick that is no longer possible, e.g.
 * a final pick for a team the fan has just knocked out in the first round.
 */
export function setPick(entrants: readonly string[], picks: Picks, round: number, index: number, winner: string): Picks {
  const next = picks.map((r) => [...r]);
  next[round][index] = winner;
  for (let r = round + 1; r < next.length; r++) {
    const slots = pickSlots(entrants, next)[r];
    next[r] = next[r].map((pick, i) => (pick !== null && (pick === slots[i].top || pick === slots[i].bottom) ? pick : null));
  }
  return next;
}

export function pickCount(picks: Picks): { made: number; total: number } {
  let made = 0;
  let total = 0;
  for (const round of picks) {
    for (const pick of round) {
      total++;
      if (pick !== null) made++;
    }
  }
  return { made, total };
}

export function isComplete(picks: Picks): boolean {
  const { made, total } = pickCount(picks);
  return made === total;
}

/** True when `picks` has the shape of a bracket of `entrants` and every pick is a legal one. */
export function isValidPicks(entrants: readonly string[], picks: unknown): picks is Picks {
  const expected = emptyPicks(entrants.length);
  if (!Array.isArray(picks) || picks.length !== expected.length) return false;
  for (let r = 0; r < expected.length; r++) {
    const round: unknown = picks[r];
    if (!Array.isArray(round) || round.length !== expected[r].length) return false;
    if (!round.every((p) => p === null || typeof p === "string")) return false;
  }
  const slots = pickSlots(entrants, picks as Picks);
  return (picks as Picks).every((round, r) =>
    round.every((pick, i) => pick === null || pick === slots[r][i].top || pick === slots[r][i].bottom),
  );
}

export interface RoundScore {
  correct: number;
  games: number;
  points: number;
  maxPoints: number;
}

export interface BracketScore {
  rounds: RoundScore[];
  points: number;
  maxPoints: number;
  correct: number;
  games: number;
}

/**
 * Scores the fan's picks against the model's story bracket, round by round. A
 * pick is correct when the picked team won that bracket position's series,
 * whoever it actually played. Only the first `revealedRounds` rounds count.
 */
export function scorePicks(picks: Picks, model: BracketResult, revealedRounds: number = picks.length): BracketScore {
  const rounds: RoundScore[] = picks.slice(0, revealedRounds).map((round, r) => {
    const correct = round.filter((pick, i) => pick !== null && pick === model.rounds[r][i].winner).length;
    return { correct, games: round.length, points: correct * roundPoints(r), maxPoints: round.length * roundPoints(r) };
  });
  return {
    rounds,
    points: rounds.reduce((sum, r) => sum + r.points, 0),
    maxPoints: picks.reduce((sum, round, r) => sum + round.length * roundPoints(r), 0),
    correct: rounds.reduce((sum, r) => sum + r.correct, 0),
    games: rounds.reduce((sum, r) => sum + r.games, 0),
  };
}

export interface Disagreement {
  round: number;
  winner: string;
  loser: string;
  /** The model's probability that the fan's pick wins this series. */
  seriesProbability: number;
}

/**
 * The fan's pick the model liked least: the series in the fan's own bracket
 * where the model gives the picked team the lowest chance to win. Null when
 * every pick was the model's favorite.
 */
export function biggestDisagreement(
  entrants: readonly string[],
  picks: Picks,
  table: MatchupTable,
  bestOf: SeriesBestOf,
): Disagreement | null {
  const slots = pickSlots(entrants, picks);
  let worst: Disagreement | null = null;
  picks.forEach((round, r) => {
    round.forEach((winner, i) => {
      const { top, bottom } = slots[r][i];
      if (winner === null || top === null || bottom === null) return;
      const loser = winner === top ? bottom : top;
      const p = table.probability(winner, loser);
      if (p === undefined) return;
      const seriesProbability = seriesWinProbability(p, bestOf);
      if (seriesProbability < 0.5 && (worst === null || seriesProbability < worst.seriesProbability)) {
        worst = { round: r, winner, loser, seriesProbability };
      }
    });
  });
  return worst;
}
