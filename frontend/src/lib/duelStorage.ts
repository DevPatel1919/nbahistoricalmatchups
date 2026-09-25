// Browser storage for duel mode. Every access is guarded: with storage blocked
// the guest token and in-progress picks last for the page only, and play works.

import { isConfidence, type Confidence, type Side } from "../duel";

const GUEST_KEY = "ct:duel:guest:v1";
const SESSION_KEY = "ct:duel:session:v1";
const DRAFT_PREFIX = "ct:duel:draft:v1:";

let memoryToken: string | null = null;
let memorySession: string | null = null;

export function readGuestToken(): string | null {
  try {
    return localStorage.getItem(GUEST_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function writeGuestToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(GUEST_KEY, token);
  } catch {
    // Storage blocked: the token lives in memory for this page.
  }
}

export function clearGuestToken(): void {
  memoryToken = null;
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    // Nothing stored.
  }
}

/** The account session token, present only while signed in. */
export function readSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY) ?? memorySession;
  } catch {
    return memorySession;
  }
}

export function writeSessionToken(token: string): void {
  memorySession = token;
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    // Storage blocked: signed in for this page only.
  }
}

export function clearSessionToken(): void {
  memorySession = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored.
  }
}

export type DraftPick = { side?: Side; confidence?: Confidence };

/** Picks made so far, plus the idempotency key reused by every retry of this duel's submission. */
export type Draft = { picks: Record<string, DraftPick>; idempotencyKey: string };

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function loadDraft(duelId: string, puzzleIds: readonly string[]): Draft {
  const empty: Draft = { picks: {}, idempotencyKey: newKey() };
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + duelId);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.idempotencyKey !== "string" || !parsed.picks || typeof parsed.picks !== "object") return empty;
    const picks: Record<string, DraftPick> = {};
    for (const id of puzzleIds) {
      const p = (parsed.picks as Record<string, DraftPick>)[id];
      if (!p) continue;
      picks[id] = {
        side: p.side === "home" || p.side === "away" ? p.side : undefined,
        confidence: isConfidence(p.confidence) ? p.confidence : undefined,
      };
    }
    return { picks, idempotencyKey: parsed.idempotencyKey };
  } catch {
    return empty;
  }
}

export function saveDraft(duelId: string, draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + duelId, JSON.stringify(draft));
  } catch {
    // Storage blocked: the draft lasts for this page.
  }
}

export function clearDraft(duelId: string): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + duelId);
  } catch {
    // Nothing stored.
  }
}
