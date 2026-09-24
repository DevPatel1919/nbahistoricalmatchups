// Brier-skill scoring against a 0.5 baseline, in points:
//   points = round(100 * (1 - brier / 0.25)),  brier = (p_assigned_to_actual_winner - 1)^2
// Players and the model use the identical formula; the model supplies its
// continuous probability instead of a tier.

import { CONFIDENCE_PROBABILITY, type Pick, type PuzzleAnswer, type Side } from "./types";

export function pointsFor(pAssignedToActualWinner: number): number {
  const brier = (pAssignedToActualWinner - 1) ** 2;
  // + 0 turns -0 into 0 so a zero score serializes and compares cleanly.
  return Math.round(100 * (1 - brier / 0.25)) + 0;
}

export type ScoredPick = {
  puzzleId: string;
  side: Side;
  probability: number;
  correct: boolean;
  points: number;
};

export function scorePick(pick: Pick, answer: PuzzleAnswer): ScoredPick {
  if (pick.puzzleId !== answer.puzzleId) throw new Error("Pick and answer are for different puzzles");
  const probability = CONFIDENCE_PROBABILITY[pick.confidence];
  const correct = pick.side === answer.actualWinner;
  return {
    puzzleId: pick.puzzleId,
    side: pick.side,
    probability,
    correct,
    points: pointsFor(correct ? probability : 1 - probability),
  };
}

/** The benchmark: the pre-game model scored with its own continuous probability. */
export function scoreModel(answer: PuzzleAnswer): ScoredPick {
  const pHome = answer.modelHomeWinProbability;
  const side: Side = pHome >= 0.5 ? "home" : "away";
  const pActual = answer.actualWinner === "home" ? pHome : 1 - pHome;
  return {
    puzzleId: answer.puzzleId,
    side,
    probability: side === "home" ? pHome : 1 - pHome,
    correct: side === answer.actualWinner,
    points: pointsFor(pActual),
  };
}

/** Scores picks against answers matched by puzzle id. Every answer needs exactly one pick. */
export function scoreSet(picks: readonly Pick[], answers: readonly PuzzleAnswer[]): ScoredPick[] {
  if (picks.length !== answers.length) throw new Error("Expected one pick per puzzle");
  const byId = new Map(picks.map((p) => [p.puzzleId, p]));
  if (byId.size !== picks.length) throw new Error("Duplicate pick for a puzzle");
  return answers.map((answer) => {
    const pick = byId.get(answer.puzzleId);
    if (!pick) throw new Error("Missing pick for a puzzle");
    return scorePick(pick, answer);
  });
}

export function totalPoints(scored: readonly ScoredPick[]): number {
  return scored.reduce((sum, s) => sum + s.points, 0);
}

/** Expected points of a tier for a player whose true belief in their pick is q. */
export function expectedPoints(tierProbability: number, belief: number): number {
  return belief * pointsFor(tierProbability) + (1 - belief) * pointsFor(1 - tierProbability);
}
