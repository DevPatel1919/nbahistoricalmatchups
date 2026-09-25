// Leaderboards (F09 Session 7). Only human-vs-human rated duels count: the
// Sparring Partner fallback is unrated, so it never appears. An account with
// an open or upheld integrity flag is left off until a reviewer clears it.
//
//   daily  rated duels since 00:00 UTC, ordered by rating change
//   30d    the last 30 days, at least BOARD_MIN_DUELS["30d"] rated duels, ordered by current rating
//
// The board is public: it carries display names and rated results only, never
// an account id. It is cached at the edge for LEADERBOARD_CACHE_SECONDS.

import { ELO_PROVISIONAL_DUELS, type LeaderboardEntry, type LeaderboardKind, type LeaderboardView } from "../../frontend/src/duel";
import type { Env } from "./env";
import { ApiError, json } from "./http";

export const BOARD_LIMIT = 100;
export const BOARD_MIN_DUELS: Record<LeaderboardKind, number> = { daily: 1, "30d": 5 };
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
    `WITH results AS (
       SELECT rc.account_id, rc.delta,
         CASE WHEN res.outcome = 'draw' THEN 'd' WHEN res.outcome = ms.seat THEN 'w' ELSE 'l' END AS result
       FROM rating_changes rc
       JOIN match_resolutions res ON res.match_id = rc.match_id
       JOIN match_seats ms ON ms.match_id = rc.match_id AND ms.participant = 'a:' || rc.account_id
       WHERE rc.created_at >= ?
     )
     SELECT a.display_name AS name, r.rating, r.rated_duels, COUNT(*) AS duels,
       SUM(x.result = 'w') AS wins, SUM(x.result = 'l') AS losses, SUM(x.result = 'd') AS draws, SUM(x.delta) AS change
     FROM results x
     JOIN accounts a ON a.id = x.account_id
     JOIN ratings r ON r.account_id = x.account_id
     WHERE a.display_name IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM integrity_flags f WHERE f.account_id = x.account_id AND f.status IN ('open', 'upheld'))
     GROUP BY x.account_id
     HAVING COUNT(*) >= ?
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
  const ttl = Math.floor(Number(env.LEADERBOARD_CACHE_SECONDS));
  if (!(ttl > 0)) return json(await leaderboard(env, board, Date.now()));
  const cache = caches.default;
  const key = new Request("https://leaderboard.cache/" + encodeURIComponent(env.POOL_VERSION) + "/" + board);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = json(await leaderboard(env, board, Date.now()), 200, { "cache-control": "public, max-age=" + ttl });
  await cache.put(key, response.clone());
  return response;
}
