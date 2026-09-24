// Duel-mode domain types (F09). Shared by the Worker (which scores) and the
// frontend (which only displays). See docs/product/features/F09-daily-duel.md.

export const ERA_KEYS = ["1998-2004", "2005-2011", "2012-2016", "2017-2021", "2022-2026"] as const;
export type EraKey = (typeof ERA_KEYS)[number];

export type Side = "home" | "away";

export const CONFIDENCE_LEVELS = ["lean", "confident", "lock"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Probability each confidence tier assigns to the picked side. */
export const CONFIDENCE_PROBABILITY: Record<Confidence, number> = {
  lean: 0.55,
  confident: 0.7,
  lock: 0.9,
};

export type DrawMode = { kind: "random" } | { kind: "era"; era: EraKey };

/** What a client may see before locking in. Carries no answer. */
export type PuzzleView = {
  puzzleId: string;
  era: EraKey;
  isPlayoffGame: boolean; // round and series game number withheld
  home: TeamSnapshot;
  away: TeamSnapshot;
};

export type TeamSnapshot = {
  city: string;
  name: string;
  winsEntering: number;
  lossesEntering: number;
  restDays: number;
  backToBack: boolean;
  last10NetRating: number;
  last10WinPct: number;
  missingRotationStrength: number;
};

export type Pick = { puzzleId: string; side: Side; confidence: Confidence };

/** Server-side only. Never serialized to a client before lock. */
export type PuzzleAnswer = {
  puzzleId: string;
  actualWinner: Side;
  modelHomeWinProbability: number;
};

/** The unranked composition bands (favourite probability), see the brief. */
export const BANDS = ["lock", "favorite", "tossup"] as const;
export type Band = (typeof BANDS)[number];
export const UNRANKED_COMPOSITION: Record<Band, number> = { lock: 1, favorite: 2, tossup: 2 };
export const PUZZLES_PER_SET = 5;

export function isEraKey(value: unknown): value is EraKey {
  return typeof value === "string" && (ERA_KEYS as readonly string[]).includes(value);
}

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === "string" && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}
