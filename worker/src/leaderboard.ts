// Leaderboards (F09 Session 7). Only human-vs-human rated duels count: the
// Sparring Partner fallback is unrated, so it never appears. An account with
// an open or upheld integrity flag is left off until a reviewer clears it.
//
//   daily  rated duels since 00:00 UTC, ordered by rating change
//   30d    the last 30 days, at least BOARD_MIN_DUELS["30d"] rated duels, ordered by current rating
//
// The board is public: it carries display names and rated results only, never
// an account id. It is cached at the edge for LEADERBOARD_CACHE_SECONDS, and
// the 30-day board for THIRTY_DAY_CACHE_FACTOR times that: it changes slowly and
// costs about six row reads per rated result in its window to compute.

import { ELO_PROVISIONAL_DUELS, type LeaderboardEntry, type LeaderboardKind, type LeaderboardView } from "../../frontend/src/duel";
import type { Env } from "./env";
import { ApiError, json } from "./http";

export const BOARD_LIMIT = 100;
export const BOARD_MIN_DUELS: Record<LeaderboardKind, number> = { daily: 1, "30d": 5 };
export const THIRTY_DAY_CACHE_FACTOR = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseBoard(value: string | null): LeaderboardKind {
  if (value === "daily" || value === "30d") return value;
  throw new ApiError("bad_request");
}

export function boardWindowStart(board: LeaderboardKind, now: number): number {
  return board === "daily" ? Math.floor(now / DAY_MS) * DAY_MS : now - 30 * DAY_MS;
}

type BoardRow = {
  name: string;
  rating: number;
  rated_duels: number;
  duels: number;
  wins: number;
  losses: number;
  draws: number;
  change: number;
};

export async function leaderboard(env: Env, board: LeaderboardKind, now: number): Promise<LeaderboardView> {
  const windowStart = boardWindowStart(board, now);
  const minDuels = BOARD_MIN_DUELS[board];
  const order = board === "daily" ? "change DESC, rating DESC" : "rating DESC, duels DESC";
  const rows = await env.DB.prepare(
    // Totals per account first, then one lookup of name, rating, and flags per
    // account rather than per rated result. The index hint keeps the scan to
    // the window: without it SQLite walks the whole ledger by account to avoid
    // a sort, so the cost grew with all history (Session 8 cost profile).
    `WITH totals AS MATERIALIZED (
       SELECT rc.account_id, COUNT(*) AS duels, SUM(res.outcome = ms.seat) AS wins, SUM(res.outcome = 'draw') AS draws,
         SUM(rc.delta) AS change
       FROM rating_changes rc INDEXED BY rating_changes_created
       JOIN match_resolutions res ON res.match_id = rc.match_id
       JOIN match_seats ms ON ms.match_id = rc.match_id AND ms.participant = 'a:' || rc.account_id
       WHERE rc.created_at >= ?
       GROUP BY rc.account_id
       HAVING COUNT(*) >= ?
     )
     SELECT a.display_name AS name, r.rating, r.rated_duels, t.duels, t.wins, t.duels - t.wins - t.draws AS losses, t.draws, t.change
     FROM totals t
     JOIN accounts a ON a.id = t.account_id
     JOIN ratings r ON r.account_id = t.account_id
     WHERE a.display_name IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM integrity_flags f WHERE f.account_id = t.account_id AND f.status IN ('open', 'upheld'))
     ORDER BY ${order}, a.display_name_key
     LIMIT ?`,
  )
    .bind(windowStart, minDuels, BOARD_LIMIT)
    .all<BoardRow>();
  const entries: LeaderboardEntry[] = rows.results.map((r, i) => ({
    rank: i + 1,
    name: r.name,
    rating: r.rating,
    provisional: r.rated_duels < ELO_PROVISIONAL_DUELS,
    duels: r.duels,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    change: r.change,
  }));
  return { board, windowStart, generatedAt: now, minDuels, entries };
}

/** GET /v1/leaderboard. Served from the edge cache when LEADERBOARD_CACHE_SECONDS is above 0. */
export async function leaderboardResponse(env: Env, board: LeaderboardKind): Promise<Response> {
  const ttl = Math.floor(Number(env.LEADERBOARD_CACHE_SECONDS)) * (board === "30d" ? THIRTY_DAY_CACHE_FACTOR : 1);
  if (!(ttl > 0)) return json(await leaderboard(env, board, Date.now()));
  const cache = caches.default;
  const key = new Request("https://leaderboard.cache/" + encodeURIComponent(env.POOL_VERSION) + "/" + board);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = json(await leaderboard(env, board, Date.now()), 200, { "cache-control": "public, max-age=" + ttl });
  await cache.put(key, response.clone());
  return response;
}
