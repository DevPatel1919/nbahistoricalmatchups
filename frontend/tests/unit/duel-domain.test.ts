import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_LEVELS,
  CONFIDENCE_PROBABILITY,
  applyElo,
  createRng,
  drawBotPicks,
  drawRankedSet,
  drawUnrankedSet,
  expectedPoints,
  pointsFor,
  resolveDuel,
  sampleBotAccuracy,
  scoreModel,
  scorePick,
  scoreSet,
  type Confidence,
  type Pick,
  type PuzzleAnswer,
  type RecentPick,
  type ScoredPick,
} from "../../src/duel";

const answer = (id: string, actualWinner: "home" | "away", p = 0.6): PuzzleAnswer => ({
  puzzleId: id,
  actualWinner,
  modelHomeWinProbability: p,
});

describe("scoring", () => {
  it("matches the published table at every tier", () => {
    const table: Record<Confidence, [number, number]> = { lean: [19, -21], confident: [64, -96], lock: [96, -224] };
    for (const tier of CONFIDENCE_LEVELS) {
      const right = scorePick({ puzzleId: "p", side: "home", confidence: tier }, answer("p", "home"));
      const wrong = scorePick({ puzzleId: "p", side: "away", confidence: tier }, answer("p", "home"));
      expect([right.points, wrong.points]).toEqual(table[tier]);
      expect(right.correct && !wrong.correct).toBe(true);
    }
  });

  it("scores the model with its continuous probability by the same formula", () => {
    expect(scoreModel(answer("p", "home", 0.8))).toMatchObject({ side: "home", correct: true, points: pointsFor(0.8) });
    expect(scoreModel(answer("p", "home", 0.3))).toMatchObject({ side: "away", correct: false, points: pointsFor(0.3) });
    expect(scoreModel(answer("p", "away", 0.3)).points).toBe(pointsFor(0.7));
    expect(pointsFor(0.5)).toBe(0);
    expect(Object.is(pointsFor(0.5), -0)).toBe(false);
  });

  it("requires exactly one pick per puzzle", () => {
    const answers = [answer("a", "home"), answer("b", "away")];
    const pick = (id: string): Pick => ({ puzzleId: id, side: "home", confidence: "lean" });
    expect(scoreSet([pick("b"), pick("a")], answers).map((s) => s.puzzleId)).toEqual(["a", "b"]);
    expect(() => scoreSet([pick("a")], answers)).toThrow();
    expect(() => scoreSet([pick("a"), pick("a")], answers)).toThrow();
    expect(() => scoreSet([pick("a"), pick("c")], answers)).toThrow();
  });
});

describe("the scoring rule is proper", () => {
  const nearestTier = (q: number): Confidence =>
    CONFIDENCE_LEVELS.reduce((best, c) =>
      Math.abs(CONFIDENCE_PROBABILITY[c] - q) < Math.abs(CONFIDENCE_PROBABILITY[best] - q) ? c : best,
    );

  it("an honest tier maximizes expected points for every belief", () => {
    for (let q = 0.5; q < 1; q += 0.001) {
      const mid = [0.625, 0.8].some((m) => Math.abs(q - m) < 1e-9);
      if (mid) continue;
      const best = CONFIDENCE_LEVELS.reduce((b, c) =>
        expectedPoints(CONFIDENCE_PROBABILITY[c], q) > expectedPoints(CONFIDENCE_PROBABILITY[b], q) ? c : b,
      );
      expect(best, "belief " + q.toFixed(3)).toBe(nearestTier(q));
    }
  });

  it("picking the side you believe in beats the other side at every tier", () => {
    for (let q = 0.501; q < 1; q += 0.01) {
      for (const c of CONFIDENCE_LEVELS) {
        expect(expectedPoints(CONFIDENCE_PROBABILITY[c], q)).toBeGreaterThan(expectedPoints(CONFIDENCE_PROBABILITY[c], 1 - q));
      }
    }
  });

  it("an overconfident player loses in expectation to an honest one at the same belief", () => {
    const q = 0.6;
    expect(expectedPoints(CONFIDENCE_PROBABILITY.lock, q)).toBeLessThan(expectedPoints(CONFIDENCE_PROBABILITY.lean, q));
  });
});

describe("resolveDuel", () => {
  const s = (id: string, points: number, correct = points > 0): ScoredPick => ({
    puzzleId: id,
    side: "home",
    probability: 0.7,
    correct,
    points,
  });
  const ids = ["1", "2", "3", "4", "5"];
  const set = (pts: number[], correct?: boolean[]) => pts.map((p, i) => s(ids[i], p, correct?.[i]));

  it("higher total wins", () => {
    const r = resolveDuel(set([19, 19, 19, 19, 19]), set([64, -21, 19, 19, 19]));
    expect(r).toEqual({ outcome: "b", totalA: 95, totalB: 100, decidedBy: "total" });
  });

  it("breaks a tied total with the higher-scoring single correct call", () => {
    // Both total 38; B's best correct call is 96 against A's 19.
    const a = set([19, 19, 0, 0, 0], [true, true, false, false, false]);
    const b = set([96, -21, -21, -16, 0], [true, false, false, false, false]);
    expect(resolveDuel(a, b)).toMatchObject({ outcome: "b", decidedBy: "best-correct-call" });
    expect(resolveDuel(b, a)).toMatchObject({ outcome: "a", decidedBy: "best-correct-call" });
  });

  it("is a draw when total and best correct call are both level", () => {
    const a = set([64, 19, -21, -21, 0]);
    const b = set([64, -21, 19, 0, -21]);
    expect(resolveDuel(a, b)).toMatchObject({ outcome: "draw", decidedBy: "draw" });
  });

  it("rejects sets that are not identical", () => {
    expect(() => resolveDuel(set([1, 1, 1, 1, 1]), set([1, 1, 1, 1]))).toThrow();
    const other = set([1, 1, 1, 1, 1]);
    other[0] = s("x", 1);
    expect(() => resolveDuel(set([1, 1, 1, 1, 1]), other)).toThrow();
  });
});

describe("Elo", () => {
  it("is zero-sum and symmetric across many random duels", () => {
    const rng = createRng("elo-property");
    for (let i = 0; i < 5000; i++) {
      const a = { rating: 800 + Math.floor(rng() * 1200), ratedDuels: Math.floor(rng() * 20) };
      const b = { rating: 800 + Math.floor(rng() * 1200), ratedDuels: Math.floor(rng() * 20) };
      const outcome = (["a", "b", "draw"] as const)[Math.floor(rng() * 3)];
      const u = applyElo(a, b, outcome);
      expect(u.ratingA - a.rating + (u.ratingB - b.rating)).toBe(0);
      const mirrored = applyElo(b, a, outcome === "a" ? "b" : outcome === "b" ? "a" : "draw");
      expect(mirrored.deltaA + u.deltaA).toBe(0);
      expect(Number.isInteger(u.deltaA)).toBe(true);
    }
  });

  it("uses K = 24, K = 40 while provisional, and their mean when mixed", () => {
    const established = { rating: 1200, ratedDuels: 10 };
    const fresh = { rating: 1200, ratedDuels: 9 };
    expect(applyElo(established, established, "a")).toMatchObject({ k: 24, deltaA: 12 });
    expect(applyElo(fresh, fresh, "a")).toMatchObject({ k: 40, deltaA: 20 });
    expect(applyElo(fresh, established, "a")).toMatchObject({ k: 32, deltaA: 16 });
    expect(applyElo(established, established, "draw").deltaA).toBe(0);
  });

  it("moves less for an expected win than an upset", () => {
    const strong = { rating: 1500, ratedDuels: 30 };
    const weak = { rating: 1100, ratedDuels: 30 };
    expect(applyElo(strong, weak, "a").deltaA).toBeLessThan(applyElo(strong, weak, "b").deltaA * -1);
  });
});

describe("practice bot", () => {
  const answers = (n: number, rng = createRng("answers")): PuzzleAnswer[] =>
    Array.from({ length: n }, (_, i) => answer("p" + i, rng() < 0.6 ? "home" : "away"));

  it("realized accuracy converges to its target", () => {
    for (const target of [0.45, 0.6, 0.75]) {
      const set = answers(100_000);
      const picks = drawBotPicks(set, target, [], createRng("bot-" + target));
      const realized = picks.filter((p, i) => p.side === set[i].actualWinner).length / set.length;
      expect(Math.abs(realized - target)).toBeLessThan(0.006);
    }
  });

  it("samples its target from the player's recent accuracy", () => {
    const history = (correct: number, n: number): RecentPick[] =>
      Array.from({ length: n }, (_, i) => ({ correct: i < correct, confidence: "confident" as const }));
    const mean = (h: RecentPick[]) => {
      const rng = createRng("target");
      let sum = 0;
      for (let i = 0; i < 20_000; i++) sum += sampleBotAccuracy(h, rng);
      return sum / 20_000;
    };
    // Beta(1 + 14, 1 + 6) has mean 15/22 = 0.682.
    expect(mean(history(14, 20))).toBeCloseTo(15 / 22, 2);
    // Only the last 20 picks count: 30 old misses before 20 hits.
    const recentHot = [...history(0, 30), ...history(20, 20)];
    expect(mean(recentHot)).toBeGreaterThan(0.84);
    // With no history the target is uniform, clamped to [0.4, 0.85].
    const cold = mean([]);
    expect(cold).toBeGreaterThan(0.55);
    expect(cold).toBeLessThan(0.65);
  });

  it("mirrors the player's tier mix and picks only the issued puzzles", () => {
    const set = answers(5000);
    const locks: RecentPick[] = Array.from({ length: 20 }, () => ({ correct: true, confidence: "lock" }));
    const picks = drawBotPicks(set, 0.6, locks, createRng("tiers"));
    expect(picks.map((p) => p.puzzleId)).toEqual(set.map((a) => a.puzzleId));
    const lockShare = picks.filter((p) => p.confidence === "lock").length / picks.length;
    expect(lockShare).toBeCloseTo(21 / 23, 1);
  });

  it("is deterministic under a fixed seed", () => {
    const set = answers(50);
    expect(drawBotPicks(set, 0.6, [], createRng("same"))).toEqual(drawBotPicks(set, 0.6, [], createRng("same")));
    expect(sampleBotAccuracy([], createRng("same"))).toBe(sampleBotAccuracy([], createRng("same")));
  });
});

describe("set selection", () => {
  const byBand = {
    lock: ["l1", "l2", "l3"],
    favorite: ["f1", "f2", "f3", "f4"],
    tossup: ["t1", "t2", "t3", "t4"],
  };

  it("draws the unranked composition: one lock, two favourites, two toss-ups, distinct", () => {
    const rng = createRng("compose");
    for (let i = 0; i < 500; i++) {
      const ids = drawUnrankedSet(byBand, rng);
      expect(new Set(ids).size).toBe(5);
      expect(ids.filter((id) => id.startsWith("l")).length).toBe(1);
      expect(ids.filter((id) => id.startsWith("f")).length).toBe(2);
      expect(ids.filter((id) => id.startsWith("t")).length).toBe(2);
    }
  });

  it("shuffles the band order so position reveals nothing", () => {
    const rng = createRng("positions");
    const lockFirst = Array.from({ length: 2000 }, () => drawUnrankedSet(byBand, rng)[0].startsWith("l")).filter(Boolean).length;
    expect(lockFirst / 2000).toBeCloseTo(0.2, 1);
  });

  it("draws ranked sets of five distinct unused puzzles and fails loudly when short", () => {
    const ids = drawRankedSet(["a", "b", "c", "d", "e", "f"], createRng("ranked"));
    expect(new Set(ids).size).toBe(5);
    expect(() => drawRankedSet(["a", "b"], createRng("ranked"))).toThrow();
  });

  it("is deterministic under a fixed seed", () => {
    expect(drawUnrankedSet(byBand, createRng("x"))).toEqual(drawUnrankedSet(byBand, createRng("x")));
  });
});
