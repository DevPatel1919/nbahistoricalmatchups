// Daily Three page helpers (F12 Session 3): display text, the reveal clock,
// and the puzzle assembled from the committed data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BENCH, GAME_SECONDS, simulateGame, type SimGame, type SimPlay } from "../../src/daily";
import type { DailyDay, DailyPool } from "../../src/daily";
import {
  REVEAL_GAME_MS,
  REVEAL_PAUSE_MS,
  REVEAL_START,
  advanceReveal,
  atFinal,
  clockText,
  countdownWords,
  formatAccuracy,
  formatCountdown,
  formatStatValue,
  fullTeamName,
  gameSecondsAt,
  oddsLine,
  playText,
  playsBy,
  scoreAfter,
  seasonLabel,
  skipGame,
  starterStatLine,
} from "../../src/lib/dailyFormat";
import { buildPuzzle, puzzleWinners, shareTeams } from "../../src/lib/dailyPuzzle";
import type { IndexData } from "../../src/types";

const DATA = "public/data/";
const readJson = <T>(path: string): T => JSON.parse(readFileSync(DATA + path, "utf8")) as T;

describe("card text", () => {
  it("labels seasons the way the cards do", () => {
    expect(seasonLabel(1996)).toBe("1995–96");
    expect(seasonLabel(2000)).toBe("1999–00");
    expect(seasonLabel(2010)).toBe("2009–10");
    expect(fullTeamName({ season: 1996, city: "Chicago", name: "Bulls" })).toBe("1995–96 Chicago Bulls");
  });

  it("shows PPG first, then the signature stats, keeping each value with its label", () => {
    const line = starterStatLine({
      ppg: 30.4,
      sig: [
        { stat: "SPG", value: 2.2 },
        { stat: "3P%", value: 0.427 },
      ],
    });
    expect(line).toBe("30.4 PPG · 2.2 SPG · .427 3P%");
    expect(formatStatValue("FG%", 0.574)).toBe(".574");
    expect(formatStatValue("3PM", 3)).toBe("3.0");
  });
});

describe("the simulated game's text", () => {
  const play = (over: Partial<SimPlay>): SimPlay => ({
    t: 100,
    side: 0,
    kind: "two",
    points: 2,
    scorer: 0,
    score: [2, 0],
    ...over,
  });
  const starters = [{ short: "M. Jordan" }, { short: "S. Pippen" }];

  it("names the scorer and the points", () => {
    expect(playText(play({ kind: "three", points: 3 }), starters)).toBe("M. Jordan three, +3");
    expect(playText(play({ scorer: BENCH }), starters)).toBe("Bench basket, +2");
    expect(playText(play({ kind: "free-throws", points: 1, scorer: 1 }), starters)).toBe("S. Pippen free throw, +1");
    expect(playText(play({ kind: "free-throws", points: 2, scorer: 1 }), starters)).toBe("S. Pippen free throws, +2");
  });

  it("runs the quarter clock", () => {
    expect(clockText(0)).toBe("Q1 12:00");
    expect(clockText(139)).toBe("Q1 9:41");
    expect(clockText(720)).toBe("Q2 12:00");
    expect(clockText(GAME_SECONDS - 1)).toBe("Q4 0:01");
    expect(clockText(GAME_SECONDS)).toBe("Final");
  });

  it("gives the winner's chance after the final, never 0% or 100%, and never the margin (Q1)", () => {
    expect(oddsLine(0.58, 1, "2020–21 Trail Blazers")).toBe("Upset! The model gave the 2020–21 Trail Blazers 42%.");
    expect(oddsLine(0.58, 0, "2010–11 Celtics")).toBe("The model made the 2010–11 Celtics favourites at 58%.");
    expect(oddsLine(0.5, 0, "X")).toBe("The model had this one at 50–50.");
    expect(oddsLine(0.999, 1, "X")).toBe("Upset! The model gave the X <1%.");
    expect(oddsLine(0.999, 0, "X")).toBe("The model made the X favourites at >99%.");
  });
});

describe("the reveal clock", () => {
  const sim: Pick<SimGame, "plays"> = {
    plays: [
      { t: 10, side: 0, kind: "two", points: 2, scorer: 0, score: [2, 0] },
      { t: 10, side: 1, kind: "three", points: 3, scorer: 0, score: [2, 3] },
      { t: 900, side: 0, kind: "two", points: 2, scorer: 1, score: [4, 3] },
      { t: 2879, side: 1, kind: "free-throws", points: 1, scorer: BENCH, score: [4, 4] },
    ],
  };

  it("maps about 20 seconds onto the 48 minutes", () => {
    expect(gameSecondsAt(0)).toBe(0);
    expect(gameSecondsAt(REVEAL_GAME_MS / 2)).toBe(GAME_SECONDS / 2);
    expect(gameSecondsAt(REVEAL_GAME_MS)).toBe(GAME_SECONDS);
    expect(gameSecondsAt(REVEAL_GAME_MS * 3)).toBe(GAME_SECONDS);
    expect(REVEAL_GAME_MS).toBe(20_000);
  });

  it("shows the plays made so far and their running score", () => {
    expect(playsBy(sim, 0)).toBe(0);
    expect(playsBy(sim, 10)).toBe(2);
    expect(playsBy(sim, 2000)).toBe(3);
    expect(playsBy(sim, GAME_SECONDS)).toBe(4);
    expect(scoreAfter(sim, 0)).toEqual([0, 0]);
    expect(scoreAfter(sim, 3)).toEqual([4, 3]);
    expect(scoreAfter(sim, 9)).toEqual([4, 4]);
  });

  it("plays each game, pauses on its final, and moves on", () => {
    let clock = advanceReveal(REVEAL_START, REVEAL_GAME_MS - 1, 3);
    expect(atFinal(clock)).toBe(false);
    clock = advanceReveal(clock, 1, 3);
    expect(atFinal(clock)).toBe(true);
    expect(clock.index).toBe(0);
    clock = advanceReveal(clock, REVEAL_PAUSE_MS, 3);
    expect(clock).toEqual({ index: 1, elapsed: 0, done: false });
    clock = advanceReveal(clock, REVEAL_GAME_MS + REVEAL_PAUSE_MS, 3);
    clock = advanceReveal(clock, REVEAL_GAME_MS + REVEAL_PAUSE_MS, 3);
    expect(clock.done).toBe(true);
    expect(advanceReveal(clock, 5000, 3)).toBe(clock);
  });

  it("Skip jumps to the final, then to the next game", () => {
    let clock = skipGame({ index: 0, elapsed: 4000, done: false }, 3);
    expect(clock).toEqual({ index: 0, elapsed: REVEAL_GAME_MS, done: false });
    clock = skipGame(clock, 3);
    expect(clock).toEqual({ index: 1, elapsed: 0, done: false });
    clock = skipGame(skipGame(clock, 3), 3);
    clock = skipGame(skipGame(clock, 3), 3);
    expect(clock.done).toBe(true);
    expect(clock.index).toBe(2);
  });

  it("ignores a clock that runs backwards", () => {
    expect(advanceReveal({ index: 0, elapsed: 500, done: false }, -100, 3).elapsed).toBe(500);
  });
});

describe("results text", () => {
  it("counts down to the next puzzle", () => {
    expect(formatCountdown(0)).toBe("0:00:00");
    expect(formatCountdown(999)).toBe("0:00:01");
    expect(formatCountdown(((5 * 60 + 12) * 60 + 9) * 1000)).toBe("5:12:09");
    expect(countdownWords(((5 * 60 + 12) * 60 + 9) * 1000)).toBe("5 hours 13 minutes");
    expect(countdownWords(61 * 60 * 1000)).toBe("1 hour 1 minute");
    expect(countdownWords(20 * 1000)).toBe("1 minute");
  });

  it("shows accuracy as a whole percent", () => {
    expect(formatAccuracy(null)).toBe("–");
    expect(formatAccuracy(1 / 3)).toBe("33%");
    expect(formatAccuracy(1)).toBe("100%");
  });
});

describe("the puzzle from the committed data", () => {
  const pool = readJson<DailyPool>("daily/teams.json");
  const index = readJson<IndexData>("index.json");

  it("names every team era-correctly and simulates with the day file's engine", () => {
    for (const n of [1, 10, 365]) {
      const day = readJson<DailyDay>(`daily/days/${n}.json`);
      const puzzle = buildPuzzle(day, pool, index.teams);
      expect(puzzle.n).toBe(n);
      expect(puzzle.games).toHaveLength(3);
      puzzle.games.forEach((g, i) => {
        expect(g.index).toBe(i);
        expect(g.teams.map((t) => t.key)).toEqual([day.games[i].a, day.games[i].b]);
        for (const t of g.teams) {
          const entry = index.teams.find((x) => x.key === t.key)!;
          expect([t.season, t.city, t.name]).toEqual([entry.season, entry.city, entry.name]);
          expect(t.starters).toHaveLength(5);
        }
        const expected = simulateGame({
          engine: day.engine,
          n,
          gameIndex: i,
          game: day.games[i],
          teamA: pool.teams[day.games[i].a],
          teamB: pool.teams[day.games[i].b],
        });
        expect(g.sim).toEqual(expected);
      });
      expect(puzzleWinners(puzzle)).toEqual(puzzle.games.map((g) => g.sim.winner));
      expect(Object.keys(shareTeams(puzzle)).sort()).toEqual(day.games.flatMap((g) => [g.a, g.b]).sort());
    }
  });

  it("refuses a team missing from the data", () => {
    const day = readJson<DailyDay>("daily/days/1.json");
    const broken = { ...day, games: [{ ...day.games[0], a: "1900-nobody" }, ...day.games.slice(1)] };
    expect(() => buildPuzzle(broken, pool, index.teams)).toThrow(/1900-nobody|game 1/);
  });
});
