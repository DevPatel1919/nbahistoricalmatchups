import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatLastTen,
  formatMissing,
  formatPercent,
  formatPoints,
  formatRecord,
  formatRest,
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
