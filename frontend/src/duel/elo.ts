// Elo for human-versus-human ranked duels only. Start 1200, K = 24, and
// K = 40 while a player has fewer than 10 rated duels.
//
// Zero-sum: one integer delta per duel, added to one player and subtracted
// from the other. When the two players' K differ (one is provisional), the
// duel uses their mean, so neither side's change is larger than the other's.

import type { DuelOutcome } from "./duel";

export const ELO_START = 1200;
export const ELO_K = 24;
export const ELO_PROVISIONAL_K = 40;
export const ELO_PROVISIONAL_DUELS = 10;

export type RatedPlayer = { rating: number; ratedDuels: number };

export function kFactor(player: RatedPlayer): number {
  return player.ratedDuels < ELO_PROVISIONAL_DUELS ? ELO_PROVISIONAL_K : ELO_K;
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export type EloUpdate = {
  k: number;
  /** Change applied to player A; player B receives exactly -deltaA. */
  deltaA: number;
  ratingA: number;
  ratingB: number;
};

export function applyElo(a: RatedPlayer, b: RatedPlayer, outcome: DuelOutcome): EloUpdate {
  const k = (kFactor(a) + kFactor(b)) / 2;
  const scoreA = outcome === "a" ? 1 : outcome === "b" ? 0 : 0.5;
  const raw = k * (scoreA - expectedScore(a.rating, b.rating));
  // Round half away from zero so swapping the players mirrors the delta exactly.
  const deltaA = Math.sign(raw) * Math.round(Math.abs(raw)) + 0;
  return { k, deltaA, ratingA: a.rating + deltaA, ratingB: b.rating - deltaA };
}
