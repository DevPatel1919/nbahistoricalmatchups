// Privacy-preserving visitor measurement (F05). No identifier ever leaves the
// browser. Instead each browser keeps its first-visit date locally and reports
// only coarse facts: its first-visit ISO week, a days-since-first-visit bucket,
// and whether this is its first return. That is enough for a cohort return
// rate (first returns within 7 days / first visits, per cohort week) without
// user ids.

import type { DaysBucket } from "./analytics";

const FIRST_VISIT_KEY = "ct:first-visit";
const RETURNED_KEY = "ct:returned";
const SESSION_KEY = "ct:visit-reported";
const CORE_JOB_KEY = "ct:core-job-done";
const VARIANT_PREFIX = "ct:experiment:";

/** ISO 8601 week of a date, e.g. "2026-W39" (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" in UTC. */
export function dayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 86_400_000);
}

export function daysBucket(days: number): DaysBucket {
  if (days <= 0) return "0";
  if (days <= 7) return "1-7";
  if (days <= 30) return "8-30";
  return "31+";
}

export interface VisitFacts {
  visitKind: "first" | "return";
  cohortWeek: string;
  daysSinceFirstVisit: DaysBucket;
  firstReturn: boolean;
}

/** Minimal storage interface, so the logic can be tested without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Works out this visit's facts and records what is needed for the next one.
 * A "return" is a visit on a later calendar day than the first visit; a visit
 * later on the first day is still "first".
 */
export function recordVisit(store: KeyValueStore, now: Date): VisitFacts {
  const today = dayString(now);
  let firstDay = store.getItem(FIRST_VISIT_KEY);
  if (!firstDay || !/^\d{4}-\d{2}-\d{2}$/.test(firstDay) || daysBetween(firstDay, today) < 0) {
    firstDay = today;
    store.setItem(FIRST_VISIT_KEY, firstDay);
  }
  const days = daysBetween(firstDay, today);
  const isReturn = days > 0;
  const firstReturn = isReturn && store.getItem(RETURNED_KEY) !== "1";
  if (firstReturn) store.setItem(RETURNED_KEY, "1");
  return {
    visitKind: isReturn ? "return" : "first",
    cohortWeek: isoWeek(new Date(`${firstDay}T00:00:00Z`)),
    daysSinceFirstVisit: daysBucket(days),
    firstReturn,
  };
}

/** This visit's facts, once per browser session; null if already reported or storage is unavailable. */
export function visitOncePerSession(now: Date = new Date()): VisitFacts | null {
  try {
    if (sessionStorage.getItem(SESSION_KEY) === "1") return null;
    sessionStorage.setItem(SESSION_KEY, "1");
    return recordVisit(localStorage, now);
  } catch {
    return null;
  }
}

/**
 * Marks that this browser has completed a core job (a matchup result or a
 * revealed tournament). Price intent only counts as qualified after one.
 */
export function markCoreJobDone(): void {
  try {
    localStorage.setItem(CORE_JOB_KEY, "1");
  } catch {
    // Unqualified intent is still recorded; it just is not marked qualified.
  }
}

export function hasCompletedCoreJob(): boolean {
  try {
    return localStorage.getItem(CORE_JOB_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A sticky experiment arm for this browser. Assignment uses Math.random: it
 * decides what this visitor is shown, never a shareable model outcome.
 */
export function experimentVariant<T extends string>(experiment: string, variants: readonly T[], random: () => number = Math.random): T {
  const key = VARIANT_PREFIX + experiment;
  try {
    const stored = localStorage.getItem(key);
    if (stored && (variants as readonly string[]).includes(stored)) return stored as T;
    const chosen = variants[Math.floor(random() * variants.length) % variants.length];
    localStorage.setItem(key, chosen);
    return chosen;
  } catch {
    return variants[0];
  }
}
