// F09 Session 7: the detection rules as pure functions. The lookup-control
// rule's false-positive rate and power are computed exactly from the binomial
// distribution, not sampled.

import { describe, expect, it } from "vitest";
import {
  ACCURACY_CEILING,
  ACCURACY_MIN_PICKS,
  FORFEIT_FEED_MIN,
  PAIR_ONE_SIDED_MIN,
  PAIR_REPEAT_MAX,
  TIMING_FAST_MS,
  TIMING_MIN_SETS,
  accuracyFinding,
  collusionFindings,
  confidenceEntropy,
  pairKey,
  timingFinding,
  wilsonLowerBound,
  type Finding,
  type RatedMatch,
  type SetMetrics,
} from "../src/integrity-rules";

const never = () => 0;

function sets(n: number, correctPerSet: number, msToSubmit = 90_000): SetMetrics[] {
  return Array.from({ length: n }, (_, i) => ({
    submittedAt: 1_000_000 - i,
    msToSubmit,
    picks: 5,
    correct: correctPerSet,
    lockPicks: 0,
    lockCorrect: 0,
  }));
}

/** P(rule flags) for a player whose picks are independently right with probability p, over n picks. */
function flagProbability(p: number, n: number): number {
  let pmf = Math.pow(1 - p, n);
  let total = 0;
  for (let k = 0; k <= n; k++) {
    if (wilsonLowerBound(k, n) > ACCURACY_CEILING) total += pmf;
    pmf = (pmf * (n - k) * p) / ((k + 1) * (1 - p));
  }
  return total;
}

describe("lookup control: sustained accuracy above the honest ceiling", () => {
  it("the Wilson bound matches known values", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(50, 50)).toBeCloseTo(1 / (1 + 3.09 ** 2 / 50), 6);
    expect(wilsonLowerBound(35, 50, 1.96)).toBeCloseTo(0.5625, 3);
  });

  it(`a model-level player (69.5%) is flagged less than 1% of the time at every window size`, () => {
    for (let n = ACCURACY_MIN_PICKS; n <= 250; n += 5) expect(flagProbability(0.695, n), "n=" + n).toBeLessThan(0.01);
    // A strong honest player (65%) essentially never.
    for (let n = ACCURACY_MIN_PICKS; n <= 250; n += 5) expect(flagProbability(0.65, n), "n=" + n).toBeLessThan(0.0005);
  });

  it("a player looking up most answers (90%) is caught within 100 picks", () => {
    expect(flagProbability(0.9, 100)).toBeGreaterThan(0.95);
    expect(flagProbability(0.9, 250)).toBeGreaterThan(0.999);
    expect(flagProbability(0.999, ACCURACY_MIN_PICKS)).toBeGreaterThan(0.99);
  });

  it("needs ten sets before judging, and reports its evidence", () => {
    expect(accuracyFinding("a", sets(9, 5))).toBeNull();
    const f = accuracyFinding("a", sets(10, 5));
    expect(f).toMatchObject({ accountId: "a", kind: "accuracy_ceiling", related: "", evidence: { picks: 50, correct: 50, accuracy: 1, ceiling: 0.68 } });
    expect(accuracyFinding("a", sets(50, 4))).not.toBeNull(); // 80% over 250 picks
    expect(accuracyFinding("a", sets(50, 3))).toBeNull(); // 60%
  });

  it("uses only the most recent 50 sets", () => {
    const recentHonest = [...sets(50, 3), ...sets(50, 5)];
    expect(accuracyFinding("a", recentHonest)).toBeNull();
  });
});

describe("scripted submission timing", () => {
  it(`flags a median lock-in under ${TIMING_FAST_MS / 1000} s over at least ${TIMING_MIN_SETS} sets`, () => {
    expect(timingFinding("a", sets(TIMING_MIN_SETS - 1, 3, 1_000))).toBeNull();
    expect(timingFinding("a", sets(TIMING_MIN_SETS, 3, 1_000))).toMatchObject({ kind: "scripted_timing", evidence: { sets: 5, medianMs: 1000 } });
    expect(timingFinding("a", sets(10, 3, TIMING_FAST_MS))).toBeNull();
  });

  it("one slow set does not hide a script, and one fast set does not flag a human", () => {
    expect(timingFinding("a", [...sets(1, 3, 600_000), ...sets(6, 3, 900)])).not.toBeNull();
    expect(timingFinding("a", [...sets(1, 3, 900), ...sets(6, 3, 75_000)])).toBeNull();
  });
});

describe("confidence entropy", () => {
  it("is 0 for one tier and log2(3) for an even spread", () => {
    expect(confidenceEntropy(["lock", "lock", "lock"])).toBe(0);
    expect(confidenceEntropy(["lean", "confident", "lock"])).toBeCloseTo(Math.log2(3), 3);
    expect(confidenceEntropy([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------

let seq = 0;
function m(winner: string, loser: string, opts: { forfeit?: boolean; draw?: boolean; at?: number; creator?: string } = {}): RatedMatch {
  // A forfeit is always the opponent seat failing to lock in, so the winner created the match.
  const creator = opts.forfeit ? winner : (opts.creator ?? winner);
  const opponent = creator === winner ? loser : winner;
  return {
    matchId: "m" + ++seq,
    creator,
    opponent,
    outcome: opts.draw ? "draw" : creator === winner ? "creator" : "opponent",
    settledBy: opts.forfeit ? "forfeit" : "both-locked",
    resolvedAt: opts.at ?? 1000 + seq,
  };
}

const kinds = (findings: Finding[], account: string) => findings.filter((f) => f.accountId === account).map((f) => f.kind + ":" + f.related).sort();

describe("collusion and win-trading", () => {
  it("an honest round robin raises nothing", () => {
    const players = ["p1", "p2", "p3", "p4", "p5"];
    const matches: RatedMatch[] = [];
    players.forEach((a, i) => players.slice(i + 1).forEach((b, j) => matches.push(m((i + j) % 2 ? a : b, (i + j) % 2 ? b : a))));
    expect(collusionFindings(matches, new Set(), never)).toEqual([]);
  });

  it(`flags a pair meeting ${PAIR_REPEAT_MAX} times, whoever wins`, () => {
    const matches = Array.from({ length: PAIR_REPEAT_MAX }, (_, i) => (i % 2 ? m("x", "y") : m("y", "x")));
    const f = collusionFindings(matches, new Set(), never);
    expect(kinds(f, "x")).toEqual(["repeat_pair:y"]);
    expect(kinds(f, "y")).toEqual(["repeat_pair:x"]);
    expect(collusionFindings(matches.slice(1), new Set(), never)).toEqual([]);
  });

  it(`flags a one-sided pair over ${PAIR_ONE_SIDED_MIN} meetings`, () => {
    const f = collusionFindings([m("x", "y"), m("x", "y"), m("x", "y"), m("y", "x")], new Set(), never);
    expect(kinds(f, "x")).toEqual(["win_trading:y"]);
    expect(f.find((x) => x.accountId === "x")?.evidence).toEqual({ matches: 4, wins: 3, losses: 1, draws: 0 });
    expect(collusionFindings([m("x", "y"), m("x", "y"), m("y", "x"), m("y", "x")], new Set(), never)).toEqual([]);
  });

  it(`flags ${FORFEIT_FEED_MIN} forfeits to the same opponent, on both accounts`, () => {
    const f = collusionFindings([m("main", "alt", { forfeit: true }), m("main", "alt", { forfeit: true })], new Set(), never);
    expect(kinds(f, "main")).toEqual(["forfeit_feeding:alt"]);
    expect(kinds(f, "alt")).toEqual(["forfeit_feeding:main"]);
    expect(f.find((x) => x.accountId === "alt")?.evidence).toMatchObject({ forfeitsGiven: 2, forfeitsReceived: 0 });
  });

  it("detects a feeder ring whose members each stay under the pair thresholds", () => {
    // Three alts each lose twice to main, and main plays honestly elsewhere.
    const matches = [
      m("main", "alt1"), m("main", "alt1"),
      m("main", "alt2"), m("main", "alt2", { creator: "alt2" }),
      m("main", "alt3"), m("main", "alt3"),
      m("h1", "main"), m("main", "h2"), m("h1", "h2"),
    ];
    const f = collusionFindings(matches, new Set(), never);
    expect(kinds(f, "main")).toEqual(["feeder_ring:"]);
    expect(f.find((x) => x.accountId === "main")?.evidence).toMatchObject({ feeders: 3, winsFromFeeders: 6 });
    for (const alt of ["alt1", "alt2", "alt3"]) expect(kinds(f, alt)).toEqual(["feeder_ring:main"]);
    expect(kinds(f, "h1")).toEqual([]);
    // One feeder alone is not a ring.
    expect(collusionFindings(matches.slice(0, 2), new Set(), never)).toEqual([]);
  });

  it("flags linked accounts (same creation network) that meet in rated play", () => {
    const f = collusionFindings([m("x", "y")], new Set([pairKey("y", "x")]), never);
    expect(kinds(f, "x")).toEqual(["linked_accounts:y"]);
    expect(kinds(f, "y")).toEqual(["linked_accounts:x"]);
  });

  it("after a review, a key is judged only on newer activity; an upheld key is not judged again", () => {
    const matches = [m("x", "y", { forfeit: true, at: 10 }), m("x", "y", { forfeit: true, at: 20 })];
    const reviewedAt = (at: number) => (a: string, kind: string) => (a === "y" && kind === "forfeit_feeding" ? at : 0);
    expect(kinds(collusionFindings(matches, new Set(), reviewedAt(25)), "y")).toEqual([]);
    expect(kinds(collusionFindings(matches, new Set(), reviewedAt(25)), "x")).toEqual(["forfeit_feeding:y"]);
    const later = [...matches, m("x", "y", { forfeit: true, at: 30 }), m("x", "y", { forfeit: true, at: 40 })];
    // Four one-sided meetings also trip win_trading, which was never reviewed.
    expect(kinds(collusionFindings(later, new Set(), reviewedAt(25)), "y")).toEqual(["forfeit_feeding:x", "win_trading:x"]);
    expect(kinds(collusionFindings(later, new Set(), reviewedAt(Number.POSITIVE_INFINITY)), "y")).toEqual(["win_trading:x"]);
  });
});
