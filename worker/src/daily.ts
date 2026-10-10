// Daily Three crowd stats (F12 Session 4). The game itself is static: every
// browser plays the same seeded games from the day files. This adds only the
// crowd lines the page shows after lock-in ("62% picked the Bulls").
//
//   POST /v1/daily/:n/result  { clientId, picks: [0|1 x3], score } -> { ok }
//   GET  /v1/daily/:n/stats   -> DailyCrowdStats, edge-cached
//
// clientId is a random id the browser makes once (crypto.randomUUID). It is
// not tied to a guest or an account. A second result for the same (n,
// clientId) is ignored by the primary key, so a browser counts once a day.
// Scores are self-reported and unverified; without a leaderboard a fake score
// only skews the "went 3/3" line (the About page says so).
//
// n must be within today's UTC puzzle number +- 1, which covers every time zone
// a player's local date can be in, except UTC+13 and +14 late in the UTC day.
// The puzzle number comes from the same meta.json the site serves, so a
// changed launch date (F12 Session 5) needs a Worker redeploy.

import meta from "../../frontend/public/data/daily/meta.json";
import { puzzleNumber } from "../../frontend/src/daily/day";
import { GAMES_PER_DAY, type DailyCrowdStats } from "../../frontend/src/daily/types";
import type { Env } from "./env";
import { ApiError, json } from "./http";
import { LIMITS, enforce } from "./ratelimit";

/** Puzzles accepted around today's UTC puzzle number (time zones). */
export const DAILY_WINDOW = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DAILY_LAUNCH_DATE: string = meta.launchDate;

/** Today's puzzle number on the UTC calendar date. */
export function utcPuzzleNumber(now: number, launchDate = DAILY_LAUNCH_DATE): number {
  return puzzleNumber(launchDate, new Date(now).toISOString().slice(0, 10));
}

/** The puzzle number in a path, if it is open for results and stats right now. */
export function openPuzzle(raw: string, now: number, launchDate = DAILY_LAUNCH_DATE): number {
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) throw new ApiError("not_found");
  const n = Number(raw);
  if (Math.abs(n - utcPuzzleNumber(now, launchDate)) > DAILY_WINDOW) throw new ApiError("puzzle_closed");
  return n;
}

type ResultInput = { clientId: string; picks: string; score: number };

export function parseResult(body: unknown): ResultInput {
  if (typeof body !== "object" || body === null) throw new ApiError("bad_request");
  const { clientId, picks, score } = body as { clientId?: unknown; picks?: unknown; score?: unknown };
  if (typeof clientId !== "string" || !UUID.test(clientId)) throw new ApiError("bad_request");
  if (!Array.isArray(picks) || picks.length !== GAMES_PER_DAY || !picks.every((p) => p === 0 || p === 1)) {
    throw new ApiError("bad_request");
  }
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > GAMES_PER_DAY) {
    throw new ApiError("bad_request");
  }
  return { clientId, picks: picks.join(""), score };
}

/** POST /v1/daily/:n/result. Answers the same whether or not the result was new. */
export async function recordResult(env: Env, ipKey: string, rawN: string, body: unknown, now = Date.now()): Promise<{ ok: true }> {
  await enforce(env.RATE_LIMITS, LIMITS.dailyResultPerIp, ipKey, Number(env.RATE_LIMIT_SCALE));
  const n = openPuzzle(rawN, now);
  const result = parseResult(body);
  // The daily_results_tally trigger (0007_daily.sql) counts only rows actually inserted.
  await env.DB.prepare("INSERT OR IGNORE INTO daily_results (n, client_id, picks, score, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(n, result.clientId, result.picks, result.score, now)
    .run();
  return { ok: true };
}

type TallyRow = { players: number; b1: number; b2: number; b3: number; s0: number; s1: number; s2: number; s3: number };

export async function crowdStats(env: Env, n: number): Promise<DailyCrowdStats> {
  const row = await env.DB.prepare("SELECT players, b1, b2, b3, s0, s1, s2, s3 FROM daily_tallies WHERE n = ?")
    .bind(n)
    .first<TallyRow>();
  const t = row ?? { players: 0, b1: 0, b2: 0, b3: 0, s0: 0, s1: 0, s2: 0, s3: 0 };
  return {
    n,
    players: t.players,
    picks: [t.b1, t.b2, t.b3].map((b) => [t.players - b, b] as [number, number]),
    scores: [t.s0, t.s1, t.s2, t.s3],
  };
}

/** GET /v1/daily/:n/stats. Served from the edge cache when DAILY_STATS_CACHE_SECONDS is above 0. */
export async function crowdStatsResponse(env: Env, rawN: string, now = Date.now()): Promise<Response> {
  const n = openPuzzle(rawN, now);
  const ttl = Math.floor(Number(env.DAILY_STATS_CACHE_SECONDS));
  if (!(ttl > 0)) return json(await crowdStats(env, n));
  const cache = caches.default;
  const key = new Request("https://daily-stats.cache/" + n);
  const hit = await cache.match(key);
  if (hit) return hit;
  const response = json(await crowdStats(env, n), 200, { "cache-control": "public, max-age=" + ttl });
  await cache.put(key, response.clone());
  return response;
}
