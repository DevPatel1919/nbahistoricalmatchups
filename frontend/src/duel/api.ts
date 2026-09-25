// Wire types for the duel API (worker/src/index.ts). The Worker builds these;
// the frontend only reads them. Nothing here carries an answer before lock.

import type { ScoredPick } from "./scoring";
import type { Confidence, DrawMode, PuzzleView, Side } from "./types";

/** solo and bot are single-seat. ranked and friend are two seats sharing one set (a match). */
export type PlayMode = "solo" | "bot" | "ranked" | "friend";
export type MatchMode = Extract<PlayMode, "ranked" | "friend">;

export type BotOpponent = { kind: "bot"; name: string; disclosure: string };
/** Another player. `name` is their display name, or a generic label for a guest. */
export type PlayerOpponent = { kind: "player"; name: string };

/** POST /v1/sets and POST /v1/invites/accept. Pre-lock: puzzles are PuzzleView only. */
export type IssuedSet = {
  duelId: string;
  mode: PlayMode;
  draw: DrawMode;
  puzzles: PuzzleView[];
  setToken: string;
  expiresAt: number;
  /** The bot, or the player whose set you joined. Never their picks. */
  opponent: BotOpponent | PlayerOpponent | null;
};

export type RevealedPick = ScoredPick & { confidence: Confidence | null };

/**
 * How a match ended. "forfeit": the opponent joined but did not lock in before
 * their set expired. "no-opponent": nobody joined before the match closed, or
 * the creator stopped waiting.
 */
export type MatchSettlement = "both-locked" | "forfeit" | "no-opponent";

export type RatingChange = { before: number; after: number; delta: number; k: number };

export type MatchSummary = {
  settledBy: MatchSettlement;
  rated: boolean;
  /** Your own rating change; null unless the duel was rated. */
  rating: RatingChange | null;
};

/** How the duel against an opponent was decided. "forfeit": one side never locked in. */
export type DecidedBy = "total" | "best-correct-call" | "draw" | "forfeit";

/** The submission response once revealed, and GET /v1/duels/:id once revealed. */
export type DuelResult = {
  duelId: string;
  mode: PlayMode;
  puzzles: { puzzleId: string; view: PuzzleView; actualWinner: Side; modelInSample: boolean }[];
  you: { total: number; picks: RevealedPick[] };
  model: { label: string; total: number; picks: RevealedPick[]; trainedThroughSeason: number };
  opponent:
    | ((BotOpponent | PlayerOpponent) & {
        total: number;
        /** null when the opponent forfeited without locking in. */
        picks: RevealedPick[] | null;
        outcome: "you" | "opponent" | "draw";
        decidedBy: DecidedBy;
      })
    | null;
  /** Present for ranked and friend duels. */
  match: MatchSummary | null;
};

/** A locked-in match seat whose result is not known yet. Carries no answer and no opponent pick. */
export type WaitingView = {
  duelId: string;
  mode: MatchMode;
  /** The opponent once someone has joined, else null. */
  opponent: PlayerOpponent | null;
  /** Epoch ms after which nobody new can join and the match settles without an opponent. */
  openUntil: number;
  /** Friend duels, creator only: the link to send, e.g. "/duel/join#invite=…". */
  invitePath: string | null;
  /** True for the creator while nobody has joined: they may stop waiting. */
  canStopWaiting: boolean;
};

/** GET /v1/duels/:id, and the submission response. */
export type DuelState =
  | { state: "open"; set: IssuedSet }
  | { state: "waiting"; waiting: WaitingView }
  | { state: "expired"; duelId: string; match: MatchSummary | null }
  | { state: "revealed"; result: DuelResult };

/** GET /v1/account `rating`: present once an account has played a rated duel. */
export type RatingView = { rating: number; ratedDuels: number; provisional: boolean };

export type ApiErrorBody = { error: string; message: string };

/** GET /v1/account. What the signed-in player sees about their own account. No email is ever returned. */
export type AccountView = {
  displayName: string | null;
  createdAt: number;
  /** Completed sets, including history merged from this browser's guest. */
  completedDuels: number;
  /** When the next rename is allowed (epoch ms), or null when a change is available now. */
  nextRenameAt: number | null;
  ranked: { eligible: boolean; minCompletedDuels: number; needsDisplayName: boolean };
  /** Null until the first rated duel. */
  rating: RatingView | null;
};

/** POST /v1/auth/verify */
export type SignInResult = { sessionToken: string; account: AccountView };
