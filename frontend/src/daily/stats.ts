// Daily Three personal stats and streaks (F12). Pure: the page reads and
// writes localStorage[STORAGE_KEY] itself, inside try/catch, and passes the
// raw string through parseStore, which turns anything missing or corrupt into
// a fresh store.
//
// A day counts when the player locks in, not when they watch the reveal: the
// page records the picks and the simulated winners at lock-in.

import { GAMES_PER_DAY, type Side } from "./types";

export const STORAGE_KEY = "ct:daily:v1";

/**
 * Q3, decided by the owner on 2026-10-07 (F12 brief): a missed day does not
 * reset the 🎯 hot streak. Only a wrong pick does; a missed day resets only
 * the 🔥 play streak.
 */
export const MISSED_DAY_RESETS_HOT_STREAK = false;

export type DayRecord = {
  picks: Side[]; // one per game, 0 = a, 1 = b
  winners: Side[]; // the simulated winners
};

export type DailyStore = {
  v: 1;
  /** Random browser id for crowd stats (Session 4). Not tied to an account. */
  clientId?: string;
  /** Keyed by puzzle number. */
  days: Record<string, DayRecord>;
};

export type Streak = { current: number; best: number };

export type DailyStats = {
  played: number;
  picks: number;
  correctPicks: number;
  /** correctPicks / picks, or null before the first day. */
  accuracy: number | null;
  perfectDays: number;
  /** Days at 0/3, 1/3, 2/3 and 3/3. */
  distribution: number[];
  /** 🔥 consecutive puzzle numbers locked in. */
  playStreak: Streak;
  /** 🎯 consecutive correct picks in play order (day, then game 1 to 3). */
  hotStreak: Streak;
};

export function emptyStore(): DailyStore {
  return { v: 1, days: {} };
}

function isSides(value: unknown): value is Side[] {
  return Array.isArray(value) && value.length === GAMES_PER_DAY && value.every((x) => x === 0 || x === 1);
}

/**
 * Reads a stored value. Missing, unparsable, or wrong-version values start
 * fresh; a malformed day entry is dropped and the rest kept.
 */
export function parseStore(raw: string | null | undefined): DailyStore {
  if (!raw) return emptyStore();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyStore();
  }
  if (typeof value !== "object" || value === null) return emptyStore();
  const obj = value as { v?: unknown; clientId?: unknown; days?: unknown };
  if (obj.v !== 1 || typeof obj.days !== "object" || obj.days === null || Array.isArray(obj.days)) {
    return emptyStore();
  }
  const store: DailyStore = emptyStore();
  if (typeof obj.clientId === "string" && obj.clientId) store.clientId = obj.clientId;
  for (const [key, rec] of Object.entries(obj.days as Record<string, unknown>)) {
    if (!/^[1-9][0-9]*$/.test(key) || typeof rec !== "object" || rec === null) continue;
    const { picks, winners } = rec as { picks?: unknown; winners?: unknown };
    if (isSides(picks) && isSides(winners)) store.days[key] = { picks: [...picks], winners: [...winners] };
  }
  return store;
}

export function serializeStore(store: DailyStore): string {
  return JSON.stringify(store);
}

/** Records a locked-in day. Picks are final: a day already recorded is kept as it was. */
export function recordDay(store: DailyStore, n: number, picks: Side[], winners: Side[]): DailyStore {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Not a puzzle number: ${n}`);
  if (!isSides(picks) || !isSides(winners)) throw new Error(`A day needs ${GAMES_PER_DAY} picks and winners`);
  if (store.days[String(n)]) return store;
  return { ...store, days: { ...store.days, [String(n)]: { picks: [...picks], winners: [...winners] } } };
}

export function getDay(store: DailyStore, n: number): DayRecord | undefined {
  return store.days[String(n)];
}

/** Which picks were right, game by game. */
export function correctness(record: DayRecord): boolean[] {
  return record.picks.map((pick, i) => pick === record.winners[i]);
}

export function dayScore(record: DayRecord): number {
  return correctness(record).filter(Boolean).length;
}

/**
 * Stats as of puzzle `today`. The play streak stays alive until a puzzle number
 * is missed: it counts through today if today is played, otherwise through
 * yesterday, and is 0 once yesterday was missed too.
 */
export function computeStats(store: DailyStore, today: number): DailyStats {
  const ns = Object.keys(store.days)
    .map(Number)
    .sort((x, y) => x - y);
  const distribution = new Array<number>(GAMES_PER_DAY + 1).fill(0);
  let picks = 0;
  let correctPicks = 0;

  let playRun = 0;
  let playBest = 0;
  let hotRun = 0;
  let hotBest = 0;
  let prev: number | null = null;
  for (const n of ns) {
    const record = store.days[String(n)];
    const consecutive = prev !== null && n === prev + 1;
    playRun = consecutive ? playRun + 1 : 1;
    playBest = Math.max(playBest, playRun);
    if (MISSED_DAY_RESETS_HOT_STREAK && prev !== null && !consecutive) hotRun = 0;
    for (const right of correctness(record)) {
      picks += 1;
      if (right) {
        correctPicks += 1;
        hotRun += 1;
        hotBest = Math.max(hotBest, hotRun);
      } else {
        hotRun = 0;
      }
    }
    distribution[dayScore(record)] += 1;
    prev = n;
  }

  const alive = prev !== null && prev >= today - 1;
  const hotAlive = !MISSED_DAY_RESETS_HOT_STREAK || alive;
  return {
    played: ns.length,
    picks,
    correctPicks,
    accuracy: picks ? correctPicks / picks : null,
    perfectDays: distribution[GAMES_PER_DAY],
    distribution,
    playStreak: { current: alive ? playRun : 0, best: playBest },
    hotStreak: { current: hotAlive ? hotRun : 0, best: hotBest },
  };
}
