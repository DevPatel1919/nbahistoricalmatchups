import { afterEach, describe, expect, it } from "vitest";
import { registerAnalyticsSink, resetAnalyticsSinks, track, type AnalyticsEvent } from "../../src/lib/analytics";
import { configuredProvider, plausiblePayload } from "../../src/lib/analyticsProviders";
import { daysBucket, isoWeek, recordVisit, type KeyValueStore } from "../../src/lib/visitor";
import { matchupCardData, tournamentCardData } from "../../src/share/cardData";
import { CREATOR_OFFER, FAN_OFFERS } from "../../src/data/offers";
import { runBracket, runTitleOdds, type TournamentDefinition } from "../../src/tournament";
import type { IndexTeam } from "../../src/types";
import { REAL_FIELD_8, readTeamFile, realTable, unwrap } from "./fixtures";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("track", () => {
  afterEach(() => resetAnalyticsSinks());

  it("delivers to every sink and survives a sink that throws", () => {
    const received: AnalyticsEvent[] = [];
    registerAnalyticsSink(() => {
      throw new Error("provider down");
    });
    registerAnalyticsSink((e) => received.push(e));
    expect(() => track({ name: "theme_changed", theme: "dark" })).not.toThrow();
    expect(received).toEqual([{ name: "theme_changed", theme: "dark" }]);
  });

  it("stops delivering after unsubscribe", () => {
    const received: AnalyticsEvent[] = [];
    const off = registerAnalyticsSink((e) => received.push(e));
    off();
    track({ name: "theme_changed", theme: "light" });
    expect(received).toEqual([]);
  });
});

describe("Plausible provider", () => {
  const config = { domain: "courtofalltime.example", host: "https://plausible.io" };

  it("sends the event name and properties, never the query string or fragment", () => {
    const payload = plausiblePayload(
      { name: "matchup_completed", teamA: "1998-bulls", teamB: "2017-warriors", extrapolationWarning: false },
      config,
      { origin: "https://courtofalltime.example", pathname: "/1998-bulls-vs-2017-warriors" },
    );
    expect(payload).toEqual({
      name: "matchup_completed",
      domain: "courtofalltime.example",
      url: "https://courtofalltime.example/1998-bulls-vs-2017-warriors",
      props: { teamA: "1998-bulls", teamB: "2017-warriors", extrapolationWarning: false, schema: 1 },
    });
  });

  it("is inert unless a domain is configured", () => {
    expect(configuredProvider({})).toBeNull();
    expect(configuredProvider({ VITE_PLAUSIBLE_DOMAIN: "  " })).toBeNull();
    expect(configuredProvider({ VITE_PLAUSIBLE_DOMAIN: "x.example" })).toBeTypeOf("function");
  });
});

describe("visitor cohorts", () => {
  it("computes ISO weeks, including year boundaries", () => {
    expect(isoWeek(new Date("2026-09-23T12:00:00Z"))).toBe("2026-W39");
    expect(isoWeek(new Date("2021-01-03T00:00:00Z"))).toBe("2020-W53");
    expect(isoWeek(new Date("2024-12-30T00:00:00Z"))).toBe("2025-W01");
    expect(isoWeek(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
  });

  it("buckets days since the first visit", () => {
    expect([0, 1, 7, 8, 30, 31, 400].map(daysBucket)).toEqual(["0", "1-7", "1-7", "8-30", "8-30", "31+", "31+"]);
  });

  it("reports a first visit, then exactly one first return, keyed to the first-visit week", () => {
    const store = memoryStore();
    const at = (day: string) => recordVisit(store, new Date(`${day}T15:00:00Z`));

    expect(at("2026-09-23")).toEqual({ visitKind: "first", cohortWeek: "2026-W39", daysSinceFirstVisit: "0", firstReturn: false });
    // Later the same day is still the first visit.
    expect(at("2026-09-23").visitKind).toBe("first");
    expect(at("2026-09-26")).toEqual({ visitKind: "return", cohortWeek: "2026-W39", daysSinceFirstVisit: "1-7", firstReturn: true });
    expect(at("2026-09-28")).toEqual({ visitKind: "return", cohortWeek: "2026-W39", daysSinceFirstVisit: "1-7", firstReturn: false });
    expect(at("2026-11-02").daysSinceFirstVisit).toBe("31+");
    // Only coarse facts are stored: the first-visit day and a returned flag.
    expect([...store.data.keys()].sort()).toEqual(["ct:first-visit", "ct:returned"]);
  });

  it("starts over when the stored date is corrupt or in the future", () => {
    for (const bad of ["garbage", "2030-01-01"]) {
      const store = memoryStore();
      store.setItem("ct:first-visit", bad);
      expect(recordVisit(store, new Date("2026-09-23T10:00:00Z")).visitKind).toBe("first");
      expect(store.getItem("ct:first-visit")).toBe("2026-09-23");
    }
  });
});

describe("share card data", () => {
  const team = (key: string, season: number, name: string, madePlayoffs = true): IndexTeam => ({
    key,
    season,
    city: "City",
    name,
    franchiseId: 1,
    madePlayoffs,
    wins: 60,
    losses: 22,
    netRating: 8,
    offRating: 110,
    defRating: 102,
    pace: 95,
    trueShooting: 0.57,
  });

  it("describes the matchup from the winner's side, with a rounded margin", () => {
    const a = team("1998-bulls", 1998, "Bulls");
    const b = team("2017-warriors", 2017, "Warriors", false);
    const data = matchupCardData(a, b, { p: 0.3, m: -4.4 });
    expect(data.winner).toBe("b");
    expect(data.winProbability).toBeCloseTo(0.7, 12);
    expect(data.seriesProbability).toBeGreaterThan(0.7);
    expect(data.marginText).toBe("by about 4 pts");
    expect(data.teamB.missedPlayoffs).toBe(true);
    expect(data.teamA.record).toBe("60-22");
  });

  it("describes the tournament from the model's story and odds, with no picks unless given", () => {
    const def: TournamentDefinition = { version: 1, entrants: REAL_FIELD_8, seed: "card", seriesBestOf: 7 };
    const table = realTable(REAL_FIELD_8);
    const bracket = unwrap(runBracket(def, table));
    const odds = unwrap(runTitleOdds(def, table, 2000));
    const data = tournamentCardData("Test", bracket, odds, (k) => k.toUpperCase());

    expect(data.champion).toBe(bracket.champion.toUpperCase());
    expect(data.championSeed).toBe(REAL_FIELD_8.indexOf(bracket.champion) + 1);
    expect(data.finalLine).toMatch(/^Beat [A-Z0-9-]+ 4-[0-3] in the final$/);
    expect(data.topOdds).toHaveLength(4);
    const probs = data.topOdds.map((o) => o.probability);
    expect([...probs].sort((x, y) => y - x)).toEqual(probs);
    expect(data.fanLine).toBeUndefined();
    expect(data.subtitle).toBe("8 teams · best-of-7 · neutral court");
  });

  it("reads the real export", () => {
    // Sanity: the fixture files exist for the card's source data.
    expect(Object.keys(readTeamFile("1998-bulls").opponents).length).toBeGreaterThan(800);
  });
});

describe("offers", () => {
  it("shows the F05 test prices, with unique ids that carry the price", () => {
    const all = [...FAN_OFFERS, CREATOR_OFFER];
    expect(all.map((o) => [o.id, o.price])).toEqual([
      ["fan-annual-49", "$49"],
      ["tournament-pass-999", "$9.99"],
      ["creator-pilot-99", "$99"],
    ]);
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
  });
});

describe("card percentages", () => {
  it("never rounds an estimate to certainty or to zero", async () => {
    const { percent } = await import("../../src/share/cards");
    expect(percent(0.9997)).toBe(">99.9%");
    expect(percent(0.0003)).toBe("<0.1%");
    expect(percent(0.738)).toBe("73.8%");
    expect(percent(0)).toBe("0.0%");
  });
});
