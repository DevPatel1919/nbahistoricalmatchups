// Duel resolution: five puzzles, higher total wins. A tie goes to the player
// with the higher-scoring single correct call; if that is also level, it is a draw.

import { totalPoints, type ScoredPick } from "./scoring";

export type DuelOutcome = "a" | "b" | "draw";

export type DuelResolution = {
  outcome: DuelOutcome;
  totalA: number;
  totalB: number;
  decidedBy: "total" | "best-correct-call" | "draw";
};

function bestCorrectCall(scored: readonly ScoredPick[]): number {
  // A player with no correct call has no best call; -Infinity loses to any correct one.
  return scored.reduce((best, s) => (s.correct && s.points > best ? s.points : best), -Infinity);
}

export function resolveDuel(a: readonly ScoredPick[], b: readonly ScoredPick[]): DuelResolution {
  if (a.length !== b.length) throw new Error("Both players must answer the same set");
  const aIds = a.map((s) => s.puzzleId).join();
  if (aIds !== b.map((s) => s.puzzleId).join()) throw new Error("Both players must answer the same set");

  const totalA = totalPoints(a);
  const totalB = totalPoints(b);
  if (totalA !== totalB) return { outcome: totalA > totalB ? "a" : "b", totalA, totalB, decidedBy: "total" };

  const bestA = bestCorrectCall(a);
  const bestB = bestCorrectCall(b);
  if (bestA !== bestB) {
    return { outcome: bestA > bestB ? "a" : "b", totalA, totalB, decidedBy: "best-correct-call" };
  }
  return { outcome: "draw", totalA, totalB, decidedBy: "draw" };
}
