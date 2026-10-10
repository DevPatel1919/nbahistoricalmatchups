// Daily Three crowd stats (F12 Session 4): the browser id, and the crowd lines
// the results show. Pure, so it is unit-tested (tests/unit/daily-crowd.test.ts);
// the page does the network calls through lib/duelApi.ts.
//
// Crowd lines appear only after lock-in, or they would be a hint. Anything
// unexpected in a stats answer hides them: the game never depends on the API.

import type { DailyStore } from "../daily/stats";
import type { DailyCrowdStats, Side } from "../daily/types";
import { GAMES_PER_DAY } from "../daily/types";

/** A random v4 UUID; crypto.randomUUID where the browser has it. */
export function newClientId(cryptoApi: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = crypto): string {
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The store with a browser id, made once and kept from then on. */
export function withClientId(store: DailyStore, makeId: () => string = newClientId): DailyStore {
  return store.clientId ? store : { ...store, clientId: makeId() };
}

const isCount = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

/**
 * A stats answer for puzzle n, checked. Null when it is malformed, for another
 * puzzle, or has no players yet: the page then shows no crowd lines.
 */
export function parseCrowdStats(value: unknown, n: number): DailyCrowdStats | null {
  if (typeof value !== "object" || value === null) return null;
  const { n: gotN, players, picks, scores } = value as Record<string, unknown>;
  if (gotN !== n || !isCount(players) || players < 1) return null;
  if (!Array.isArray(picks) || picks.length !== GAMES_PER_DAY) return null;
  for (const pair of picks) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(isCount) || pair[0] + pair[1] !== players) return null;
  }
  if (!Array.isArray(scores) || scores.length !== GAMES_PER_DAY + 1 || !scores.every(isCount)) return null;
  if (scores.reduce((a: number, b: number) => a + b, 0) !== players) return null;
  return { n, players, picks: picks.map((p) => [p[0], p[1]] as [number, number]), scores: [...scores] };
}

/** A whole percent of the crowd. Crowd counts are facts, so 0% and 100% can show. */
export function crowdPercent(count: number, players: number): string {
  return `${Math.round((count / players) * 100)}%`;
}

/**
 * One game's crowd line: the side most players picked, "62% picked the
 * 1995–96 Bulls". An even split names neither.
 */
export function crowdPickLine(pair: [number, number], players: number, names: [string, string]): string {
  if (pair[0] === pair[1]) return `The crowd split evenly between the ${names[0]} and the ${names[1]}.`;
  const side: Side = pair[0] > pair[1] ? 0 : 1;
  return `${crowdPercent(pair[side], players)} picked the ${names[side]}.`;
}

/** "41% went 3/3." */
export function crowdPerfectLine(stats: Pick<DailyCrowdStats, "players" | "scores">): string {
  return `${crowdPercent(stats.scores[GAMES_PER_DAY], stats.players)} went ${GAMES_PER_DAY}/${GAMES_PER_DAY}.`;
}

/** "1 player" / "37 players". */
export function crowdPlayers(players: number): string {
  return `${players.toLocaleString("en-US")} ${players === 1 ? "player" : "players"}`;
}
