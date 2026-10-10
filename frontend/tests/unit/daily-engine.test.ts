import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BENCH,
  GAME_SECONDS,
  MISSED_DAY_RESETS_HOT_STREAK,
  SHARE_URL,
  addCalendarDays,
  buildShareText,
  calendarDaysBetween,
  clockAt,
  computeStats,
  emptyStore,
  localDate,
  msUntilNextPuzzle,
  parseStore,
  puzzleDate,
  puzzleNumber,
  puzzleNumberAt,
  puzzleStatus,
  recordDay,
  serializeStore,
  shortTeamLabel,
  simSeed,
  simulateGame,
  type DailyDay,
  type DailyEngine,
  type DailyMeta,
  type DailyPool,
  type DailyStore,
  type DailyTeam,
  type DayRecord,
  type ShareTeam,
  type Side,
  type SimGame,
} from "../../src/daily";

const DAILY_DIR = fileURLToPath(new URL("../../public/data/daily/", import.meta.url));
const INDEX_PATH = fileURLToPath(new URL("../../public/data/index.json", import.meta.url));
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

// Fixed synthetic teams: the golden games must not move when the pool is re-exported.
const STARTERS = (ppg: number[]) =>
  ppg.map((p, i) => ({ name: `Player ${i + 1}`, short: `P. ${i + 1}`, ppg: p, sig: [] }));

const TEAM_A: DailyTeam = {
  tier: "marquee",
  reasons: ["champion"],
  fiveFrom: "games-started",
  wins: 72,
  losses: 10,
  pace: 91.1,
  offRating: 115.2,
  defRating: 101.8,
  threeRate: 0.21,
  benchPpg: 25.3,
  starters: STARTERS([13.7, 30.4, 19.4, 5.5, 9.1]),
};

const TEAM_B: DailyTeam = {
  tier: "known",
  reasons: ["high-win"],
  fiveFrom: "games-started",
  wins: 63,
  losses: 19,
  pace: 100.4,
  offRating: 109.9,
  defRating: 104.1,
  // no threeRate: exercises the fixed-share fallback
  benchPpg: 31.0,
  starters: STARTERS([18.2, 17.3, 15.5, 11.1, 7.9]),
};

function sim(n: number, gameIndex: number, p: number, m: number, a = TEAM_A, b = TEAM_B): SimGame {
  return simulateGame({ engine: "sim-v1", n, gameIndex, game: { p, m }, teamA: a, teamB: b });
}

/** FNV-1a over the whole game, so any change to any play shows up. */
function digest(game: SimGame): string {
  const text = JSON.stringify(game);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function expectConsistent(game: SimGame, a: DailyTeam, b: DailyTeam) {
  const teams = [a, b];
  const loser = (1 - game.winner) as Side;
  expect(game.final[game.winner]).toBeGreaterThan(game.final[loser]);
  // The running score ends exactly at the final, one scoring play at a time.
  const score = [0, 0];
  // Plain checks per play, one assertion at the end: thousands of games run through here.
  const bad: string[] = [];
  let t = 1;
  game.plays.forEach((play, i) => {
    if (play.t < t || play.t >= GAME_SECONDS) bad.push(`play ${i}: clock ${play.t}`);
    t = play.t;
    const value = play.kind === "three" ? [3] : play.kind === "two" ? [2] : [1, 2];
    if (!value.includes(play.points)) bad.push(`play ${i}: ${play.kind} for ${play.points}`);
    score[play.side] += play.points;
    if (play.score[0] !== score[0] || play.score[1] !== score[1]) bad.push(`play ${i}: running score`);
    const starters = teams[play.side].starters.length;
    if (!(play.scorer === BENCH || (play.scorer >= 0 && play.scorer < starters))) bad.push(`play ${i}: scorer`);
  });
  expect(bad).toEqual([]);
  expect(score).toEqual(game.final);
  const last = game.plays[game.plays.length - 1];
  expect(last.score[game.winner]).toBeGreaterThan(last.score[loser]);
  // The box line adds up to the team's points, so no starter exceeds it.
  for (const side of [0, 1] as const) {
    const starters = game.box[side].starters;
    expect(starters).toHaveLength(teams[side].starters.length);
    expect(starters.reduce((x, y) => x + y, 0) + game.box[side].bench).toBe(game.final[side]);
    for (const pts of starters) {
      expect(pts).toBeGreaterThanOrEqual(0);
      expect(pts).toBeLessThanOrEqual(game.final[side]);
    }
  }
}

// ---------------------------------------------------------------------------
// The simulated game
// ---------------------------------------------------------------------------

describe("sim-v1", () => {
  it("seeds from the engine, puzzle number and game index", () => {
    expect(simSeed("sim-v1", 12, 2)).toBe("daily-three:sim-v1:12:2");
    expect(sim(12, 2, 0.6, 3).seed).toBe("daily-three:sim-v1:12:2");
  });

  it("replays the same game for the same seed", () => {
    expect(sim(7, 1, 0.6, 3.5)).toEqual(sim(7, 1, 0.6, 3.5));
    expect(digest(sim(7, 1, 0.6, 3.5))).not.toBe(digest(sim(8, 1, 0.6, 3.5)));
    expect(digest(sim(7, 1, 0.6, 3.5))).not.toBe(digest(sim(7, 2, 0.6, 3.5)));
  });

  it("is pinned: golden sim-v1 games never change", () => {
    // If this fails, released puzzles replay differently. Add sim-v2 for
    // unreleased days instead of updating these values.
    const cases = [sim(1, 0, 0.6038, 4.0), sim(12, 2, 0.5171, 0.5), sim(300, 1, 0.31, -6.4)];
    const got = cases.map((g) => ({ winner: g.winner, final: g.final, plays: g.plays.length, box: g.box, digest: digest(g) }));
    expect(got).toEqual(GOLDEN_SIM_V1);
  });

  it("wins at the model's odds: within 1.5 points of p over 10,000 seeds", () => {
    for (const [p, m] of [
      [0.55, 1.8],
      [0.62, 4.1],
      [0.7, 7.0],
      [0.31, -6.4],
      [0.9, 16.0],
    ]) {
      let aWins = 0;
      for (let n = 1; n <= 10_000; n++) {
        const game = sim(n, n % 3, p, m);
        if (game.winner === 0) aWins += 1;
      }
      expect(Math.abs(aWins / 10_000 - p)).toBeLessThanOrEqual(0.015);
    }
  });

  it("decides the winner from p alone: m and the team data never change it", () => {
    for (let n = 1; n <= 200; n++) {
      const base = sim(n, 0, 0.58, 2.5).winner;
      expect(sim(n, 0, 0.58, -20).winner).toBe(base);
      expect(sim(n, 0, 0.58, 2.5, TEAM_B, TEAM_A).winner).toBe(base);
    }
  });

  it("keeps the running score, the final and the box line consistent", () => {
    for (let n = 1; n <= 500; n++) {
      const p = 0.1 + (n % 9) / 10;
      expectConsistent(sim(n, n % 3, p, (p - 0.5) * 40), TEAM_A, TEAM_B);
    }
  });

  it("gives an upset to the underdog, with the margin on the winner's side", () => {
    let upsets = 0;
    for (let n = 1; n <= 400; n++) {
      const game = sim(n, 0, 0.92, 18);
      if (game.winner === 1) {
        upsets += 1;
        expect(game.final[1]).toBeGreaterThan(game.final[0]);
      }
    }
    expect(upsets).toBeGreaterThan(0);
  });

  it("plays realistic scores", () => {
    for (let n = 1; n <= 300; n++) {
      const game = sim(n, 0, 0.6, 3);
      for (const pts of game.final) {
        expect(pts).toBeGreaterThanOrEqual(60);
        expect(pts).toBeLessThan(170);
      }
    }
  });

  it("puts the clock in quarters", () => {
    expect(clockAt(0)).toEqual({ quarter: 1, secondsLeft: 720 });
    expect(clockAt(719)).toEqual({ quarter: 1, secondsLeft: 1 });
    expect(clockAt(720)).toEqual({ quarter: 2, secondsLeft: 720 });
    expect(clockAt(2879)).toEqual({ quarter: 4, secondsLeft: 1 });
    expect(clockAt(2880)).toEqual({ quarter: 4, secondsLeft: 0 });
  });

  it("refuses an unknown engine", () => {
    expect(() =>
      simulateGame({
        engine: "sim-v9" as DailyEngine,
        n: 1,
        gameIndex: 0,
        game: { p: 0.5, m: 0 },
        teamA: TEAM_A,
        teamB: TEAM_B,
      }),
    ).toThrow(/Unknown Daily Three engine/);
  });

  it("plays every scheduled game from the real pool consistently", { timeout: 60_000 }, () => {
    const meta = readJson<DailyMeta>(`${DAILY_DIR}meta.json`);
    const pool = readJson<DailyPool>(`${DAILY_DIR}teams.json`);
    expect(meta.engine).toBe("sim-v1");
    for (let n = 1; n <= meta.lastDay; n++) {
      const day = readJson<DailyDay>(`${DAILY_DIR}days/${n}.json`);
      expect(day.n).toBe(n);
      expect(day.date).toBe(puzzleDate(meta.launchDate, n));
      expect(day.games.map((g) => g.featured)).toEqual([false, false, true]);
      day.games.forEach((g, i) => {
        const a = pool.teams[g.a];
        const b = pool.teams[g.b];
        expect(a && b).toBeTruthy();
        expectConsistent(simulateGame({ engine: day.engine, n, gameIndex: i, game: g, teamA: a, teamB: b }), a, b);
      });
    }
  });
});

const GOLDEN_SIM_V1 = [
  {
    winner: 0,
    final: [120, 110],
    plays: 109,
    box: [
      { starters: [14, 35, 28, 9, 6], bench: 28 },
      { starters: [26, 17, 19, 7, 8], bench: 33 },
    ],
    digest: "7bd5383c",
  },
  {
    winner: 1,
    final: [94, 105],
    plays: 95,
    box: [
      { starters: [13, 26, 18, 4, 10], bench: 23 },
      { starters: [21, 18, 6, 10, 6], bench: 44 },
    ],
    digest: "3fcd5ed5",
  },
  {
    winner: 0, // an upset: p was 0.31
    final: [95, 90],
    plays: 87,
    box: [
      { starters: [10, 30, 16, 4, 8], bench: 27 },
      { starters: [9, 19, 18, 12, 8], bench: 24 },
    ],
    digest: "e52069f8",
  },
];

// ---------------------------------------------------------------------------
// Puzzle numbering
// ---------------------------------------------------------------------------

describe("puzzle numbering", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("counts calendar dates", () => {
    expect(calendarDaysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(calendarDaysBetween("2026-10-01", "2026-10-12")).toBe(11);
    expect(calendarDaysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(calendarDaysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
    expect(calendarDaysBetween("2027-02-28", "2027-03-01")).toBe(1);
    expect(calendarDaysBetween("2026-10-12", "2026-10-01")).toBe(-11);
    expect(calendarDaysBetween("2000-01-01", "2100-01-01")).toBe(36525);
    expect(addCalendarDays("2026-10-01", 364)).toBe("2027-09-30");
    expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(puzzleNumber("2026-10-01", "2026-10-01")).toBe(1);
    expect(puzzleNumber("2026-10-01", "2026-10-12")).toBe(12);
    expect(puzzleDate("2026-10-01", 12)).toBe("2026-10-12");
    expect(() => puzzleNumber("2026-10-01", "2026-02-30")).toThrow();
    expect(() => puzzleNumber("2026-10-01", "12/10/2026")).toThrow();
  });

  for (const tz of ["America/New_York", "Europe/London", "Australia/Sydney"]) {
    it(`advances exactly once per local midnight across daylight saving (${tz})`, () => {
      process.env.TZ = tz;
      const launch = "2027-01-01";
      // Every 15 minutes through 2027 covers both changes in each zone.
      let prev = puzzleNumberAt(launch, new Date(2027, 0, 1, 0, 0));
      expect(prev).toBe(1);
      let changes = 0;
      for (let ms = Date.UTC(2027, 0, 1, 12); ms < Date.UTC(2028, 0, 1); ms += 15 * 60_000) {
        const now = new Date(ms);
        const n = puzzleNumberAt(launch, now);
        expect(n).toBe(calendarDaysBetween(launch, localDate(now)) + 1);
        if (n !== prev) {
          expect(n).toBe(prev + 1);
          expect([now.getHours(), now.getMinutes()]).toEqual([0, 0]);
          changes += 1;
        }
        prev = n;
      }
      expect(changes).toBe(prev - 1);
      expect(changes).toBeGreaterThanOrEqual(364);
    });
  }

  it("counts a 23-hour and a 25-hour day as one puzzle each", () => {
    process.env.TZ = "America/New_York";
    // 2027-03-14 springs forward and 2027-11-07 falls back.
    expect(msUntilNextPuzzle(new Date(2027, 2, 14, 0, 0))).toBe(23 * 3_600_000);
    expect(msUntilNextPuzzle(new Date(2027, 10, 7, 0, 0))).toBe(25 * 3_600_000);
    expect(puzzleNumberAt("2027-03-13", new Date(2027, 2, 14, 23, 59))).toBe(2);
    expect(puzzleNumberAt("2027-03-13", new Date(2027, 2, 15, 0, 0))).toBe(3);
    expect(puzzleNumberAt("2027-11-06", new Date(2027, 10, 7, 23, 59))).toBe(2);
    expect(puzzleNumberAt("2027-11-06", new Date(2027, 10, 8, 0, 0))).toBe(3);
  });

  it("numbers the same instant by each player's local date, from UTC-12 to UTC+14", () => {
    const instant = new Date(Date.UTC(2026, 9, 12, 11, 30)); // 11:30 UTC on 2026-10-12
    process.env.TZ = "Etc/GMT+12"; // UTC-12 (POSIX signs are reversed)
    expect(localDate(instant)).toBe("2026-10-11");
    expect(puzzleNumberAt("2026-10-01", instant)).toBe(11);
    process.env.TZ = "UTC";
    expect(puzzleNumberAt("2026-10-01", instant)).toBe(12);
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    expect(localDate(instant)).toBe("2026-10-13");
    expect(puzzleNumberAt("2026-10-01", instant)).toBe(13);
  });

  it("starts a new puzzle at local midnight at both ends of the clock", () => {
    for (const tz of ["Etc/GMT+12", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      expect(puzzleNumberAt("2026-10-01", new Date(2026, 9, 1, 0, 0))).toBe(1);
      expect(puzzleNumberAt("2026-10-01", new Date(2026, 9, 1, 23, 59, 59))).toBe(1);
      expect(puzzleNumberAt("2026-10-01", new Date(2026, 9, 2, 0, 0))).toBe(2);
      expect(puzzleNumberAt("2026-10-01", new Date(2026, 8, 30, 23, 59))).toBe(0);
    }
  });

  it("reports before launch, ready, and a schedule that ran out", () => {
    process.env.TZ = "UTC";
    const meta = { launchDate: "2026-10-01", lastDay: 365 };
    expect(puzzleStatus(meta, new Date(Date.UTC(2026, 8, 30, 12)))).toEqual({ kind: "before-launch", n: 0 });
    expect(puzzleStatus(meta, new Date(Date.UTC(2026, 9, 1, 12)))).toEqual({ kind: "ready", n: 1 });
    expect(puzzleStatus(meta, new Date(Date.UTC(2027, 8, 30, 12)))).toEqual({ kind: "ready", n: 365 });
    expect(puzzleStatus(meta, new Date(Date.UTC(2027, 9, 1, 12)))).toEqual({ kind: "not-ready", n: 366 });
  });
});

// ---------------------------------------------------------------------------
// Stats and streaks
// ---------------------------------------------------------------------------

const RIGHT: DayRecord = { picks: [0, 1, 0], winners: [0, 1, 0] }; // 3/3
const TWO: DayRecord = { picks: [0, 1, 0], winners: [0, 1, 1] }; // 2/3, wrong last
const FIRST_WRONG: DayRecord = { picks: [1, 1, 0], winners: [0, 1, 0] }; // 2/3, wrong first
const NONE: DayRecord = { picks: [0, 0, 0], winners: [1, 1, 1] }; // 0/3

function storeOf(days: Record<number, DayRecord>): DailyStore {
  let store = emptyStore();
  for (const [n, rec] of Object.entries(days)) store = recordDay(store, Number(n), rec.picks, rec.winners);
  return store;
}

describe("stats and streaks", () => {
  it("starts empty", () => {
    const stats = computeStats(emptyStore(), 5);
    expect(stats).toEqual({
      played: 0,
      picks: 0,
      correctPicks: 0,
      accuracy: null,
      perfectDays: 0,
      distribution: [0, 0, 0, 0],
      playStreak: { current: 0, best: 0 },
      hotStreak: { current: 0, best: 0 },
    });
  });

  it("counts played days, accuracy, perfect days and the distribution", () => {
    const stats = computeStats(storeOf({ 1: RIGHT, 2: TWO, 3: NONE, 4: RIGHT }), 4);
    expect(stats.played).toBe(4);
    expect(stats.picks).toBe(12);
    expect(stats.correctPicks).toBe(8);
    expect(stats.accuracy).toBeCloseTo(8 / 12);
    expect(stats.perfectDays).toBe(2);
    expect(stats.distribution).toEqual([1, 0, 1, 2]);
  });

  it("extends the play streak day by day, and keeps it alive until a day is missed", () => {
    const store = storeOf({ 1: RIGHT, 2: RIGHT, 3: TWO });
    expect(computeStats(store, 3).playStreak).toEqual({ current: 3, best: 3 });
    expect(computeStats(store, 4).playStreak).toEqual({ current: 3, best: 3 }); // today not played yet
    expect(computeStats(store, 5).playStreak).toEqual({ current: 0, best: 3 }); // day 4 missed
  });

  it("resets the play streak after a missed day once the next one is played", () => {
    const stats = computeStats(storeOf({ 1: RIGHT, 2: RIGHT, 3: RIGHT, 5: TWO }), 5);
    expect(stats.playStreak).toEqual({ current: 1, best: 3 });
  });

  it("resets the hot streak on a wrong pick, in play order", () => {
    // Day 1: 3 right. Day 2: right, right, wrong. Day 3: wrong, right, right.
    const stats = computeStats(storeOf({ 1: RIGHT, 2: TWO, 3: FIRST_WRONG }), 3);
    expect(stats.hotStreak).toEqual({ current: 2, best: 5 });
  });

  it("carries perfect days into the hot streak across days", () => {
    const stats = computeStats(storeOf({ 1: RIGHT, 2: RIGHT, 3: RIGHT }), 3);
    expect(stats.hotStreak).toEqual({ current: 9, best: 9 });
    expect(stats.perfectDays).toBe(3);
  });

  it("does not reset the hot streak on a missed day (Q3)", () => {
    expect(MISSED_DAY_RESETS_HOT_STREAK).toBe(false);
    const store = storeOf({ 1: RIGHT, 2: RIGHT, 6: RIGHT });
    const stats = computeStats(store, 6);
    expect(stats.hotStreak).toEqual({ current: 9, best: 9 });
    expect(stats.playStreak).toEqual({ current: 1, best: 2 });
    // Still alive while days are being missed.
    expect(computeStats(storeOf({ 1: RIGHT, 2: RIGHT }), 9).hotStreak.current).toBe(6);
  });

  it("keeps picks final: a second lock-in for the same day changes nothing", () => {
    const store = storeOf({ 1: RIGHT });
    const again = recordDay(store, 1, NONE.picks, NONE.winners);
    expect(again).toBe(store);
    expect(computeStats(again, 1).correctPicks).toBe(3);
  });

  it("does not mutate the store it is given", () => {
    const store = storeOf({ 1: RIGHT });
    const before = serializeStore(store);
    recordDay(store, 2, TWO.picks, TWO.winners);
    expect(serializeStore(store)).toBe(before);
  });

  it("rejects malformed lock-ins", () => {
    expect(() => recordDay(emptyStore(), 0, RIGHT.picks, RIGHT.winners)).toThrow();
    expect(() => recordDay(emptyStore(), 1, [0, 1], [0, 1])).toThrow();
    expect(() => recordDay(emptyStore(), 1, [0, 2, 1] as Side[], RIGHT.winners)).toThrow();
  });

  it("round-trips through storage", () => {
    const store = { ...storeOf({ 1: RIGHT, 2: TWO }), clientId: "abc" };
    expect(parseStore(serializeStore(store))).toEqual(store);
  });

  it("starts fresh from a missing or corrupt store", () => {
    for (const raw of [null, undefined, "", "{", "null", "42", "[]", '"x"', '{"v":2,"days":{}}', '{"v":1}', '{"v":1,"days":[]}']) {
      const store = parseStore(raw);
      expect(store).toEqual(emptyStore());
      expect(computeStats(store, 10).played).toBe(0);
    }
  });

  it("drops malformed days and keeps the rest", () => {
    const raw = JSON.stringify({
      v: 1,
      clientId: 7,
      days: {
        "1": RIGHT,
        "2": { picks: [0, 1], winners: [0, 1, 1] },
        "3": { picks: [0, 1, 2], winners: [0, 1, 1] },
        "0": RIGHT,
        "-4": RIGHT,
        x: RIGHT,
        "5": null,
        "6": TWO,
      },
    });
    const store = parseStore(raw);
    expect(Object.keys(store.days).sort()).toEqual(["1", "6"]);
    expect(store.clientId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Share text
// ---------------------------------------------------------------------------

const SHARE_TEAMS: Record<string, ShareTeam> = {
  "1989-pistons": { season: 1989, name: "Pistons" },
  "1996-bulls": { season: 1996, name: "Bulls" },
  "2001-lakers": { season: 2001, name: "Lakers" },
  "2014-spurs": { season: 2014, name: "Spurs" },
  "2017-warriors": { season: 2017, name: "Warriors" },
};

const SHARE_GAMES = [
  { a: "1989-pistons", b: "1996-bulls", p: 0.3812, m: -4.7, featured: false },
  { a: "2001-lakers", b: "2014-spurs", p: 0.5634, m: 2.6, featured: false },
  { a: "1996-bulls", b: "2017-warriors", p: 0.4921, m: -0.3, featured: true },
];

// Simulated finals, [a, b], chosen to share no digits with p or m.
const SHARE_FINALS: [number, number][] = [
  [92, 104],
  [97, 101],
  [108, 112],
];

describe("share text", () => {
  it("names each winner and the final score (Q5)", () => {
    const text = buildShareText({
      n: 12,
      games: SHARE_GAMES,
      teams: SHARE_TEAMS,
      record: { picks: [1, 0, 1], winners: [1, 1, 1] },
      finals: SHARE_FINALS,
      playStreak: 12,
      hotStreak: 5,
    });
    expect(text).toBe(
      [
        "Daily Three #12 · 2/3",
        "🟩 '96 Bulls beat '89 Pistons 104–92",
        "🟥 '14 Spurs beat '01 Lakers 101–97",
        "🟩 '17 Warriors beat '96 Bulls 112–108 ⭐",
        "🔥 12  🎯 5",
        SHARE_URL,
      ].join("\n"),
    );
  });

  it("puts side a first when a won", () => {
    const text = buildShareText({
      n: 3,
      games: SHARE_GAMES,
      teams: SHARE_TEAMS,
      record: { picks: [0, 1, 0], winners: [0, 0, 0] },
      finals: [
        [104, 92],
        [101, 97],
        [112, 108],
      ],
      playStreak: 1,
      hotStreak: 0,
    });
    expect(text.split("\n").slice(1, 4)).toEqual([
      "🟩 '89 Pistons beat '96 Bulls 104–92",
      "🟥 '01 Lakers beat '14 Spurs 101–97",
      "🟩 '96 Bulls beat '17 Warriors 112–108 ⭐",
    ]);
  });

  it("labels seasons with two digits", () => {
    expect(shortTeamLabel({ season: 2000, name: "Lakers" })).toBe("'00 Lakers");
    expect(shortTeamLabel({ season: 2005, name: "Trail Blazers" })).toBe("'05 Trail Blazers");
    expect(shortTeamLabel({ season: 1986, name: "76ers" })).toBe("'86 76ers");
  });

  it("carries no probability and no margin", () => {
    // Every way to be right or wrong in each game, with either side winning.
    for (let mask = 0; mask < 8; mask++) {
      const right = [0, 1, 2].map((i) => ((mask >> i) & 1) === 1);
      for (let winners = 0; winners < 8; winners++) {
        const w = [0, 1, 2].map((i) => ((winners >> i) & 1) as Side);
        const picks = w.map((x, i) => (right[i] ? x : ((1 - x) as Side)));
        const finals = SHARE_FINALS.map(([lo, hi], i): [number, number] => (w[i] === 0 ? [hi, lo] : [lo, hi]));
        const text = buildShareText({
          n: 40,
          games: SHARE_GAMES,
          teams: SHARE_TEAMS,
          record: { picks, winners: w },
          finals,
          playStreak: 3,
          hotStreak: 7,
        });
        const body = text.replace(SHARE_URL, "");
        expect(body).not.toMatch(/%|\+|\bby\b|\bpts?\b|\bpoints?\b/i);
        expect(text).not.toMatch(/\d\.\d/);
        for (const g of SHARE_GAMES) {
          expect(text).not.toContain(String(g.p));
          expect(text).not.toContain(String(Math.round(g.p * 100)));
          expect(text).not.toContain(String(Math.abs(g.m)));
        }
        // The square follows the pick; the winner leads its line.
        text
          .split("\n")
          .slice(1, 4)
          .forEach((line, i) => {
            expect(line.startsWith(right[i] ? "🟩" : "🟥")).toBe(true);
            const winnerKey = w[i] === 0 ? SHARE_GAMES[i].a : SHARE_GAMES[i].b;
            expect(line.slice(3).startsWith(shortTeamLabel(SHARE_TEAMS[winnerKey]))).toBe(true);
          });
      }
    }
  });

  it("refuses a missing final", () => {
    expect(() =>
      buildShareText({
        n: 1,
        games: SHARE_GAMES,
        teams: SHARE_TEAMS,
        record: { picks: [0, 0, 0], winners: [0, 0, 0] },
        finals: SHARE_FINALS.slice(0, 2),
        playStreak: 1,
        hotStreak: 1,
      }),
    ).toThrow();
  });

  it("names every scheduled team by its era-correct name", () => {
    const index = readJson<{ teams: { key: string; season: number; name: string }[] }>(INDEX_PATH);
    const teams = Object.fromEntries(index.teams.map((t) => [t.key, { season: t.season, name: t.name }]));
    const day = readJson<DailyDay>(`${DAILY_DIR}days/1.json`);
    const text = buildShareText({
      n: day.n,
      games: day.games,
      teams,
      record: { picks: [0, 0, 0], winners: [0, 1, 0] },
      finals: [
        [101, 99],
        [95, 103],
        [110, 90],
      ],
      playStreak: 1,
      hotStreak: 1,
    });
    expect(text.split("\n")).toHaveLength(6);
    expect(text.startsWith("Daily Three #1 · 2/3\n")).toBe(true);
  });
});
