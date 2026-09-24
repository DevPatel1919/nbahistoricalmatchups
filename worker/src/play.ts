// Guest play loop: issue a set, accept one submission, score it server-side,
// and reveal. Nothing answer-bearing is read into a response before lock.

import {
  BANDS,
  BOT_DISCLOSURE,
  BOT_DISPLAY_NAME,
  createRng,
  drawBotPicks,
  drawUnrankedSet,
  isConfidence,
  isEraKey,
  resolveDuel,
  sampleBotAccuracy,
  scoreModel,
  scoreSet,
  totalPoints,
  type Band,
  type Confidence,
  type DrawMode,
  type Pick,
  type PuzzleView,
  type RecentPick,
  type ScoredPick,
  type Side,
} from "../../frontend/src/duel";
import type { Participant } from "./auth";
import type { Env } from "./env";
import { ApiError } from "./http";
import { readIndex, readPuzzles, simIndexKey, toPuzzleView } from "./pool";
import { LIMITS, enforce } from "./ratelimit";
import { randomId, sign, verify } from "./tokens";

export const SET_TTL_MS = 20 * 60 * 1000;
export const MODEL_TRAINED_THROUGH_SEASON = 2021;

export type PlayMode = "solo" | "bot";

export type IssuedSet = {
  duelId: string;
  mode: PlayMode;
  draw: DrawMode;
  puzzles: PuzzleView[];
  setToken: string;
  expiresAt: number;
  opponent: { kind: "bot"; name: string; disclosure: string } | null;
};

export type RevealedPick = ScoredPick & { confidence: Confidence | null };

export type DuelResult = {
  duelId: string;
  mode: PlayMode;
  puzzles: { puzzleId: string; actualWinner: Side; modelInSample: boolean }[];
  you: { total: number; picks: RevealedPick[] };
  model: { label: string; total: number; picks: RevealedPick[]; trainedThroughSeason: number };
  opponent: {
    kind: "bot";
    name: string;
    disclosure: string;
    total: number;
    picks: RevealedPick[];
    outcome: "you" | "opponent" | "draw";
    decidedBy: "total" | "best-correct-call" | "draw";
  } | null;
};

type DuelRow = {
  id: string;
  mode: PlayMode;
  draw_kind: "random" | "era";
  draw_era: string | null;
  puzzle_ids: string;
  issued_to: string;
  issued_at: number;
  expires_at: number;
};

const BOT_OPPONENT = { kind: "bot" as const, name: BOT_DISPLAY_NAME, disclosure: BOT_DISCLOSURE };

function parseMode(value: unknown): PlayMode {
  if (value === "solo" || value === "bot") return value;
  throw new ApiError("bad_request");
}

function parseDraw(value: unknown): DrawMode {
  if (!value || typeof value !== "object") throw new ApiError("bad_request");
  const v = value as Record<string, unknown>;
  if (v.kind === "random") return { kind: "random" };
  if (v.kind === "era" && isEraKey(v.era)) return { kind: "era", era: v.era };
  throw new ApiError("bad_request");
}

function freshRng() {
  return createRng(randomId("seed", 16));
}

async function setToken(env: Env, participant: Participant, duelId: string, expiresAt: number): Promise<string> {
  return sign({ v: 1, typ: "set", sub: participant.id, duel: duelId, exp: expiresAt }, env.SET_TOKEN_SECRET);
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export async function issueSet(env: Env, participant: Participant, ipKey: string, body: unknown): Promise<IssuedSet> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const mode = parseMode(b.mode);
  const draw = parseDraw(b.draw);
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerParticipant, participant.id);
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerIp, ipKey);

  const era = draw.kind === "era" ? draw.era : "all";
  const indexes = await Promise.all(BANDS.map((band) => readIndex(env.POOL, simIndexKey(env.POOL_VERSION, era, band))));
  const byBand = Object.fromEntries(BANDS.map((band, i) => [band, indexes[i]])) as Record<Band, string[]>;
  const ids = drawUnrankedSet(byBand, freshRng());
  const puzzles = await readPuzzles(env.POOL, env.POOL_VERSION, ids);
  if (puzzles.some((p) => p.answer.partition !== "sim")) throw new ApiError("pool_unavailable");

  const duelId = randomId("d");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SET_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO duels (id, mode, partition, draw_kind, draw_era, puzzle_ids, pool_version, issued_to, issued_at, expires_at)
     VALUES (?, ?, 'sim', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(duelId, mode, draw.kind, draw.kind === "era" ? draw.era : null, JSON.stringify(ids), env.POOL_VERSION,
      participant.id, issuedAt, expiresAt)
    .run();

  return {
    duelId,
    mode,
    draw,
    puzzles: puzzles.map(toPuzzleView),
    setToken: await setToken(env, participant, duelId, expiresAt),
    expiresAt,
    opponent: mode === "bot" ? BOT_OPPONENT : null,
  };
}

// ---------------------------------------------------------------------------
// Read (for a refreshed page)
// ---------------------------------------------------------------------------

async function loadOwnDuel(env: Env, participant: Participant, duelId: string): Promise<DuelRow> {
  if (typeof duelId !== "string" || duelId.length > 64) throw new ApiError("not_found");
  const row = await env.DB.prepare("SELECT * FROM duels WHERE id = ?").bind(duelId).first<DuelRow>();
  // A duel issued to someone else is indistinguishable from a missing one.
  if (!row || row.issued_to !== participant.id) throw new ApiError("not_found");
  return row;
}

async function storedSubmission(env: Env, duelId: string, participant: Participant) {
  return env.DB.prepare("SELECT idempotency_key, result FROM submissions WHERE duel_id = ? AND participant = ?")
    .bind(duelId, participant.id)
    .first<{ idempotency_key: string; result: string }>();
}

export async function readDuel(env: Env, participant: Participant, duelId: string) {
  const duel = await loadOwnDuel(env, participant, duelId);
  const submitted = await storedSubmission(env, duelId, participant);
  if (submitted) return { state: "revealed" as const, result: JSON.parse(submitted.result) as DuelResult };
  if (Date.now() > duel.expires_at) return { state: "expired" as const, duelId };
  const ids = JSON.parse(duel.puzzle_ids) as string[];
  const puzzles = await readPuzzles(env.POOL, env.POOL_VERSION, ids);
  const set: IssuedSet = {
    duelId,
    mode: duel.mode,
    draw: duel.draw_kind === "era" && isEraKey(duel.draw_era) ? { kind: "era", era: duel.draw_era } : { kind: "random" },
    puzzles: puzzles.map(toPuzzleView),
    setToken: await setToken(env, participant, duelId, duel.expires_at),
    expiresAt: duel.expires_at,
    opponent: duel.mode === "bot" ? BOT_OPPONENT : null,
  };
  return { state: "open" as const, set };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

function parsePicks(value: unknown, ids: readonly string[]): Pick[] {
  if (!Array.isArray(value) || value.length !== ids.length) throw new ApiError("bad_request");
  const picks = value.map((raw): Pick => {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof p.puzzleId !== "string" || (p.side !== "home" && p.side !== "away") || !isConfidence(p.confidence)) {
      throw new ApiError("bad_request");
    }
    return { puzzleId: p.puzzleId, side: p.side, confidence: p.confidence };
  });
  const given = new Set(picks.map((p) => p.puzzleId));
  if (given.size !== ids.length || ids.some((id) => !given.has(id))) throw new ApiError("bad_request");
  return picks;
}

async function recentHistory(env: Env, participant: Participant): Promise<RecentPick[]> {
  const rows = await env.DB.prepare(
    `SELECT p.correct, p.confidence FROM scored_picks p
     JOIN submissions s ON s.duel_id = p.duel_id AND s.participant = p.participant
     WHERE p.participant = ? ORDER BY s.submitted_at DESC, p.position DESC LIMIT 20`,
  )
    .bind(participant.id)
    .all<{ correct: number; confidence: Confidence }>();
  return rows.results.reverse().map((r) => ({ correct: r.correct === 1, confidence: r.confidence }));
}

function withConfidence(scored: ScoredPick[], picks: readonly Pick[] | null): RevealedPick[] {
  return scored.map((s, i) => ({ ...s, confidence: picks ? picks[i].confidence : null }));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(error.message);
}

export async function submitPicks(
  env: Env,
  participant: Participant,
  duelId: string,
  idempotencyKey: string | null,
  body: unknown,
): Promise<DuelResult> {
  if (!idempotencyKey || idempotencyKey.length > 100) throw new ApiError("missing_idempotency_key");
  await enforce(env.RATE_LIMITS, LIMITS.submitPerParticipant, participant.id);

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const token = typeof b.setToken === "string" ? await verify(b.setToken, env.SET_TOKEN_SECRET) : null;
  if (!token || token.v !== 1 || token.typ !== "set" || token.sub !== participant.id || token.duel !== duelId) {
    throw new ApiError("set_token_invalid");
  }
  const duel = await loadOwnDuel(env, participant, duelId);

  // A retried request with the same key gets the original result back.
  const existing = await storedSubmission(env, duelId, participant);
  if (existing) {
    if (existing.idempotency_key === idempotencyKey) return JSON.parse(existing.result) as DuelResult;
    throw new ApiError("already_submitted");
  }
  const now = Date.now();
  if (typeof token.exp !== "number" || now > token.exp || now > duel.expires_at) throw new ApiError("set_expired");

  const ids = JSON.parse(duel.puzzle_ids) as string[];
  const byId = new Map(parsePicks(b.picks, ids).map((p) => [p.puzzleId, p]));
  const picks = ids.map((id) => byId.get(id) as Pick);
  const stored = await readPuzzles(env.POOL, env.POOL_VERSION, ids);
  const answers = stored.map((p) => p.answer);

  const you = scoreSet(picks, answers);
  const model = answers.map(scoreModel);
  let opponent: DuelResult["opponent"] = null;
  if (duel.mode === "bot") {
    const rng = freshRng();
    const history = await recentHistory(env, participant);
    const botPicks = drawBotPicks(answers, sampleBotAccuracy(history, rng), history, rng);
    const bot = scoreSet(botPicks, answers);
    const resolution = resolveDuel(you, bot);
    opponent = {
      ...BOT_OPPONENT,
      total: totalPoints(bot),
      picks: withConfidence(bot, botPicks),
      outcome: resolution.outcome === "a" ? "you" : resolution.outcome === "b" ? "opponent" : "draw",
      decidedBy: resolution.decidedBy,
    };
  }

  const result: DuelResult = {
    duelId,
    mode: duel.mode,
    puzzles: answers.map((a) => ({ puzzleId: a.puzzleId, actualWinner: a.actualWinner, modelInSample: a.modelInSample })),
    you: { total: totalPoints(you), picks: withConfidence(you, picks) },
    model: {
      label: "Pre-game model",
      total: totalPoints(model),
      picks: withConfidence(model, null),
      trainedThroughSeason: MODEL_TRAINED_THROUGH_SEASON,
    },
    opponent,
  };

  const statements = [
    env.DB.prepare(
      `INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(duelId, participant.id, idempotencyKey, now, now - duel.issued_at, result.you.total, JSON.stringify(result)),
    ...you.map((s, i) =>
      env.DB.prepare(
        `INSERT INTO scored_picks (duel_id, participant, puzzle_id, position, side, confidence, correct, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(duelId, participant.id, s.puzzleId, i, s.side, picks[i].confidence, s.correct ? 1 : 0, s.points),
    ),
    ...ids.map((id) =>
      env.DB.prepare("INSERT OR IGNORE INTO served_answers (puzzle_id, first_served_at) VALUES (?, ?)").bind(id, now),
    ),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost a race with a concurrent submission: the constraint decided.
    const winner = await storedSubmission(env, duelId, participant);
    if (winner && winner.idempotency_key === idempotencyKey) return JSON.parse(winner.result) as DuelResult;
    throw new ApiError("already_submitted");
  }
  return result;
}
