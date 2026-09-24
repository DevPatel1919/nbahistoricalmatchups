// The Sparring Partner: a skill-matched practice opponent.
//
// It is told the answer and decides how often to use it, at a rate sampled
// from the player's own recent accuracy. It is NOT a prediction and must never
// be labelled as the model or as any kind of forecast (F09 brief, "The
// practice bot must not be presented as the model"). Its results never move
// rating.

import type { Rng } from "../tournament/prng";
import { CONFIDENCE_LEVELS, type Confidence, type Pick, type PuzzleAnswer } from "./types";

export const BOT_DISPLAY_NAME = "Sparring Partner";
export const BOT_DISCLOSURE = "Skill-matched practice opponent, not a model prediction.";

export const BOT_HISTORY_WINDOW = 20;
export const BOT_MIN_ACCURACY = 0.4;
export const BOT_MAX_ACCURACY = 0.85;

/** The player's recent scored picks, newest last. Only the last BOT_HISTORY_WINDOW count. */
export type RecentPick = { correct: boolean; confidence: Confidence };

/**
 * Draws Beta(1 + correct, 1 + wrong) exactly, as the (correct + 1)-th smallest
 * of (correct + wrong + 1) uniforms, so it needs only the injected RNG and no
 * transcendental functions.
 */
function sampleBeta(successes: number, failures: number, rng: Rng): number {
  const draws = Array.from({ length: successes + failures + 1 }, () => rng()).sort((x, y) => x - y);
  return draws[successes];
}

/** A target accuracy for this set, sampled from the player's recent accuracy. */
export function sampleBotAccuracy(history: readonly RecentPick[], rng: Rng): number {
  const recent = history.slice(-BOT_HISTORY_WINDOW);
  const correct = recent.filter((p) => p.correct).length;
  const target = sampleBeta(correct, recent.length - correct, rng);
  return Math.min(BOT_MAX_ACCURACY, Math.max(BOT_MIN_ACCURACY, target));
}

/** The bot's tier mix mirrors the player's recent mix, smoothed so every tier stays possible. */
function sampleConfidence(history: readonly RecentPick[], rng: Rng): Confidence {
  const recent = history.slice(-BOT_HISTORY_WINDOW);
  const weights = CONFIDENCE_LEVELS.map((c) => 1 + recent.filter((p) => p.confidence === c).length);
  let x = rng() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < CONFIDENCE_LEVELS.length; i++) {
    x -= weights[i];
    if (x < 0) return CONFIDENCE_LEVELS[i];
  }
  return CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1];
}

/** The bot's picks for a set: each is correct with probability `accuracy`. */
export function drawBotPicks(answers: readonly PuzzleAnswer[], accuracy: number, history: readonly RecentPick[], rng: Rng): Pick[] {
  return answers.map((answer) => {
    const correct = rng() < accuracy;
    const wrongSide = answer.actualWinner === "home" ? "away" : "home";
    return {
      puzzleId: answer.puzzleId,
      side: correct ? answer.actualWinner : wrongSide,
      confidence: sampleConfidence(history, rng),
    };
  });
}
