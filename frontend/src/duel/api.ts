// Wire types for the duel API (worker/src/index.ts). The Worker builds these;
// the frontend only reads them. Nothing here carries an answer before lock.

import type { ScoredPick } from "./scoring";
import type { Confidence, DrawMode, PuzzleView, Side } from "./types";

export type PlayMode = "solo" | "bot";

export type BotOpponent = { kind: "bot"; name: string; disclosure: string };

/** POST /v1/sets. Pre-lock: puzzles are PuzzleView only. */
export type IssuedSet = {
  duelId: string;
  mode: PlayMode;
  draw: DrawMode;
  puzzles: PuzzleView[];
  setToken: string;
  expiresAt: number;
  opponent: BotOpponent | null;
};

export type RevealedPick = ScoredPick & { confidence: Confidence | null };

/** POST /v1/duels/:id/submission, and GET /v1/duels/:id once revealed. */
export type DuelResult = {
  duelId: string;
  mode: PlayMode;
  puzzles: { puzzleId: string; view: PuzzleView; actualWinner: Side; modelInSample: boolean }[];
  you: { total: number; picks: RevealedPick[] };
  model: { label: string; total: number; picks: RevealedPick[]; trainedThroughSeason: number };
  opponent:
    | (BotOpponent & {
        total: number;
        picks: RevealedPick[];
        outcome: "you" | "opponent" | "draw";
        decidedBy: "total" | "best-correct-call" | "draw";
      })
    | null;
};

/** GET /v1/duels/:id */
export type DuelState =
  | { state: "open"; set: IssuedSet }
  | { state: "expired"; duelId: string }
  | { state: "revealed"; result: DuelResult };

export type ApiErrorBody = { error: string; message: string };
