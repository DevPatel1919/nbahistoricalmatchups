import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  bracketOrder,
  buildMatchupTable,
  runBracket,
  runTitleOdds,
  seedByStrength,
  type MatchupTable,
  type SeriesBestOf,
  type TournamentDefinition,
} from "../../src/tournament";
import {
  REAL_FIELD_16,
  REAL_FIELD_8,
  exactSeriesProbability,
  realTable,
  syntheticField,
  unwrap,
} from "./fixtures";

const BEST_OF: SeriesBestOf[] = [1, 3, 5, 7];

function def(entrants: string[], seed: string, seriesBestOf: SeriesBestOf = 7): TournamentDefinition {
  return { version: 1, entrants, seed, seriesBestOf };
}

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Exact per-round advancement by dynamic programming over the bracket. */
function exactAdvancement(definition: TournamentDefinition, table: MatchupTable): number[][] {
  const { entrants, seriesBestOf } = definition;
  const n = entrants.length;
  const slots = bracketOrder(n).map((s) => s - 1);
  const rounds = Math.log2(n);
  // reach[slot] = P(entrant in bracket position `slot` is still alive).
  let reach = new Array<number>(n).fill(1);
  const advancement = entrants.map(() => new Array<number>(rounds).fill(0));
  for (let r = 0; r < rounds; r++) {
    const block = 2 ** (r + 1);
    const next = new Array<number>(n).fill(0);
    for (let pos = 0; pos < n; pos++) {
      const start = Math.floor(pos / block) * block;
      const half = block / 2;
      const inTopHalf = pos - start < half;
      const oppStart = inTopHalf ? start + half : start;
      let win = 0;
      for (let q = oppStart; q < oppStart + half; q++) {
        const p = table.probability(entrants[slots[pos]], entrants[slots[q]])!;
        win += reach[q] * exactSeriesProbability(p, seriesBestOf);
      }
      next[pos] = reach[pos] * win;
      advancement[slots[pos]][r] = next[pos];
    }
    reach = next;
  }
  return advancement;
}

describe("bracketOrder", () => {
  it("uses standard placement so the top two seeds can only meet in the final", () => {
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });
});

describe("runBracket invariants (property test over synthetic fields)", () => {
  for (const size of [8, 16]) {
    for (const bestOf of BEST_OF) {
      it(`${size} entrants, best-of-${bestOf}: 150 seeds`, () => {
        const need = Math.ceil(bestOf / 2);
        for (let s = 0; s < 150; s++) {
          const { keys, files } = syntheticField(size, `${size}-${bestOf}-${s}`);
          const table = unwrap(buildMatchupTable(files));
          const result = unwrap(runBracket(def(keys, `seed${s}`, bestOf), table));

          expect(result.engineVersion).toBe(ENGINE_VERSION);
          expect(result.rounds).toHaveLength(Math.log2(size));

          // Round 1 contains every entrant exactly once.
          const firstRound = result.rounds[0].flatMap((x) => [x.top, x.bottom]);
          expect([...firstRound].sort()).toEqual([...keys].sort());

          let previousWinners: string[] | null = null;
          for (const round of result.rounds) {
            const participants = round.flatMap((x) => [x.top, x.bottom]);
            if (previousWinners) expect(participants).toEqual(previousWinners);
            for (const series of round) {
              // A valid number of games and exactly one winner.
              expect(series.games.length).toBeGreaterThanOrEqual(need);
              expect(series.games.length).toBeLessThanOrEqual(2 * need - 1);
              expect(series.topWins + series.bottomWins).toBe(series.games.length);
              expect(Math.max(series.topWins, series.bottomWins)).toBe(need);
              expect(Math.min(series.topWins, series.bottomWins)).toBeLessThan(need);
              expect(series.games.filter((g) => g === series.top)).toHaveLength(series.topWins);
              expect(series.games.every((g) => g === series.top || g === series.bottom)).toBe(true);
              expect(series.winner).toBe(series.topWins === need ? series.top : series.bottom);
              // The series ends on the winner's clinching game.
              expect(series.games[series.games.length - 1]).toBe(series.winner);
              expect(series.topWinProbability).toBe(table.probability(series.top, series.bottom));
            }
            previousWinners = round.map((x) => x.winner);
          }
          expect(result.rounds[result.rounds.length - 1]).toHaveLength(1);
          expect(result.champion).toBe(previousWinners![0]);
        }
      });
    }
  }
});

describe("runTitleOdds invariants (property test over synthetic fields)", () => {
  for (const size of [8, 16]) {
    it(`${size} entrants: probabilities are bounded, monotone, and sum correctly`, () => {
      for (let s = 0; s < 20; s++) {
        const bestOf = BEST_OF[s % 4];
        const { keys, files } = syntheticField(size, `odds-${size}-${s}`);
        const table = unwrap(buildMatchupTable(files));
        const result = unwrap(runTitleOdds(def(keys, `odds${s}`, bestOf), table, 2000));
        const rounds = Math.log2(size);

        expect(result.entrants.map((e) => e.key)).toEqual(keys);
        let titleSum = 0;
        for (const e of result.entrants) {
          expect(e.advancement).toHaveLength(rounds);
          for (let r = 0; r < rounds; r++) {
            expect(e.advancement[r]).toBeGreaterThanOrEqual(0);
            expect(e.advancement[r]).toBeLessThanOrEqual(1);
            if (r > 0) expect(e.advancement[r]).toBeLessThanOrEqual(e.advancement[r - 1]);
          }
          expect(e.titleProbability).toBe(e.advancement[rounds - 1]);
          expect(e.titleProbability).toBe(e.titles / result.runs);
          titleSum += e.titleProbability;
        }
        expect(titleSum).toBeCloseTo(1, 12);
        // Exactly size / 2^(r+1) entrants win round r in every run.
        for (let r = 0; r < rounds; r++) {
          const sum = result.entrants.reduce((acc, e) => acc + e.advancement[r], 0);
          expect(sum).toBeCloseTo(size / 2 ** (r + 1), 9);
        }
        expect(result.entrants.reduce((acc, e) => acc + e.titles, 0)).toBe(result.runs);
      }
    });
  }
});

describe("runTitleOdds agrees with exact bracket probabilities", () => {
  // Monte Carlo is checked against an exact dynamic-programming oracle, so a
  // wrong series rule or bracket order shows up as a statistical mismatch.
  for (const bestOf of BEST_OF) {
    it(`real 16-team field, best-of-${bestOf}, 20,000 runs`, () => {
      const table = realTable(REAL_FIELD_16);
      const seeded = unwrap(seedByStrength(REAL_FIELD_16, table));
      const definition = def(seeded, "oracle", bestOf);
      const runs = 20_000;
      const mc = unwrap(runTitleOdds(definition, table, runs));
      const exact = exactAdvancement(definition, table);
      mc.entrants.forEach((e, i) => {
        e.advancement.forEach((observed, r) => {
          const p = exact[i][r];
          const sigma = Math.sqrt((p * (1 - p)) / runs);
          expect(Math.abs(observed - p)).toBeLessThanOrEqual(4.5 * sigma + 1e-9);
        });
      });
      const exactTitleSum = exact.reduce((acc, a) => acc + a[a.length - 1], 0);
      expect(exactTitleSum).toBeCloseTo(1, 12);
    });
  }
});

describe("determinism", () => {
  it("the same definition and table produce byte-identical results", () => {
    const table = realTable(REAL_FIELD_16);
    const definition = def(REAL_FIELD_16, "repeat");
    expect(JSON.stringify(unwrap(runBracket(definition, table)))).toBe(
      JSON.stringify(unwrap(runBracket(definition, table))),
    );
    expect(JSON.stringify(unwrap(runTitleOdds(definition, table, 3000)))).toBe(
      JSON.stringify(unwrap(runTitleOdds(definition, table, 3000))),
    );
  });

  it("does not depend on the order team files were supplied in", () => {
    const forward = realTable(REAL_FIELD_16);
    const reversed = realTable([...REAL_FIELD_16].reverse());
    const definition = def(REAL_FIELD_16, "file-order");
    expect(JSON.stringify(unwrap(runBracket(definition, forward)))).toBe(
      JSON.stringify(unwrap(runBracket(definition, reversed))),
    );
  });

  it("different seeds tell different stories", () => {
    const table = realTable(REAL_FIELD_16);
    const stories = new Set<string>();
    for (let s = 0; s < 20; s++) {
      stories.add(JSON.stringify(unwrap(runBracket(def(REAL_FIELD_16, `story${s}`), table)).rounds));
    }
    expect(stories.size).toBeGreaterThan(15);
  });
});

describe("golden results (fixed seeds on exported data)", () => {
  // If one of these fails, every shared link made with this engine would
  // replay differently. Bump ENGINE_VERSION instead of editing the values.
  const table = realTable(REAL_FIELD_16);
  const seeded = unwrap(seedByStrength(REAL_FIELD_16, table));

  it("seeds the real field by model strength", () => {
    expect(seeded).toEqual(GOLDEN.seeding);
  });

  it("a 16-team best-of-7 bracket", () => {
    const result = unwrap(runBracket(def(seeded, "golden-16"), table));
    expect(result.champion).toBe(GOLDEN.bracket16.champion);
    expect(result.rounds[3][0].games).toEqual(GOLDEN.bracket16.finalGames);
    expect(sha(result)).toBe(GOLDEN.bracket16.sha256);
  });

  it("an 8-team best-of-5 bracket", () => {
    const table8 = realTable(REAL_FIELD_8);
    const result = unwrap(runBracket(def(REAL_FIELD_8, "golden-8", 5), table8));
    expect(result.champion).toBe(GOLDEN.bracket8.champion);
    expect(sha(result)).toBe(GOLDEN.bracket8.sha256);
  });

  it("16-team title odds over 10,000 runs", () => {
    const result = unwrap(runTitleOdds(def(seeded, "golden-odds"), table, 10_000));
    expect(result.entrants.map((e) => e.titles)).toEqual(GOLDEN.odds16.titles);
    expect(sha(result)).toBe(GOLDEN.odds16.sha256);
  });
});

const GOLDEN = {
  seeding: [
    "2017-warriors",
    "2001-lakers",
    "2024-celtics",
    "2020-lakers",
    "2023-nuggets",
    "2011-mavericks",
    "2016-cavaliers",
    "1998-bulls",
    "2004-pistons",
    "2014-spurs",
    "2021-bucks",
    "2013-heat",
    "2019-raptors",
    "1998-jazz",
    "2016-warriors",
    "2008-celtics",
  ],
  bracket16: {
    champion: "2001-lakers",
    finalGames: ["2001-lakers", "2001-lakers", "2001-lakers", "2001-lakers"],
    sha256: "ddb7864168e9edac2d0cb2c6c254834d1e627944f5617b722f499fa3a71834c4",
  },
  bracket8: {
    champion: "2001-lakers",
    sha256: "c961782344962d443bf2745e4b5578700dcb853353be32a6aeb6e689e1323524",
  },
  odds16: {
    titles: [4282, 4029, 793, 383, 266, 95, 84, 25, 16, 8, 6, 6, 5, 1, 0, 1],
    sha256: "2115e8b63cf6f5e27046a9551f000318d3845e2980a2d36c39005a62fac254c2",
  },
};
