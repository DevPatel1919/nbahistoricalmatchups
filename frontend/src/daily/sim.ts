// The Daily Three simulated game (F12). One game per matchup, the same in
// every browser for the same puzzle.
//
// The winner is decided once, by the first draw: a wins if rng() < p, where p
// is a's exported neutral win probability. Nothing else may change who wins,
// and nothing nudges it toward the favourite. Everything after that only
// dresses the result: a final score whose margin is centred on the exported
// margin m, then scoring plays and scorers that add up to it.
//
// Never change a released engine's output: past puzzles must replay the same,
// because shared results and stored stats depend on them. To change anything
// here, add "sim-v2" and pin it only in day files not yet released. The golden
// tests (tests/unit/daily-engine.test.ts) pin sim-v1.
//
// Determinism: the only randomness is tournament/prng.ts. The normal draws use
// the Irwin-Hall sum of 12 uniforms, so no transcendental Math function (whose
// last bits may vary by engine) is ever called.
//
// One simulated game is a sample, not a prediction: never present its score,
// or m, as a precise margin (model-integrity gate, lib/margin.ts).

import { createRng, type Rng } from "../tournament/prng";
import type { DailyEngine, DailyGame, DailyTeam, Side } from "./types";

// ---------------------------------------------------------------------------
// sim-v1 constants. Frozen: changing any of them changes released games.
// ---------------------------------------------------------------------------

export const QUARTER_SECONDS = 720;
export const GAME_SECONDS = 4 * QUARTER_SECONDS;

const MARGIN_SD = 12; // points, around the exported margin m
const TOTAL_SD = 9; // points, around the expected combined score
const POSSESSION_SD = 2; // possessions, around the teams' average pace
const MAX_MARGIN_DRAWS = 64; // then fall back to a 1-point game
const MIN_LOSER_POINTS = 60;
const DEFAULT_THREE_RATE = 0.2; // 3PA / FGA when the pool has no threeRate
const THREE_SHARE_PER_RATE = 0.85; // share of points from threes, per unit of 3PA / FGA
const THREE_JITTER = 1.5; // made threes
const FREE_THROW_SHARE = 0.18; // share of points from free throws
const FREE_THROW_JITTER = 2; // points
const STRETCHES = 16; // 3-minute stretches of the game
const STRETCH_SECONDS = GAME_SECONDS / STRETCHES;
const RUN_TILT = 0.7; // a team's scoring rate in a stretch: 0.3x to 1.7x, so mild runs

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type PlayKind = "three" | "two" | "free-throws";

/** Starter index into the team's starters, or BENCH. */
export const BENCH = -1;

export type SimPlay = {
  /** Elapsed game seconds, 1..GAME_SECONDS - 1, non-decreasing through the game. */
  t: number;
  side: Side;
  kind: PlayKind;
  points: 1 | 2 | 3;
  scorer: number;
  /** Running score after this play: [a, b]. */
  score: [number, number];
};

/** Points only, labelled as simulated in the UI. */
export type SimBox = { starters: number[]; bench: number };

export type SimGame = {
  engine: DailyEngine;
  seed: string;
  winner: Side;
  final: [number, number];
  plays: SimPlay[];
  box: [SimBox, SimBox];
};

export type SimInput = {
  engine: DailyEngine;
  n: number; // puzzle number
  gameIndex: number; // 0..2, game 3 (the featured one) is 2
  game: Pick<DailyGame, "p" | "m">;
  teamA: DailyTeam;
  teamB: DailyTeam;
};

export function simSeed(engine: DailyEngine, n: number, gameIndex: number): string {
  return `daily-three:${engine}:${n}:${gameIndex}`;
}

/** Plays the day's game with the engine its day file pins. */
export function simulateGame(input: SimInput): SimGame {
  switch (input.engine) {
    case "sim-v1":
      return simV1(input);
    default:
      throw new Error(`Unknown Daily Three engine: ${String(input.engine)}`);
  }
}

/** Quarter (1-4) and seconds left in it, for elapsed game seconds t. */
export function clockAt(t: number): { quarter: number; secondsLeft: number } {
  const quarter = Math.min(4, Math.floor(t / QUARTER_SECONDS) + 1);
  return { quarter, secondsLeft: quarter * QUARTER_SECONDS - t };
}

// ---------------------------------------------------------------------------
// sim-v1. The order of rng draws below is part of the engine.
// ---------------------------------------------------------------------------

function standardNormal(rng: Rng): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += rng();
  return sum - 6;
}

function simV1({ engine, n, gameIndex, game, teamA, teamB }: SimInput): SimGame {
  const seed = simSeed(engine, n, gameIndex);
  const rng = createRng(seed);

  // 1. The winner: the model's honest odds, never adjusted.
  const winner: Side = rng() < game.p ? 0 : 1;

  // 2. The expected combined score, from pace and each offence against the other defence.
  const possessions = (teamA.pace + teamB.pace) / 2 + POSSESSION_SD * standardNormal(rng);
  const expectedA = (possessions * (teamA.offRating + teamB.defRating)) / 200;
  const expectedB = (possessions * (teamB.offRating + teamA.defRating)) / 200;
  const total = expectedA + expectedB + TOTAL_SD * standardNormal(rng);

  // 3. The margin: normal around a's margin m, truncated to the winner's side, at least 1.
  let margin = 1;
  for (let i = 0; i < MAX_MARGIN_DRAWS; i++) {
    const x = game.m + MARGIN_SD * standardNormal(rng);
    if (winner === 0 ? x > 0 : x < 0) {
      margin = Math.max(1, Math.round(Math.abs(x)));
      break;
    }
  }
  const loserPoints = Math.max(MIN_LOSER_POINTS, Math.round((total - margin) / 2));
  const final: [number, number] =
    winner === 0 ? [loserPoints + margin, loserPoints] : [loserPoints, loserPoints + margin];

  // 4. Each team's points as scoring plays, shuffled within the team.
  const teams = [teamA, teamB] as const;
  const queues = ([0, 1] as const).map((side) => {
    const plays = splitPoints(rng, final[side], teams[side].threeRate);
    shuffle(rng, plays);
    return plays;
  });

  // 5. Spread each team's plays evenly through the game (one per equal slice of
  //    its scoring, jittered), with a hot or cold tilt in every stretch so mild
  //    runs happen. Then merge the two teams by game clock.
  const timed: { t: number; side: Side; play: ScoringPlay }[] = [];
  for (const side of [0, 1] as const) {
    const tilt = Array.from({ length: STRETCHES }, () => 1 + RUN_TILT * (2 * rng() - 1));
    const count = queues[side].length;
    queues[side].forEach((play, k) => {
      const t = tiltedTime(tilt, (k + rng()) / count);
      timed.push({ t, side, play });
    });
  }
  timed.sort((x, y) => x.t - y.t || x.side - y.side); // stable: ties keep each team's order

  // 6. Scorers: starters in proportion to PPG, the rest to the bench.
  const weights = teams.map((t) => [...t.starters.map((s) => Math.max(0, s.ppg)), Math.max(0, t.benchPpg)]);
  const box: [SimBox, SimBox] = [
    { starters: teamA.starters.map(() => 0), bench: 0 },
    { starters: teamB.starters.map(() => 0), bench: 0 },
  ];
  const score: [number, number] = [0, 0];
  const plays: SimPlay[] = timed.map(({ t, side, play: { kind, points } }) => {
    const pick = weightedIndex(rng, weights[side]);
    const scorer = pick === teams[side].starters.length ? BENCH : pick;
    if (scorer === BENCH) box[side].bench += points;
    else box[side].starters[scorer] += points;
    score[side] += points;
    return { t, side, kind, points, scorer, score: [score[0], score[1]] };
  });

  return { engine, seed, winner, final, plays, box };
}

type ScoringPlay = { kind: PlayKind; points: 1 | 2 | 3 };

function splitPoints(rng: Rng, points: number, threeRate: number | undefined): ScoringPlay[] {
  const threeShare = (threeRate ?? DEFAULT_THREE_RATE) * THREE_SHARE_PER_RATE;
  let threes = Math.max(0, Math.round((points * threeShare) / 3 + THREE_JITTER * standardNormal(rng)));
  let freeThrows = Math.max(0, Math.round(points * FREE_THROW_SHARE + FREE_THROW_JITTER * standardNormal(rng)));
  while (3 * threes + freeThrows > points) {
    if (threes > 0) threes -= 1;
    else freeThrows -= 1;
  }
  if ((points - 3 * threes - freeThrows) % 2 === 1) freeThrows += 1;
  const twos = (points - 3 * threes - freeThrows) / 2;

  const plays: ScoringPlay[] = [];
  for (let i = 0; i < threes; i++) plays.push({ kind: "three", points: 3 });
  for (let i = 0; i < twos; i++) plays.push({ kind: "two", points: 2 });
  for (let i = 0; i < Math.floor(freeThrows / 2); i++) plays.push({ kind: "free-throws", points: 2 });
  if (freeThrows % 2 === 1) plays.push({ kind: "free-throws", points: 1 });
  return plays;
}

/** Game second (1..GAME_SECONDS - 1) at share q of a team's scoring, given its scoring rate per stretch. */
function tiltedTime(tilt: number[], q: number): number {
  const total = tilt.reduce((acc, w) => acc + w, 0);
  let x = q * total;
  let stretch = 0;
  while (stretch < tilt.length - 1 && x >= tilt[stretch]) {
    x -= tilt[stretch];
    stretch += 1;
  }
  const into = Math.min(1, x / tilt[stretch]);
  const t = Math.floor((stretch + into) * STRETCH_SECONDS);
  return Math.min(GAME_SECONDS - 1, Math.max(1, t));
}

function shuffle<T>(rng: Rng, items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

function weightedIndex(rng: Rng, weights: number[]): number {
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) return weights.length - 1;
  let x = rng() * sum;
  let lastPositive = weights.length - 1;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    x -= weights[i];
    lastPositive = i;
    if (x < 0) return i;
  }
  return lastPositive; // floating-point rounding at the very top of the range
}
