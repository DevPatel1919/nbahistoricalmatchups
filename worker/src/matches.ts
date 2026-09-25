// Ranked and friend duels (F09 Session 6). Two seats share one puzzle set, a
// "match". The creator plays and locks in first; the match then waits for an
// opponent, who receives the identical set. Nobody sees an answer or the other
// seat's picks until the match resolves, and only human-vs-human ranked matches
// move rating.
//
// Timeout rules (documented in the F09 brief):
//   - A seat has SET_TTL_MS from being issued to lock in. A creator who never
//     locks in leaves a match nobody can join; nothing is revealed or rated.
//   - An opponent who joins but does not lock in before their set expires
//     forfeits: the creator wins. In ranked that result is rated.
//   - If nobody joins before open_until (24 hours), or the creator stops
//     waiting, the match settles with no opponent: ranked scores the creator
//     against the disclosed Sparring Partner, unrated; friend reveals solo.
//
// Integrity rules are D1 constraints, not application checks: one opponent seat
// per match (primary key), one resolution per match (primary key), one rating
// change per account per match (primary key), and a rating change only from
// the rating it was computed against (NOT NULL guard, see 0003_ranked.sql).
// Several inserts take a value from a subquery that is NULL when a race has
// been lost; the NOT NULL constraint then fails the whole batch.

import {
  ELO_START,
  PUZZLES_PER_SET,
  applyElo,
  drawRankedSet,
  resolveDuel,
  type DrawMode,
  type DuelResult,
  type DuelState,
  type IssuedSet,
  type MatchMode,
  type MatchSettlement,
  type MatchSummary,
  type Pick,
  type PlayerOpponent,
  type RatingChange,
  type WaitingView,
} from "../../frontend/src/duel";
import { assertRankedEligible } from "./accounts";
import type { Participant } from "./auth";
import type { Env } from "./env";
import { ApiError } from "./http";
import {
  SET_TTL_MS,
  botLine,
  drawSimSet,
  freshRng,
  loadOwnDuel,
  openSet,
  ownResult,
  parseDraw,
  servedStatements,
  storedSubmission,
  type DuelRow,
} from "./play";
import { rankedIndexKey, readIndex, readPuzzles, type StoredPuzzle } from "./pool";
import { LIMITS, enforce } from "./ratelimit";
import { randomId, sign, verify } from "./tokens";

/** How long a locked-in ranked set waits for an opponent. */
export const RANKED_MATCH_WAIT_MS = 24 * 60 * 60 * 1000;
/** How long a friend invite can be accepted. */
export const FRIEND_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** Owner decision (limited reuse): a revealed ranked puzzle is not issued again for this long. */
export const RANKED_REUSE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/** Unresolved ranked matches one account may have created at once. */
export const RANKED_MAX_WAITING = 3;
/** Two accounts are not matched against each other again within this window. */
export const REPEAT_PAIR_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Allowed rating gap: starts narrow and widens the longer a match has waited. */
export const RATING_WINDOW = { base: 100, perHour: 50, max: 400 };
/** Label for a friend-duel player without a display name. */
export const FRIEND_FALLBACK_NAME = "Your friend";

const SETTLE_ATTEMPTS = 5;

type MatchRow = {
  id: string;
  kind: MatchMode;
  puzzle_ids: string;
  pool_version: string;
  draw_kind: "random" | "era";
  draw_era: string | null;
  creator_rating: number | null;
  created_at: number;
  open_until: number;
};

type SeatRow = {
  seat: "creator" | "opponent";
  participant: string;
  duel_id: string;
  expires_at: number;
  submitted_at: number | null;
};

type RatingRow = { rating: number; rated_duels: number };

function accountIdOf(participant: string): string | null {
  return participant.startsWith("a:") ? participant.slice(2) : null;
}

function isConstraint(error: unknown, pattern: RegExp): boolean {
  return error instanceof Error && pattern.test(error.message);
}

async function displayName(env: Env, participant: string): Promise<string> {
  const accountId = accountIdOf(participant);
  if (!accountId) return FRIEND_FALLBACK_NAME;
  const row = await env.DB.prepare("SELECT display_name FROM accounts WHERE id = ?").bind(accountId).first<{ display_name: string | null }>();
  return row?.display_name ?? FRIEND_FALLBACK_NAME;
}

async function currentRating(env: Env, accountId: string): Promise<RatingRow> {
  const row = await env.DB.prepare("SELECT rating, rated_duels FROM ratings WHERE account_id = ?").bind(accountId).first<RatingRow>();
  return row ?? { rating: ELO_START, rated_duels: 0 };
}

async function loadMatch(env: Env, matchId: string): Promise<MatchRow | null> {
  return env.DB.prepare("SELECT * FROM matches WHERE id = ?").bind(matchId).first<MatchRow>();
}

async function loadSeats(env: Env, matchId: string): Promise<{ creator: SeatRow | undefined; opponent: SeatRow | undefined }> {
  const rows = await env.DB.prepare(
    `SELECT ms.seat, ms.participant, ms.duel_id, d.expires_at, s.submitted_at FROM match_seats ms
     JOIN duels d ON d.id = ms.duel_id
     LEFT JOIN submissions s ON s.duel_id = ms.duel_id AND s.participant = ms.participant
     WHERE ms.match_id = ?`,
  )
    .bind(matchId)
    .all<SeatRow>();
  return {
    creator: rows.results.find((r) => r.seat === "creator"),
    opponent: rows.results.find((r) => r.seat === "opponent"),
  };
}

async function seatPicks(env: Env, seat: SeatRow): Promise<Pick[]> {
  const rows = await env.DB.prepare(
    "SELECT puzzle_id, side, confidence FROM scored_picks WHERE duel_id = ? AND participant = ? ORDER BY position",
  )
    .bind(seat.duel_id, seat.participant)
    .all<{ puzzle_id: string; side: Pick["side"]; confidence: Pick["confidence"] }>();
  return rows.results.map((r) => ({ puzzleId: r.puzzle_id, side: r.side, confidence: r.confidence }));
}

function exposureStatements(env: Env, accountId: string, ids: readonly string[], now: number): D1PreparedStatement[] {
  return ids.map((id) =>
    env.DB.prepare("INSERT OR IGNORE INTO ranked_exposures (account_id, puzzle_id, shown_at) VALUES (?, ?, ?)").bind(accountId, id, now),
  );
}

// ---------------------------------------------------------------------------
// Invites (friend duels)
// ---------------------------------------------------------------------------

/**
 * A friend invite is a signed match id, so nothing extra is stored and the
 * creator can be shown the same link again. It rides in the URL fragment, so
 * it never reaches a server log.
 */
async function inviteToken(env: Env, matchId: string): Promise<string> {
  return sign({ v: 1, typ: "invite", match: matchId }, env.SET_TOKEN_SECRET);
}

export function invitePath(token: string): string {
  return "/duel/join#invite=" + token;
}

// ---------------------------------------------------------------------------
// Creating and joining
// ---------------------------------------------------------------------------

async function createMatch(
  env: Env,
  participant: Participant,
  kind: MatchMode,
  draw: DrawMode,
  ids: string[],
  creatorRating: number | null,
  now: number,
): Promise<IssuedSet> {
  const matchId = randomId("m");
  const duelId = randomId("d");
  const expiresAt = now + SET_TTL_MS;
  const openUntil = now + (kind === "ranked" ? RANKED_MATCH_WAIT_MS : FRIEND_INVITE_TTL_MS);
  const drawEra = draw.kind === "era" ? draw.era : null;
  const statements = [
    env.DB.prepare(
      `INSERT INTO matches (id, kind, puzzle_ids, pool_version, draw_kind, draw_era, creator_rating, created_at, open_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(matchId, kind, JSON.stringify(ids), env.POOL_VERSION, draw.kind, drawEra, creatorRating, now, openUntil),
    env.DB.prepare(
      `INSERT INTO duels (id, mode, partition, draw_kind, draw_era, puzzle_ids, pool_version, issued_to, issued_at, expires_at, match_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(duelId, kind, kind === "ranked" ? "ranked" : "sim", draw.kind, drawEra, JSON.stringify(ids), env.POOL_VERSION,
      participant.id, now, expiresAt, matchId),
    env.DB.prepare("INSERT INTO match_seats (match_id, seat, participant, duel_id, joined_at) VALUES (?, 'creator', ?, ?, ?)")
      .bind(matchId, participant.id, duelId, now),
    ...(participant.kind === "account" && kind === "ranked" ? exposureStatements(env, participant.accountId, ids, now) : []),
  ];
  await env.DB.batch(statements);
  const duel = await env.DB.prepare("SELECT * FROM duels WHERE id = ?").bind(duelId).first<DuelRow>();
  if (!duel) throw new Error("duel missing after create");
  return openSet(env, participant, duel, null);
}

/**
 * Takes the opponent seat of a match with the identical puzzle set, or returns
 * null when the seat is gone: taken, the match resolved or closed, the creator
 * has not locked in, or this participant is already seated. The seat insert's
 * match_id is NULL in every one of those cases, so the batch fails as a whole
 * and no orphan duel row is left behind.
 */
async function joinMatch(env: Env, participant: Participant, match: MatchRow, now: number): Promise<IssuedSet | null> {
  const duelId = randomId("d");
  const ids = JSON.parse(match.puzzle_ids) as string[];
  const statements = [
    env.DB.prepare(
      `INSERT INTO duels (id, mode, partition, draw_kind, draw_era, puzzle_ids, pool_version, issued_to, issued_at, expires_at, match_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(duelId, match.kind, match.kind === "ranked" ? "ranked" : "sim", match.draw_kind, match.draw_era, match.puzzle_ids,
      match.pool_version, participant.id, now, now + SET_TTL_MS, match.id),
    env.DB.prepare(
      `INSERT INTO match_seats (match_id, seat, participant, duel_id, joined_at) VALUES (
         (SELECT m.id FROM matches m WHERE m.id = ? AND m.open_until > ?
            AND NOT EXISTS (SELECT 1 FROM match_resolutions r WHERE r.match_id = m.id)
            AND NOT EXISTS (SELECT 1 FROM match_seats s WHERE s.match_id = m.id AND s.participant = ?)
            AND EXISTS (SELECT 1 FROM match_seats c JOIN submissions x ON x.duel_id = c.duel_id AND x.participant = c.participant
                        WHERE c.match_id = m.id AND c.seat = 'creator')),
         'opponent', ?, ?, ?)`,
    ).bind(match.id, now, participant.id, participant.id, duelId, now),
    ...(participant.kind === "account" && match.kind === "ranked" ? exposureStatements(env, participant.accountId, ids, now) : []),
  ];
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isConstraint(error, /NOT NULL constraint failed: match_seats\.match_id|UNIQUE constraint failed: match_seats|PRIMARY KEY/i)) return null;
    throw error;
  }
  const duel = await env.DB.prepare("SELECT * FROM duels WHERE id = ?").bind(duelId).first<DuelRow>();
  if (!duel) throw new Error("duel missing after join");
  const seats = await loadSeats(env, match.id);
  const opponent: PlayerOpponent = { kind: "player", name: await displayName(env, seats.creator?.participant ?? "") };
  return openSet(env, participant, duel, opponent);
}

/** Oldest-first ranked matches this account may join, within the (widening) rating window. */
async function joinRankedQueue(env: Env, participant: Participant & { kind: "account" }, rating: number, exposed: Set<string>, now: number) {
  const candidates = await env.DB.prepare(
    `SELECT m.* FROM matches m
     JOIN match_seats c ON c.match_id = m.id AND c.seat = 'creator'
     JOIN submissions s ON s.duel_id = c.duel_id AND s.participant = c.participant
     WHERE m.kind = 'ranked' AND m.pool_version = ? AND m.open_until > ? AND c.participant != ?
       AND NOT EXISTS (SELECT 1 FROM match_seats o WHERE o.match_id = m.id AND o.seat = 'opponent')
       AND NOT EXISTS (SELECT 1 FROM match_resolutions r WHERE r.match_id = m.id)
       AND ABS(m.creator_rating - ?) <= MIN(?, ? + ((? - m.created_at) / 3600000) * ?)
       AND c.participant NOT IN (
         SELECT other.participant FROM match_seats mine
         JOIN match_seats other ON other.match_id = mine.match_id AND other.seat != mine.seat
         JOIN matches pm ON pm.id = mine.match_id AND pm.kind = 'ranked'
         WHERE mine.participant = ? AND mine.joined_at > ?)
     ORDER BY m.created_at LIMIT 20`,
  )
    .bind(env.POOL_VERSION, now, participant.id, rating, RATING_WINDOW.max, RATING_WINDOW.base, now, RATING_WINDOW.perHour,
      participant.id, now - REPEAT_PAIR_WINDOW_MS)
    .all<MatchRow>();
  for (const match of candidates.results) {
    // Never a puzzle this account has already been shown.
    if ((JSON.parse(match.puzzle_ids) as string[]).some((id) => exposed.has(id))) continue;
    const set = await joinMatch(env, participant, match, now);
    if (set) return set;
  }
  return null;
}

/**
 * POST /v1/sets { mode: "ranked" }. Joins the oldest waiting ranked match the
 * account qualifies for; otherwise deals a new set from the ranked partition,
 * which waits for an opponent once locked in.
 */
export async function startRanked(env: Env, participant: Participant, ipKey: string): Promise<IssuedSet> {
  await assertRankedEligible(env, participant);
  if (participant.kind !== "account") throw new ApiError("account_required");
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerParticipant, participant.id, Number(env.RATE_LIMIT_SCALE));
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerIp, ipKey, Number(env.RATE_LIMIT_SCALE));
  const now = Date.now();
  const { rating } = await currentRating(env, participant.accountId);
  const exposedRows = await env.DB.prepare("SELECT puzzle_id FROM ranked_exposures WHERE account_id = ?")
    .bind(participant.accountId)
    .all<{ puzzle_id: string }>();
  const exposed = new Set(exposedRows.results.map((r) => r.puzzle_id));

  const joined = await joinRankedQueue(env, participant, rating, exposed, now);
  if (joined) return joined;

  const waiting = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM matches m
     JOIN match_seats c ON c.match_id = m.id AND c.seat = 'creator'
     JOIN duels d ON d.id = c.duel_id
     WHERE c.participant = ? AND m.kind = 'ranked' AND m.open_until > ?
       AND NOT EXISTS (SELECT 1 FROM match_resolutions r WHERE r.match_id = m.id)
       AND (d.expires_at > ? OR EXISTS (SELECT 1 FROM submissions s WHERE s.duel_id = d.id AND s.participant = c.participant))`,
  )
    .bind(participant.id, now, now)
    .first<{ n: number }>();
  if ((waiting?.n ?? 0) >= RANKED_MAX_WAITING) throw new ApiError("ranked_queue_full");

  const [index, cooling] = await Promise.all([
    readIndex(env.POOL, rankedIndexKey(env.POOL_VERSION, "all")),
    env.DB.prepare("SELECT puzzle_id FROM ranked_reveals WHERE last_revealed_at > ?")
      .bind(now - RANKED_REUSE_COOLDOWN_MS)
      .all<{ puzzle_id: string }>(),
  ]);
  const coolingIds = new Set(cooling.results.map((r) => r.puzzle_id));
  const unused = index.filter((id) => !exposed.has(id) && !coolingIds.has(id));
  if (unused.length < PUZZLES_PER_SET) throw new ApiError("ranked_exhausted");
  const ids = drawRankedSet(unused, freshRng());
  const puzzles = await readPuzzles(env.POOL, env.POOL_VERSION, ids);
  if (puzzles.some((p) => p.answer.partition !== "ranked")) throw new ApiError("pool_unavailable");
  return createMatch(env, participant, "ranked", { kind: "random" }, ids, rating, now);
}

/** POST /v1/sets { mode: "friend", draw }. Open to guests; unrated. The invite link appears once the creator locks in. */
export async function startFriend(env: Env, participant: Participant, ipKey: string, body: unknown): Promise<IssuedSet> {
  const draw = parseDraw((body as { draw?: unknown } | null)?.draw);
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerParticipant, participant.id, Number(env.RATE_LIMIT_SCALE));
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerIp, ipKey, Number(env.RATE_LIMIT_SCALE));
  const { ids } = await drawSimSet(env, draw);
  return createMatch(env, participant, "friend", draw, ids, null, Date.now());
}

/**
 * POST /v1/invites/accept { invite }. Seats the caller in a friend match. A
 * caller who already holds the seat gets their duel id back, so reopening the
 * link is harmless.
 */
export async function acceptInvite(
  env: Env,
  participant: Participant,
  ipKey: string,
  body: unknown,
): Promise<{ duelId: string; set: IssuedSet | null }> {
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerParticipant, participant.id, Number(env.RATE_LIMIT_SCALE));
  await enforce(env.RATE_LIMITS, LIMITS.setIssuePerIp, ipKey, Number(env.RATE_LIMIT_SCALE));
  const raw = (body as { invite?: unknown } | null)?.invite;
  const token = typeof raw === "string" ? await verify(raw, env.SET_TOKEN_SECRET) : null;
  if (!token || token.v !== 1 || token.typ !== "invite" || typeof token.match !== "string") throw new ApiError("invite_unavailable");
  const match = await loadMatch(env, token.match);
  if (!match || match.kind !== "friend" || match.pool_version !== env.POOL_VERSION) throw new ApiError("invite_unavailable");
  const seats = await loadSeats(env, match.id);
  if (seats.creator?.participant === participant.id) throw new ApiError("invite_own");
  if (seats.opponent?.participant === participant.id) return { duelId: seats.opponent.duel_id, set: null };
  const set = await joinMatch(env, participant, match, Date.now());
  if (!set) throw new ApiError("invite_unavailable");
  return { duelId: set.duelId, set };
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

function playerLine(
  name: string,
  theirs: DuelResult["you"] | null,
  outcome: "you" | "opponent" | "draw",
  decidedBy: "total" | "best-correct-call" | "draw" | "forfeit",
): NonNullable<DuelResult["opponent"]> {
  return { kind: "player", name, total: theirs?.total ?? 0, picks: theirs?.picks ?? null, outcome, decidedBy };
}

type Settled = "done" | "retry";

async function trySettle(env: Env, matchId: string, now: number, stopWaiting: boolean): Promise<Settled> {
  const match = await loadMatch(env, matchId);
  if (!match) return "done";
  if (await env.DB.prepare("SELECT 1 FROM match_resolutions WHERE match_id = ?").bind(matchId).first()) return "done";
  const { creator, opponent } = await loadSeats(env, matchId);
  // A creator still picking, or one who never locked in, leaves nothing to settle:
  // such a match can never be joined and nothing was revealed.
  if (!creator || creator.submitted_at === null) return "done";

  let settledBy: MatchSettlement;
  if (!opponent) {
    if (now < match.open_until && !stopWaiting) return "done";
    settledBy = "no-opponent";
  } else if (opponent.submitted_at !== null) {
    settledBy = "both-locked";
  } else if (now > opponent.expires_at) {
    settledBy = "forfeit";
  } else {
    return "done";
  }

  const ids = JSON.parse(match.puzzle_ids) as string[];
  const stored: StoredPuzzle[] = await readPuzzles(env.POOL, match.pool_version, ids);
  const creatorResult = ownResult(creator.duel_id, match.kind, stored, await seatPicks(env, creator));
  let opponentResult: DuelResult | null = null;
  let outcome: "creator" | "opponent" | "draw" | "none" = "none";

  if (settledBy === "no-opponent") {
    // Ranked falls back to the disclosed Sparring Partner, unrated; a friend duel reveals solo.
    if (match.kind === "ranked") creatorResult.opponent = await botLine(env, creator.participant, stored, creatorResult.you);
  } else if (settledBy === "both-locked" && opponent) {
    opponentResult = ownResult(opponent.duel_id, match.kind, stored, await seatPicks(env, opponent));
    const r = resolveDuel(creatorResult.you.picks, opponentResult.you.picks);
    outcome = r.outcome === "a" ? "creator" : r.outcome === "b" ? "opponent" : "draw";
    const [creatorName, opponentName] = await Promise.all([displayName(env, creator.participant), displayName(env, opponent.participant)]);
    const forCreator = outcome === "creator" ? "you" : outcome === "opponent" ? "opponent" : "draw";
    const forOpponent = outcome === "opponent" ? "you" : outcome === "creator" ? "opponent" : "draw";
    creatorResult.opponent = playerLine(opponentName, opponentResult.you, forCreator, r.decidedBy);
    opponentResult.opponent = playerLine(creatorName, creatorResult.you, forOpponent, r.decidedBy);
  } else if (opponent) {
    outcome = "creator";
    creatorResult.opponent = playerLine(await displayName(env, opponent.participant), null, "you", "forfeit");
  }

  const rated = match.kind === "ranked" && settledBy !== "no-opponent";
  const statements: D1PreparedStatement[] = [];

  // The resolution row. For the two timeout rules its match_id comes from a
  // subquery that is NULL if the situation changed after it was read (someone
  // joined, or the opponent locked in after all), which fails the batch.
  if (settledBy === "no-opponent") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at) VALUES (
           (SELECT id FROM matches WHERE id = ? AND NOT EXISTS (SELECT 1 FROM match_seats WHERE match_id = ? AND seat = 'opponent')),
           ?, ?, ?, ?)`,
      ).bind(matchId, matchId, settledBy, outcome, rated ? 1 : 0, now),
    );
  } else if (settledBy === "forfeit" && opponent) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at) VALUES (
           (SELECT ? WHERE NOT EXISTS (SELECT 1 FROM submissions WHERE duel_id = ? AND participant = ?)),
           ?, ?, ?, ?)`,
      ).bind(matchId, opponent.duel_id, opponent.participant, settledBy, outcome, rated ? 1 : 0, now),
    );
  } else {
    statements.push(
      env.DB.prepare("INSERT INTO match_resolutions (match_id, settled_by, outcome, rated, resolved_at) VALUES (?, ?, ?, ?, ?)")
        .bind(matchId, settledBy, outcome, rated ? 1 : 0, now),
    );
  }

  const changes = new Map<string, RatingChange>();
  if (rated && opponent) {
    const a = accountIdOf(creator.participant);
    const b = accountIdOf(opponent.participant);
    if (!a || !b) throw new Error("ranked seat without an account");
    await env.DB.batch(
      [a, b].map((id) =>
        env.DB.prepare("INSERT OR IGNORE INTO ratings (account_id, rating, rated_duels, updated_at) VALUES (?, ?, 0, ?)").bind(id, ELO_START, now),
      ),
    );
    const [ra, rb] = await Promise.all([currentRating(env, a), currentRating(env, b)]);
    const elo = applyElo(
      { rating: ra.rating, ratedDuels: ra.rated_duels },
      { rating: rb.rating, ratedDuels: rb.rated_duels },
      outcome === "creator" ? "a" : outcome === "opponent" ? "b" : "draw",
    );
    const deltaB = -elo.deltaA + 0;
    changes.set(creator.participant, { before: ra.rating, after: elo.ratingA, delta: elo.deltaA, k: elo.k });
    changes.set(opponent.participant, { before: rb.rating, after: elo.ratingB, delta: deltaB, k: elo.k });
    for (const [accountId, row, change] of [
      [a, ra, changes.get(creator.participant)!],
      [b, rb, changes.get(opponent.participant)!],
    ] as const) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO rating_changes (match_id, account_id, rating_before, rating_after, delta, k, rated_duels_before, created_at)
           VALUES (?, ?, (SELECT rating FROM ratings WHERE account_id = ? AND rating = ? AND rated_duels = ?), ?, ?, ?, ?, ?)`,
        ).bind(matchId, accountId, accountId, row.rating, row.rated_duels, change.after, change.delta, change.k, row.rated_duels, now),
        env.DB.prepare("UPDATE ratings SET rating = ?, rated_duels = rated_duels + 1, updated_at = ? WHERE account_id = ?")
          .bind(change.after, now, accountId),
      );
    }
  }

  const summary = (participant: string): MatchSummary => ({ settledBy, rated, rating: changes.get(participant) ?? null });
  creatorResult.match = summary(creator.participant);
  statements.push(
    env.DB.prepare("UPDATE submissions SET result = ? WHERE duel_id = ? AND participant = ?")
      .bind(JSON.stringify(creatorResult), creator.duel_id, creator.participant),
  );
  if (opponentResult && opponent) {
    opponentResult.match = summary(opponent.participant);
    statements.push(
      env.DB.prepare("UPDATE submissions SET result = ? WHERE duel_id = ? AND participant = ?")
        .bind(JSON.stringify(opponentResult), opponent.duel_id, opponent.participant),
    );
  }
  // The answers reach a client now.
  statements.push(...servedStatements(env, ids, now));
  if (match.kind === "ranked") {
    statements.push(
      ...ids.map((id) =>
        env.DB.prepare(
          `INSERT INTO ranked_reveals (puzzle_id, last_revealed_at) VALUES (?, ?)
           ON CONFLICT (puzzle_id) DO UPDATE SET last_revealed_at = MAX(last_revealed_at, excluded.last_revealed_at)`,
        ).bind(id, now),
      ),
    );
  }

  try {
    await env.DB.batch(statements);
  } catch (error) {
    // Another settle won, the situation changed, or a rating moved underneath
    // us. Re-read everything and decide again.
    if (isConstraint(error, /match_resolutions|rating_changes\.rating_before/i)) return "retry";
    throw error;
  }
  return "done";
}

/**
 * Resolves a match if one of the rules above says it is due. Safe to call any
 * number of times from anywhere: the submission path, a read, stop-waiting,
 * and the scheduled sweep.
 */
export async function settleMatch(env: Env, matchId: string, now: number, stopWaiting = false): Promise<void> {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    if ((await trySettle(env, matchId, now, stopWaiting)) === "done") return;
  }
  // Left for the next read or sweep; the constraints guarantee it settles once.
  console.error("duel-api settle contention");
}

/** Scheduled sweep: settles matches whose timeout has passed even if nobody looks at them. */
export async function settleDue(env: Env, now: number, limit = 50): Promise<number> {
  const due = await env.DB.prepare(
    `SELECT m.id FROM matches m
     JOIN match_seats c ON c.match_id = m.id AND c.seat = 'creator'
     JOIN submissions cs ON cs.duel_id = c.duel_id AND cs.participant = c.participant
     LEFT JOIN match_seats o ON o.match_id = m.id AND o.seat = 'opponent'
     LEFT JOIN duels od ON od.id = o.duel_id
     WHERE NOT EXISTS (SELECT 1 FROM match_resolutions r WHERE r.match_id = m.id)
       AND ((o.match_id IS NULL AND m.open_until <= ?)
         OR (o.match_id IS NOT NULL AND od.expires_at < ?)
         OR EXISTS (SELECT 1 FROM submissions os WHERE os.duel_id = o.duel_id AND os.participant = o.participant))
     ORDER BY m.created_at LIMIT ?`,
  )
    .bind(now, now, limit)
    .all<{ id: string }>();
  for (const row of due.results) await settleMatch(env, row.id, now);
  return due.results.length;
}

// ---------------------------------------------------------------------------
// Reading a seat
// ---------------------------------------------------------------------------

async function ratingChangeFor(env: Env, matchId: string, participant: string): Promise<RatingChange | null> {
  const accountId = accountIdOf(participant);
  if (!accountId) return null;
  const row = await env.DB.prepare(
    "SELECT rating_before, rating_after, delta, k FROM rating_changes WHERE match_id = ? AND account_id = ?",
  )
    .bind(matchId, accountId)
    .first<{ rating_before: number; rating_after: number; delta: number; k: number }>();
  return row ? { before: row.rating_before, after: row.rating_after, delta: row.delta, k: row.k } : null;
}

/** The state of a ranked or friend seat. Settles the match first if it is due. */
export async function matchState(env: Env, participant: Participant, duel: DuelRow, now: number): Promise<DuelState> {
  const matchId = duel.match_id as string;
  await settleMatch(env, matchId, now);
  const [match, own, resolution, seats] = await Promise.all([
    loadMatch(env, matchId),
    storedSubmission(env, duel.id, participant),
    env.DB.prepare("SELECT settled_by, rated FROM match_resolutions WHERE match_id = ?")
      .bind(matchId)
      .first<{ settled_by: MatchSettlement; rated: number }>(),
    loadSeats(env, matchId),
  ]);
  if (!match) throw new ApiError("not_found");
  const mine = seats.creator?.duel_id === duel.id ? "creator" : "opponent";
  const other = mine === "creator" ? seats.opponent : seats.creator;

  if (resolution) {
    if (own) return { state: "revealed", result: JSON.parse(own.result) as DuelResult };
    // A seat that never locked in: an opponent who forfeited.
    return {
      state: "expired",
      duelId: duel.id,
      match: { settledBy: resolution.settled_by, rated: resolution.rated === 1, rating: await ratingChangeFor(env, matchId, participant.id) },
    };
  }
  if (own) {
    const waiting: WaitingView = {
      duelId: duel.id,
      mode: match.kind,
      opponent: other ? { kind: "player", name: await displayName(env, other.participant) } : null,
      openUntil: match.open_until,
      invitePath: match.kind === "friend" && mine === "creator" ? invitePath(await inviteToken(env, matchId)) : null,
      canStopWaiting: mine === "creator" && !other,
    };
    return { state: "waiting", waiting };
  }
  if (now > duel.expires_at) return { state: "expired", duelId: duel.id, match: null };
  const opponent: PlayerOpponent | null = mine === "opponent" && other ? { kind: "player", name: await displayName(env, other.participant) } : null;
  return { state: "open", set: await openSet(env, participant, duel, opponent) };
}

/**
 * POST /v1/duels/:id/stop-waiting. The creator of a locked-in match nobody has
 * joined settles it now: ranked against the Sparring Partner (unrated), friend
 * solo. Refused once an opponent has joined.
 */
export async function stopWaiting(env: Env, participant: Participant, duelId: string): Promise<DuelState> {
  const duel = await loadOwnDuel(env, participant, duelId);
  if (!duel.match_id) throw new ApiError("not_waiting");
  const seat = await env.DB.prepare("SELECT seat FROM match_seats WHERE duel_id = ?").bind(duelId).first<{ seat: string }>();
  if (seat?.seat !== "creator" || !(await storedSubmission(env, duelId, participant))) throw new ApiError("not_waiting");
  await settleMatch(env, duel.match_id, Date.now(), true);
  const state = await matchState(env, participant, duel, Date.now());
  if (state.state === "waiting") throw new ApiError("not_waiting");
  return state;
}
