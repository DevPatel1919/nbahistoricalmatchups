// The play loop: issue a set, accept one submission per seat, score it
// server-side, and reveal. Nothing answer-bearing is read into a response
// before lock. Solo and bot sets reveal on submission; a ranked or friend seat
// (matches.ts) waits until its match resolves.

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
  type DuelResult,
  type DuelState,
  type IssuedSet,
  type Pick,
  type PlayMode,
  type RecentPick,
  type RevealedPick,
  type ScoredPick,
} from "../../frontend/src/duel";
import type { Participant } from "./auth";
import type { Env } from "./env";
import { ApiError } from "./http";
import { metricsStatement } from "./integrity";
import { matchState, settleMatch } from "./matches";
import { readIndex, readPuzzles, simIndexKey, toPuzzleView, type StoredPuzzle } from "./pool";
import { LIMITS, enforce } from "./ratelimit";
import { randomId, sign, verify } from "./tokens";

export const SET_TTL_MS = 20 * 60 * 1000;
export const MODEL_TRAINED_THROUGH_SEASON = 2021;

export type DuelRow = {
  id: string;
  mode: PlayMode;
  partition: "sim" | "ranked";
  draw_kind: "random" | "era";
  draw_era: string | null;
  puzzle_ids: string;
  issued_to: string;
  issued_at: number;
  expires_at: number;
  match_id: string | null;
};

export const BOT_OPPONENT = { kind: "bot" as const, name: BOT_DISPLAY_NAME, disclosure: BOT_DISCLOSURE };

function parseMode(value: unknown): "solo" | "bot" {
  if (value === "solo" || value === "bot") return value;
  throw new ApiError("bad_request");
}

export function parseDraw(value: unknown): DrawMode {
  if (!value || typeof value !== "object") throw new ApiError("bad_request");
  const v = value as Record<string, unknown>;
  if (v.kind === "random") return { kind: "random" };
  if (v.kind === "era" && isEraKey(v.era)) return { kind: "era", era: v.era };
  throw new ApiError("bad_request");
}

export function drawOf(row: { draw_kind: string; draw_era: string | null }): DrawMode {
  return row.draw_kind === "era" && isEraKey(row.draw_era) ? { kind: "era", era: row.draw_era } : { kind: "random" };
}

export function freshRng() {
  return createRng(randomId("seed", 16));
}

export async function setToken(env: Env, participant: Participant, duelId: string, expiresAt: number): Promise<string> {
  return sign({ v: 1, typ: "set", sub: participant.id, duel: duelId, exp: expiresAt }, env.SET_TOKEN_SECRET);
}

/** Five sim puzzle ids in the unranked composition, for a solo, bot, or friend set. */
export async function drawSimSet(env: Env, draw: DrawMode): Promise<{ ids: string[]; puzzles: StoredPuzzle[] }> {
  const era = draw.kind === "era" ? draw.era : "all";
  const indexes = await Promise.all(BANDS.map((band) => readIndex(env.POOL, simIndexKey(env.POOL_VERSION, era, band))));
  const byBand = Object.fromEntries(BANDS.map((band, i) => [band, indexes[i]])) as Record<Band, string[]>;
  const ids = drawUnrankedSet(byBand, freshRng());
  const puzzles = await readPuzzles(env.POOL, env.POOL_VERSION, ids);
  if (puzzles.some((p) => p.answer.partition !== "sim")) throw new ApiError("pool_unavailable");
  return { ids, puzzles };
}

// ---------------------------------------------------------------------------
// Issue (solo and bot; ranked and friend sets are issued by matches.ts)
// ---------------------------------------------------------------------------

export async function issueSet(env: Env, participant: Participant, ipKey: string, body: unknown): Promise<IssuedSet> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const mode = parseMode(b.mode);
  const draw = parseDraw(b.draw);
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerParticipant, participant.id, Number(env.RATE_LIMIT_SCALE));
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerIp, ipKey, Number(env.RATE_LIMIT_SCALE));

  const { ids, puzzles } = await drawSimSet(env, draw);
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

export async function loadOwnDuel(env: Env, participant: Participant, duelId: string): Promise<DuelRow> {
  if (typeof duelId !== "string" || duelId.length > 64) throw new ApiError("not_found");
  const row = await env.DB.prepare("SELECT * FROM duels WHERE id = ?").bind(duelId).first<DuelRow>();
  // A duel issued to someone else is indistinguishable from a missing one.
  if (!row || row.issued_to !== participant.id) throw new ApiError("not_found");
  return row;
}

export async function storedSubmission(env: Env, duelId: string, participant: Participant) {
  return env.DB.prepare("SELECT idempotency_key, result FROM submissions WHERE duel_id = ? AND participant = ?")
    .bind(duelId, participant.id)
    .first<{ idempotency_key: string; result: string }>();
}

export async function openSet(env: Env, participant: Participant, duel: DuelRow, opponent: IssuedSet["opponent"]): Promise<IssuedSet> {
  const puzzles = await readPuzzles(env.POOL, env.POOL_VERSION, JSON.parse(duel.puzzle_ids) as string[]);
  return {
    duelId: duel.id,
    mode: duel.mode,
    draw: drawOf(duel),
    puzzles: puzzles.map(toPuzzleView),
    setToken: await setToken(env, participant, duel.id, duel.expires_at),
    expiresAt: duel.expires_at,
    opponent,
  };
}

export async function readDuel(env: Env, participant: Participant, duelId: string): Promise<DuelState> {
  const duel = await loadOwnDuel(env, participant, duelId);
  if (duel.match_id) return matchState(env, participant, duel, Date.now());
  const submitted = await storedSubmission(env, duelId, participant);
  if (submitted) return { state: "revealed", result: JSON.parse(submitted.result) as DuelResult };
  if (Date.now() > duel.expires_at) return { state: "expired", duelId, match: null };
  return { state: "open", set: await openSet(env, participant, duel, duel.mode === "bot" ? BOT_OPPONENT : null) };
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

export async function recentHistory(env: Env, participant: string): Promise<RecentPick[]> {
  const rows = await env.DB.prepare(
    `SELECT p.correct, p.confidence FROM scored_picks p
     JOIN submissions s ON s.duel_id = p.duel_id AND s.participant = p.participant
     WHERE p.participant = ? ORDER BY s.submitted_at DESC, p.position DESC LIMIT 20`,
  )
    .bind(participant)
    .all<{ correct: number; confidence: Confidence }>();
  return rows.results.reverse().map((r) => ({ correct: r.correct === 1, confidence: r.confidence }));
}

/**
 * A set token names the participant it was issued to. A guest who signs in
 * mid-set becomes an account (accounts.ts re-keys the duel), so a token issued
 * to a guest merged into this same account still counts as theirs.
 */
async function tokenSubjectIs(env: Env, sub: unknown, participant: Participant): Promise<boolean> {
  if (sub === participant.id) return true;
  if (participant.kind !== "account" || typeof sub !== "string" || !sub.startsWith("g:")) return false;
  const merged = await env.DB.prepare("SELECT 1 FROM guests WHERE id = ? AND account_id = ?")
    .bind(sub.slice(2), participant.accountId)
    .first();
  return merged !== null;
}

export function withConfidence(scored: ScoredPick[], picks: readonly Pick[] | null): RevealedPick[] {
  return scored.map((s, i) => ({ ...s, confidence: picks ? picks[i].confidence : null }));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(error.message);
}

/** A seat's own result: its picks, the answers, and the model benchmark. No opponent yet. */
export function ownResult(duelId: string, mode: PlayMode, stored: StoredPuzzle[], picks: readonly Pick[]): DuelResult {
  const answers = stored.map((p) => p.answer);
  const you = scoreSet(picks, answers);
  const model = answers.map(scoreModel);
  return {
    duelId,
    mode,
    puzzles: stored.map((p) => ({
      puzzleId: p.answer.puzzleId,
      view: toPuzzleView(p),
      actualWinner: p.answer.actualWinner,
      modelInSample: p.answer.modelInSample,
    })),
    you: { total: totalPoints(you), picks: withConfidence(you, picks) },
    model: {
      label: "Pre-game model",
      total: totalPoints(model),
      picks: withConfidence(model, null),
      trainedThroughSeason: MODEL_TRAINED_THROUGH_SEASON,
    },
    opponent: null,
    match: null,
  };
}

/** The Sparring Partner's line against a result, drawn from the participant's recent accuracy. */
export async function botLine(env: Env, participant: string, stored: StoredPuzzle[], you: DuelResult["you"]): Promise<DuelResult["opponent"]> {
  const answers = stored.map((p) => p.answer);
  const rng = freshRng();
  const history = await recentHistory(env, participant);
  const botPicks = drawBotPicks(answers, sampleBotAccuracy(history, rng), history, rng);
  const bot = scoreSet(botPicks, answers);
  const resolution = resolveDuel(you.picks, bot);
  return {
    ...BOT_OPPONENT,
    total: totalPoints(bot),
    picks: withConfidence(bot, botPicks),
    outcome: resolution.outcome === "a" ? "you" : resolution.outcome === "b" ? "opponent" : "draw",
    decidedBy: resolution.decidedBy,
  };
}

/** Records that these answers have reached a client. */
export function servedStatements(env: Env, ids: readonly string[], now: number): D1PreparedStatement[] {
  return ids.map((id) =>
    env.DB.prepare("INSERT OR IGNORE INTO served_answers (puzzle_id, first_served_at) VALUES (?, ?)").bind(id, now),
  );
}

export async function submitPicks(
  env: Env,
  participant: Participant,
  duelId: string,
  idempotencyKey: string | null,
  body: unknown,
): Promise<DuelState> {
  if (!idempotencyKey || idempotencyKey.length > 100) throw new ApiError("missing_idempotency_key");
  await enforce(env.RATE_LIMITS, LIMITS.submitPerParticipant, participant.id, Number(env.RATE_LIMIT_SCALE));

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const token = typeof b.setToken === "string" ? await verify(b.setToken, env.SET_TOKEN_SECRET) : null;
  if (!token || token.v !== 1 || token.typ !== "set" || token.duel !== duelId || !(await tokenSubjectIs(env, token.sub, participant))) {
    throw new ApiError("set_token_invalid");
  }
  const duel = await loadOwnDuel(env, participant, duelId);

  // A retried request with the same key gets the current state back: the
  // original result, or for a match seat, waiting or the final result.
  const existing = await storedSubmission(env, duelId, participant);
  if (existing) {
    if (existing.idempotency_key !== idempotencyKey) throw new ApiError("already_submitted");
    return duel.match_id ? matchState(env, participant, duel, Date.now()) : { state: "revealed", result: JSON.parse(existing.result) as DuelResult };
  }
  const now = Date.now();
  if (typeof token.exp !== "number" || now > token.exp || now > duel.expires_at) throw new ApiError("set_expired");

  const ids = JSON.parse(duel.puzzle_ids) as string[];
  const byId = new Map(parsePicks(b.picks, ids).map((p) => [p.puzzleId, p]));
  const picks = ids.map((id) => byId.get(id) as Pick);
  const stored = await readPuzzles(env.POOL, env.POOL_VERSION, ids);
  const result = ownResult(duelId, duel.mode, stored, picks);
  if (duel.mode === "bot") result.opponent = await botLine(env, participant.id, stored, result.you);
  const scored = result.you.picks;

  // A match seat stores its own result for now; nothing is revealed until the
  // match resolves, which rewrites it. The duel_id guard makes the insert fail
  // (NOT NULL) if the match has already resolved, so a late lock-in cannot land
  // in a settled match.
  const submission = duel.match_id
    ? env.DB.prepare(
        `INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result)
         VALUES ((SELECT ? WHERE NOT EXISTS (SELECT 1 FROM match_resolutions WHERE match_id = ?)), ?, ?, ?, ?, ?, ?)`,
      ).bind(duelId, duel.match_id, participant.id, idempotencyKey, now, now - duel.issued_at, result.you.total, JSON.stringify(result))
    : env.DB.prepare(
        `INSERT INTO submissions (duel_id, participant, idempotency_key, submitted_at, ms_to_submit, total_points, result)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(duelId, participant.id, idempotencyKey, now, now - duel.issued_at, result.you.total, JSON.stringify(result));
  const statements = [
    submission,
    ...scored.map((s, i) =>
      env.DB.prepare(
        `INSERT INTO scored_picks (duel_id, participant, puzzle_id, position, side, confidence, correct, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(duelId, participant.id, s.puzzleId, i, s.side, picks[i].confidence, s.correct ? 1 : 0, s.points),
    ),
    // A match seat's answers are served when the match resolves, not now.
    ...(duel.match_id ? [] : servedStatements(env, ids, now)),
    // Anomaly metrics for every rated seat (Session 7).
    ...(duel.mode === "ranked" && participant.kind === "account"
      ? [metricsStatement(env, duelId, participant.id, participant.accountId, now, now - duel.issued_at, picks, stored, result)]
      : []),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (duel.match_id && error instanceof Error && /NOT NULL constraint failed: submissions\.duel_id/i.test(error.message)) {
      throw new ApiError("set_expired");
    }
    if (!isUniqueViolation(error)) throw error;
    // Lost a race with a concurrent submission: the constraint decided.
    const winner = await storedSubmission(env, duelId, participant);
    if (!winner || winner.idempotency_key !== idempotencyKey) throw new ApiError("already_submitted");
    return duel.match_id ? matchState(env, participant, duel, Date.now()) : { state: "revealed", result: JSON.parse(winner.result) as DuelResult };
  }
  if (!duel.match_id) return { state: "revealed", result };
  await settleMatch(env, duel.match_id, now);
  return matchState(env, participant, duel, now);
}
