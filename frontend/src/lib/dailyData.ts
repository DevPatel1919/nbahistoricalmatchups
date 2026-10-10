// Daily Three data and browser storage for the /daily page (F12 Session 3).
//
// The static files under public/data/daily/ are built by
// scripts/export_daily_data.py and scripts/build_daily_schedule.py. The store
// lives in localStorage under ct:daily:v1 (daily/stats.ts); every access is
// guarded, so with storage blocked a day lasts for the page only and play
// still works.

import { STORAGE_KEY, emptyStore, parseStore, serializeStore, type DailyStore } from "../daily/stats";
import type { DailyDay, DailyMeta, DailyPool } from "../daily/types";

const DAILY_BASE = `${import.meta.env.BASE_URL}data/daily/`;

let metaPromise: Promise<DailyMeta> | null = null;
let poolPromise: Promise<DailyPool> | null = null;
const dayCache = new Map<number, Promise<DailyDay>>();

function fetchJson<T>(path: string): Promise<T> {
  return fetch(DAILY_BASE + path).then((res) => {
    if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
    return res.json() as Promise<T>;
  });
}

function cached<T>(promise: Promise<T>, reset: () => void): Promise<T> {
  // A failed load is retried on the next call instead of sticking.
  promise.catch(reset);
  return promise;
}

export function loadDailyMeta(): Promise<DailyMeta> {
  if (!metaPromise) metaPromise = cached(fetchJson<DailyMeta>("meta.json"), () => (metaPromise = null));
  return metaPromise;
}

export function loadDailyPool(): Promise<DailyPool> {
  if (!poolPromise) poolPromise = cached(fetchJson<DailyPool>("teams.json"), () => (poolPromise = null));
  return poolPromise;
}

export function loadDailyDay(n: number): Promise<DailyDay> {
  let day = dayCache.get(n);
  if (!day) {
    day = cached(fetchJson<DailyDay>(`days/${n}.json`), () => dayCache.delete(n));
    dayCache.set(n, day);
  }
  return day;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

let memoryStore: DailyStore | null = null;

export function readDailyStore(): DailyStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return parseStore(raw);
  } catch {
    // Storage blocked: fall through to this page's copy.
  }
  return memoryStore ?? emptyStore();
}

/** Saves the store. False when the browser would not keep it (the page keeps its own copy). */
export function writeDailyStore(store: DailyStore): boolean {
  memoryStore = store;
  try {
    localStorage.setItem(STORAGE_KEY, serializeStore(store));
    return true;
  } catch {
    return false;
  }
}
