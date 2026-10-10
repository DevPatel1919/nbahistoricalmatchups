// Display text and reveal timing for the Daily Three page (F12 Session 3).
// Pure, so it is unit-tested (tests/unit/daily-page.test.ts).
//
// The model's numbers reach the page only after lock-in, and only as the
// winner's chance (oddsLine, Q1). The exported margin m is never displayed:
// one simulated game's score is a sample, not a prediction (lib/margin.ts).

import { BENCH, GAME_SECONDS, clockAt, type SimGame, type SimPlay } from "../daily/sim";
import type { Side, SigStat, Starter } from "../daily/types";
import { formatPercent } from "./duelFormat";

// ---------------------------------------------------------------------------
// Teams and cards
// ---------------------------------------------------------------------------

/** "1995–96" for the season ending in 1996. */
export function seasonLabel(season: number): string {
  return `${season - 1}–${String(season % 100).padStart(2, "0")}`;
}

/** "1995–96 Chicago Bulls". */
export function fullTeamName(team: { season: number; city: string; name: string }): string {
  return `${seasonLabel(team.season)} ${team.city} ${team.name}`;
}

/** "2010–11 Celtics", for sentences that name a team already on screen. */
export function seasonTeamName(team: { season: number; name: string }): string {
  return `${seasonLabel(team.season)} ${team.name}`;
}

export function formatRecord(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}

/** A signature stat's value: percentages as ".521", the rest to one decimal. */
export function formatStatValue(stat: SigStat, value: number): string {
  if (stat === "FG%" || stat === "3P%") return value.toFixed(3).replace(/^0/, "");
  return value.toFixed(1);
}

/**
 * PPG first, then the signature stats: "30.4 PPG · 2.2 SPG · .427 3P%". A
 * no-break space keeps each value with its label when the line wraps.
 */
export function starterStatLine(starter: Pick<Starter, "ppg" | "sig">): string {
  return [
    `${starter.ppg.toFixed(1)} PPG`,
    ...starter.sig.map((s) => `${formatStatValue(s.stat, s.value)} ${s.stat}`),
  ].join(" · ");
}

// ---------------------------------------------------------------------------
// The simulated game
// ---------------------------------------------------------------------------

/** "Q2 7:41" for elapsed game seconds; "Final" at the end. */
export function clockText(t: number): string {
  if (t >= GAME_SECONDS) return "Final";
  const { quarter, secondsLeft } = clockAt(t);
  const minutes = Math.floor(secondsLeft / 60);
  return `Q${quarter} ${minutes}:${String(secondsLeft % 60).padStart(2, "0")}`;
}

/** "M. Jordan three, +3", "Bench basket, +2", "S. Pippen free throw, +1". */
export function playText(play: SimPlay, starters: Pick<Starter, "short">[]): string {
  const who = play.scorer === BENCH ? "Bench" : (starters[play.scorer]?.short ?? "Bench");
  const what =
    play.kind === "three" ? "three" : play.kind === "two" ? "basket" : play.points === 1 ? "free throw" : "free throws";
  return `${who} ${what}, +${play.points}`;
}

/** How many of the game's plays have happened by game second t. */
export function playsBy(sim: Pick<SimGame, "plays">, t: number): number {
  let lo = 0;
  let hi = sim.plays.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sim.plays[mid].t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The running score after the first `count` plays. */
export function scoreAfter(sim: Pick<SimGame, "plays">, count: number): [number, number] {
  if (count <= 0) return [0, 0];
  const play = sim.plays[Math.min(count, sim.plays.length) - 1];
  return [play.score[0], play.score[1]];
}

/**
 * Q1, decided by the owner on 2026-10-10: after a game's final, name the
 * model's chance for the team that won, as a whole percent that never reads
 * 0% or 100%. Never shown before lock-in.
 */
export function oddsLine(p: number, winner: Side, winnerName: string): string {
  const chance = winner === 0 ? p : 1 - p;
  if (chance < 0.5) return `Upset! The model gave the ${winnerName} ${formatPercent(chance)}.`;
  if (chance === 0.5) return "The model had this one at 50–50.";
  return `The model made the ${winnerName} favourites at ${formatPercent(chance)}.`;
}

export const SIMULATED_GAME_LABEL = "One simulated game. The simulator plays each game at its odds, so upsets happen.";

// ---------------------------------------------------------------------------
// Reveal timing: about 20 seconds a game, then a short pause on the final.
// ---------------------------------------------------------------------------

export const REVEAL_GAME_MS = 20_000;
export const REVEAL_PAUSE_MS = 3_000;

export type RevealClock = { index: number; elapsed: number; done: boolean };

export const REVEAL_START: RevealClock = { index: 0, elapsed: 0, done: false };

/** Game seconds shown after `elapsed` real milliseconds of a game's reveal. */
export function gameSecondsAt(elapsed: number): number {
  return Math.min(GAME_SECONDS, Math.max(0, Math.floor((elapsed / REVEAL_GAME_MS) * GAME_SECONDS)));
}

export function atFinal(clock: RevealClock): boolean {
  return clock.done || clock.elapsed >= REVEAL_GAME_MS;
}

function nextGame(clock: RevealClock, games: number): RevealClock {
  if (clock.index + 1 >= games) return { index: clock.index, elapsed: REVEAL_GAME_MS + REVEAL_PAUSE_MS, done: true };
  return { index: clock.index + 1, elapsed: 0, done: false };
}

/** Moves the reveal on by `deltaMs` of real time. */
export function advanceReveal(clock: RevealClock, deltaMs: number, games: number): RevealClock {
  if (clock.done) return clock;
  const elapsed = clock.elapsed + Math.max(0, deltaMs);
  if (elapsed >= REVEAL_GAME_MS + REVEAL_PAUSE_MS) return nextGame(clock, games);
  return { ...clock, elapsed };
}

/** Skip: jumps the current game to its final, or past the pause to the next game. */
export function skipGame(clock: RevealClock, games: number): RevealClock {
  if (clock.done) return clock;
  if (clock.elapsed < REVEAL_GAME_MS) return { ...clock, elapsed: REVEAL_GAME_MS };
  return nextGame(clock, games);
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** "5:12:09" until the next puzzle. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Spoken form of the countdown, rounded up to the minute, for its accessible name. */
export function countdownWords(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts = [];
  if (h > 0) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
  if (m > 0 || h === 0) parts.push(`${m} ${m === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

/** Pick accuracy as a whole percent, or a dash before the first day. */
export function formatAccuracy(accuracy: number | null): string {
  return accuracy === null ? "–" : `${Math.round(accuracy * 100)}%`;
}
