import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelResult } from "../../src/duel";
import {
  boardDescription,
  boardEmpty,
  completionOutcome,
  formatLastTen,
  formatRatingChange,
  formatTimeLeft,
  matchNote,
  resultHeadline,
  formatMissing,
  formatPercent,
  formatPoints,
  formatRecord,
  formatRest,
  formatWinLoss,
  tierStakes,
} from "../../src/lib/duelFormat";
import { clearGuestToken, loadDraft, readGuestToken, saveDraft, writeGuestToken } from "../../src/lib/duelStorage";

describe("duel display text", () => {
  it("shows the published stakes for every tier with a true minus sign", () => {
    expect(tierStakes("lean")).toEqual([19, -21]);
    expect(tierStakes("confident")).toEqual([64, -96]);
    expect(tierStakes("lock")).toEqual([96, -224]);
    expect(formatPoints(64)).toBe("+64");
    expect(formatPoints(-224)).toBe("−224");
    expect(formatPoints(0)).toBe("0");
  });

  it("formats rest, form, records, and missing rotation strength", () => {
    expect(formatRest({ restDays: 1, backToBack: true })).toBe("Back-to-back");
    expect(formatRest({ restDays: 2, backToBack: false })).toBe("2 days");
    expect(formatRest({ restDays: 7, backToBack: false })).toBe("7+ days");
    expect(formatRecord(22, 12)).toBe("22–12");
    expect(formatLastTen({ last10WinPct: 0.8, last10NetRating: 5.24 })).toBe("8–2, net +5.2");
    expect(formatLastTen({ last10WinPct: 0.3, last10NetRating: -0.9 })).toBe("3–7, net −0.9");
    expect(formatMissing(0)).toBe("None");
    expect(formatMissing(11.64)).toBe("11.6");
  });

  it("never rounds a model probability to 0% or 100%", () => {
    expect(formatPercent(0.996)).toBe(">99%");
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0.625)).toBe("63%");
  });
});

describe("duel storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGuestToken();
  });

  const throwingStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };

  it("keeps the guest token in memory when storage is blocked", () => {
    vi.stubGlobal("localStorage", throwingStorage);
    expect(readGuestToken()).toBeNull();
    writeGuestToken("t-123");
    expect(readGuestToken()).toBe("t-123");
    clearGuestToken();
    expect(readGuestToken()).toBeNull();
  });

  it("round-trips a draft and drops invalid or foreign picks", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const draft = loadDraft("d1", ["a", "b"]);
    expect(draft.picks).toEqual({});
    expect(draft.idempotencyKey).toMatch(/^[0-9a-f]{24}$/);
    saveDraft("d1", { idempotencyKey: draft.idempotencyKey, picks: { a: { side: "home", confidence: "lock" } } });
    expect(loadDraft("d1", ["a", "b"])).toEqual({ idempotencyKey: draft.idempotencyKey, picks: { a: { side: "home", confidence: "lock" } } });

    store.set("ct:duel:draft:v1:d1", JSON.stringify({
      idempotencyKey: "k",
      picks: { a: { side: "middle", confidence: "certain" }, z: { side: "home", confidence: "lean" } },
    }));
    expect(loadDraft("d1", ["a", "b"])).toEqual({ idempotencyKey: "k", picks: { a: { side: undefined, confidence: undefined } } });

    store.set("ct:duel:draft:v1:d1", "{not json");
    expect(loadDraft("d1", ["a"]).picks).toEqual({});
  });

  it("starts an empty draft when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", throwingStorage);
    expect(loadDraft("d2", ["a"]).picks).toEqual({});
    expect(() => saveDraft("d2", { idempotencyKey: "k", picks: {} })).not.toThrow();
  });
});

describe("match results (F09 Session 6)", () => {
  const base = (over: Partial<DuelResult>): DuelResult => ({
    duelId: "d_1",
    mode: "ranked",
    puzzles: [],
    you: { total: 120, picks: [] },
    model: { label: "Pre-game model", total: 80, picks: [], trainedThroughSeason: 2021 },
    opponent: null,
    match: null,
    ...over,
  });
  const player = (outcome: "you" | "opponent" | "draw", total: number, decidedBy: "total" | "forfeit" = "total") => ({
    kind: "player" as const,
    name: "Guard Dog",
    total,
    picks: null,
    outcome,
    decidedBy,
  });

  it("headlines wins, losses, draws, and forfeits against a named player", () => {
    expect(resultHeadline(base({ opponent: player("you", -40) }))).toBe("You beat Guard Dog, 120 to −40.");
    expect(resultHeadline(base({ opponent: player("opponent", 300) }))).toBe("Guard Dog won, 300 to 120.");
    expect(resultHeadline(base({ opponent: player("draw", 120) }))).toBe("A draw with Guard Dog at 120.");
    expect(resultHeadline(base({ opponent: player("you", 0, "forfeit") }))).toBe("Guard Dog didn't lock in in time. You win by forfeit.");
    expect(resultHeadline(base({}))).toBe("You scored 120, ahead of the pre-game model.");
  });

  it("says how a match settled and whether it moved rating", () => {
    const rating = { before: 1200, after: 1220, delta: 20, k: 40 };
    expect(formatRatingChange(rating)).toBe("1,200 → 1,220 (+20)");
    expect(formatRatingChange({ before: 1210, after: 1195, delta: -15, k: 24 })).toBe("1,210 → 1,195 (−15)");
    expect(matchNote("bot", null)).toBeNull();
    expect(matchNote("ranked", { settledBy: "both-locked", rated: true, rating })).toBe("Rated duel. Your rating: 1,200 → 1,220 (+20).");
    expect(matchNote("ranked", { settledBy: "forfeit", rated: true, rating })).toContain("A forfeit counts as a loss");
    expect(matchNote("ranked", { settledBy: "no-opponent", rated: false, rating: null })).toMatch(/Sparring Partner\. It doesn't count toward your rating/);
    expect(matchNote("friend", { settledBy: "both-locked", rated: false, rating: null })).toBe("Friend duels are unranked.");
    expect(matchNote("friend", { settledBy: "no-opponent", rated: false, rating: null })).toMatch(/^Nobody took your invite/);
  });

  it("reports the analytics outcome from the viewer's side", () => {
    expect(completionOutcome(base({ opponent: player("you", 0) }))).toEqual({ outcome: "win", beatModel: true });
    expect(completionOutcome(base({ opponent: player("opponent", 500), you: { total: 10, picks: [] } }))).toEqual({ outcome: "loss", beatModel: false });
    expect(completionOutcome(base({}))).toEqual({ outcome: "solo", beatModel: true });
  });

  it("describes time left in round words", () => {
    const now = 1_000_000;
    expect(formatTimeLeft(now + 30_000, now)).toBe("less than a minute");
    expect(formatTimeLeft(now + 60_000, now)).toBe("about 1 minute");
    expect(formatTimeLeft(now + 40 * 60_000, now)).toBe("about 40 minutes");
    expect(formatTimeLeft(now + 23.6 * 3600_000, now)).toBe("about 24 hours");
  });
});

describe("leaderboards (F09 Session 7)", () => {
  it("shows draws only when there are some", () => {
    expect(formatWinLoss(4, 1, 0)).toBe("4–1");
    expect(formatWinLoss(4, 1, 2)).toBe("4–1–2");
  });

  it("describes each board and its empty state", () => {
    expect(boardDescription("daily", 1)).toBe("Rated duels since midnight UTC, ranked by rating gained today.");
    expect(boardDescription("30d", 5)).toBe("Players with at least 5 rated duels in the last 30 days, ranked by current rating.");
    expect(boardEmpty("daily", 1)).toBe("No rated duels yet today.");
    expect(boardEmpty("30d", 5)).toBe("Nobody has played 5 rated duels in the last 30 days yet.");
  });
});
