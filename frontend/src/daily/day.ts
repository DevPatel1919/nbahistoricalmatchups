// Puzzle numbering (F12). The day boundary is the player's local midnight, and
// puzzle n is the n-th calendar date from launchDate (#1 is launch day).
//
// Dates are counted as calendar dates with integer arithmetic, never as
// milliseconds divided by 86,400,000: a local day is 23 or 25 hours long across
// a daylight-saving change, and that division would skip or repeat a puzzle.

import type { DailyMeta } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

type CivilDate = { y: number; m: number; d: number };

function parseIsoDate(iso: string): CivilDate {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  const date = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (formatIsoDate(fromDayNumber(toDayNumber(date))) !== iso) throw new Error(`Not a real date: ${iso}`);
  return date;
}

function formatIsoDate({ y, m, d }: CivilDate): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's
// days_from_civil). Integer-only, so no time zone or DST can enter.
function toDayNumber({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(z: number): CivilDate {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** Whole calendar dates from `from` to `to` (YYYY-MM-DD); negative if `to` is earlier. */
export function calendarDaysBetween(from: string, to: string): number {
  return toDayNumber(parseIsoDate(to)) - toDayNumber(parseIsoDate(from));
}

/** The date `days` calendar dates after `iso`. */
export function addCalendarDays(iso: string, days: number): string {
  return formatIsoDate(fromDayNumber(toDayNumber(parseIsoDate(iso)) + days));
}

/** The player's local calendar date (the runtime's time zone) as YYYY-MM-DD. */
export function localDate(now: Date): string {
  return formatIsoDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

/** Puzzle number for a local date: n = calendarDaysBetween(launchDate, date) + 1. */
export function puzzleNumber(launchDate: string, date: string): number {
  return calendarDaysBetween(launchDate, date) + 1;
}

/** Puzzle number at an instant, in the runtime's local time zone. */
export function puzzleNumberAt(launchDate: string, now: Date): number {
  return puzzleNumber(launchDate, localDate(now));
}

/** The calendar date puzzle n belongs to. */
export function puzzleDate(launchDate: string, n: number): string {
  return addCalendarDays(launchDate, n - 1);
}

export type PuzzleStatus =
  | { kind: "ready"; n: number }
  | { kind: "before-launch"; n: number } // n < 1
  | { kind: "not-ready"; n: number }; // n > lastDay: the schedule ran out (the verifier guards against this)

export function puzzleStatus(meta: Pick<DailyMeta, "launchDate" | "lastDay">, now: Date): PuzzleStatus {
  const n = puzzleNumberAt(meta.launchDate, now);
  if (n < 1) return { kind: "before-launch", n };
  if (n > meta.lastDay) return { kind: "not-ready", n };
  return { kind: "ready", n };
}

/** Milliseconds until the next local midnight, when the next puzzle opens. */
export function msUntilNextPuzzle(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}
