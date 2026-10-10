// Daily Three domain types (F12). The static data contract under
// public/data/daily/ (built by scripts/export_daily_data.py and
// scripts/build_daily_schedule.py) and the engine's own shapes. See
// docs/product/features/F12-daily-three.md, "Data contract".

export const DAILY_ENGINES = ["sim-v1"] as const;
export type DailyEngine = (typeof DAILY_ENGINES)[number];

export const GAMES_PER_DAY = 3;

/** public/data/daily/meta.json */
export type DailyMeta = {
  launchDate: string; // YYYY-MM-DD, puzzle #1
  lastDay: number;
  engine: DailyEngine;
  /** False until Session 5: before launch every day may be regenerated. */
  launched: boolean;
};

/**
 * One matchup. a and b are in canonical order (lib/slug.ts). p is a's neutral
 * win probability and m a's exported margin. The UI never shows either before
 * lock-in, and never shows m as a precise margin (lib/margin.ts).
 */
export type DailyGame = {
  a: string;
  b: string;
  p: number;
  m: number;
  featured: boolean;
};

/** public/data/daily/days/<n>.json */
export type DailyDay = {
  n: number;
  date: string; // YYYY-MM-DD
  engine: DailyEngine;
  games: DailyGame[];
};

export const SIG_STATS = ["RPG", "APG", "SPG", "BPG", "3PM", "FG%", "3P%"] as const;
export type SigStat = (typeof SIG_STATS)[number];

export type Starter = {
  name: string;
  short: string;
  ppg: number;
  sig: { stat: SigStat; value: number }[];
};

export type PoolReason = "champion" | "very-high-win" | "high-win" | "notable-star" | "owner-pin";

/** One pool team in public/data/daily/teams.json. */
export type DailyTeam = {
  tier: "marquee" | "known";
  reasons: PoolReason[];
  fiveFrom: "games-started" | "override";
  wins: number;
  losses: number;
  pace: number;
  offRating: number;
  defRating: number;
  threeRate?: number;
  benchPpg: number;
  starters: Starter[]; // card order, guards to centers
};

/** public/data/daily/teams.json */
export type DailyPool = {
  generated: string;
  release: { version: string };
  champions: Record<string, string>;
  teams: Record<string, DailyTeam>;
};

/** A pick names a side of a game: 0 is a, 1 is b. */
export type Side = 0 | 1;

// ---------------------------------------------------------------------------
// Crowd stats wire types (Session 4). The duel Worker imports these
// (worker/src/daily.ts); the page calls it through lib/duelApi.ts.
// ---------------------------------------------------------------------------

/** POST /v1/daily/:n/result. Sent once, at lock-in. */
export type DailyResultBody = {
  /** A random id this browser made (crypto.randomUUID), kept in ct:daily:v1. */
  clientId: string;
  picks: Side[];
  /** Self-reported, unverified: 0 to 3. */
  score: number;
};

/** GET /v1/daily/:n/stats. */
export type DailyCrowdStats = {
  n: number;
  /** Browsers that sent a result for puzzle n. */
  players: number;
  /** Per game, how many picked [a, b]. */
  picks: [number, number][];
  /** How many went 0/3, 1/3, 2/3 and 3/3. */
  scores: number[];
};
