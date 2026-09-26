// Leaderboards (F09 Session 7). Only human-vs-human rated duels count: the
// Sparring Partner fallback is unrated, so it never appears. An account with
// an open or upheld integrity flag is left off until a reviewer clears it.
//
//   daily  rated duels since 00:00 UTC, ordered by rating change
//   30d    the last 30 days, at least BOARD_MIN_DUELS["30d"] rated duels, ordered by current rating
//
// The board is public: it carries display names and rated results only, never
// an account id.
//
// Computing a board costs about six row reads per rated result in its window,
// so it is not computed per request. The scheduled handler stores both boards
// in board_snapshots every run, and a review decision stores them again; a
// request reads the one stored row. A request computes the board itself only
// when the snapshot is missing, older than LEADERBOARD_REFRESH_SECONDS (the
// schedule has stalled), or from before 00:00 UTC for the daily board. "0"
// computes every request (tests). On top, each response is cached at the edge
// for LEADERBOARD_CACHE_SECONDS.

import { ELO_PROVISIONAL_DUELS, type LeaderboardEntry, type LeaderboardKind, type LeaderboardView } from "../../frontend/src/duel";
import type { Env } from "./env";
import { ApiError, json } from "./http";

export const BOARD_LIMIT = 100;
export const BOARD_MIN_DUELS: Record<LeaderboardKind, number> = { daily: 1, "30d": 5 };
export const BOARDS: readonly LeaderboardKind[] = ["daily", "30d"];
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

/** Stores a computed board, unless a newer one is already stored. */
async function storeBoard(env: Env, view: LeaderboardView): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO board_snapshots (board, generated_at, body) VALUES (?, ?, ?)
     ON CONFLICT (board) DO UPDATE SET generated_at = excluded.generated_at, body = excluded.body
     WHERE excluded.generated_at > board_snapshots.generated_at`,
  )
    .bind(view.board, view.generatedAt, JSON.stringify(view))
    .run();
}

/** Computes and stores both boards: the scheduled handler, and after a review decision. */
export async function refreshBoards(env: Env, now: number): Promise<void> {
  for (const board of BOARDS) await storeBoard(env, await leaderboard(env, board, now));
}

/** The stored board if it is current, else a freshly computed (and stored) one. */
export async function boardSnapshot(env: Env, board: LeaderboardKind, now: number): Promise<LeaderboardView> {
  const maxAgeMs = Math.floor(Number(env.LEADERBOARD_REFRESH_SECONDS)) * 1000;
  if (!(maxAgeMs > 0)) return leaderboard(env, board, now);
  const row = await env.DB.prepare("SELECT generated_at, body FROM board_snapshots WHERE board = ?")
    .bind(board)
    .first<{ generated_at: number; body: string }>();
  if (row && now - row.generated_at < maxAgeMs) {
    const view = JSON.parse(row.body) as LeaderboardView;
    // A daily board stored before midnight UTC is yesterday's.
    if (view.windowStart === boardWindowStart(board, now) || board === "30d") return view;
  }
  const view = await leaderboard(env, board, now);
  await storeBoard(env, view);
  return view;
}

/** GET /v1/leaderboard. Served from the edge cache when LEADERBOARD_CACHE_SECONDS is above 0. */
export async function leaderboardResponse(env: Env, board: LeaderboardKind): Promise<Response> {
  const ttl = Math.floor(Number(env.LEADERBOARD_CACHE_SECONDS));
  if (!(ttl > 0)) return json(await boardSnapshot(env, board, Date.now()));
  const cache = caches.default;
  const key = new Request("https://leaderboard.cache/" + encodeURIComponent(env.POOL_VERSION) + "/" + board);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = json(await boardSnapshot(env, board, Date.now()), 200, { "cache-control": "public, max-age=" + ttl });
  await cache.put(key, response.clone());
  return response;
}
