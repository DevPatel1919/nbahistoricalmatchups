import { describe, expect, it } from "vitest";
import { buildMatchupTable, createRng } from "../../src/tournament";
import { REAL_FIELD_16, readTeamFile, realTable, syntheticField } from "./fixtures";

describe("createRng", () => {
  it("replays the same stream for the same seed", () => {
    const a = createRng("same");
    const b = createRng("same");
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it("gives different streams for different seeds", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    const same = Array.from({ length: 100 }, () => a() === b()).filter(Boolean).length;
    expect(same).toBe(0);
  });

  it("returns floats in [0, 1) with a sane mean", () => {
    const rng = createRng("range");
    let sum = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const x = rng();
      expect(x >= 0 && x < 1).toBe(true);
      sum += x;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
  });

  it("is pinned: the first outputs for a fixed seed never change", () => {
    // Golden values. If this fails, shared tournament links replay differently:
    // bump ENGINE_VERSION rather than updating these numbers.
    const rng = createRng("court-of-all-time");
    expect([rng(), rng(), rng()]).toEqual(GOLDEN_PRNG);
  });
});

const GOLDEN_PRNG = [0.43129812367260456, 0.9716885376255959, 0.9586931220255792];

describe("buildMatchupTable", () => {
  it("gives exactly complementary probabilities in both lookup directions", () => {
    const table = realTable(REAL_FIELD_16);
    for (const a of REAL_FIELD_16) {
      for (const b of REAL_FIELD_16) {
        if (a === b) continue;
        const pab = table.probability(a, b)!;
        const pba = table.probability(b, a)!;
        expect(pab).toBeGreaterThanOrEqual(0);
        expect(pab).toBeLessThanOrEqual(1);
        expect(pab + pba).toBeCloseTo(1, 12);
      }
    }
  });

  it("matches the exported value from the alphabetically smaller key's file", () => {
    const table = realTable(["1998-bulls", "2017-warriors"]);
    const exported = readTeamFile("1998-bulls").opponents["2017-warriors"].p;
    expect(table.probability("1998-bulls", "2017-warriors")).toBe(exported);
    expect(table.probability("2017-warriors", "1998-bulls")).toBe(1 - exported);
  });

  it("agrees with the other file's own value to the export's rounding", () => {
    // Sanity check on the export itself: both perspectives of a pair are the
    // same neutral result, rounded to 4 decimals independently.
    for (const a of REAL_FIELD_16) {
      const fa = readTeamFile(a);
      for (const b of REAL_FIELD_16) {
        if (a === b) continue;
        const fb = readTeamFile(b);
        expect(Math.abs(fa.opponents[b].p + fb.opponents[a].p - 1)).toBeLessThanOrEqual(1e-4 + 1e-12);
      }
    }
  });

  it("returns undefined for a self-matchup or a pair it has no file for", () => {
    const table = realTable(["1998-bulls", "2017-warriors"]);
    expect(table.probability("1998-bulls", "1998-bulls")).toBeUndefined();
    // A pair is read only from the file of its alphabetically smaller key.
    // 1998-bulls < 2001-lakers and the Bulls file was supplied: covered.
    expect(table.probability("1998-bulls", "2001-lakers")).toBeDefined();
    // 1998-jazz < 2017-warriors but no Jazz file was supplied: not covered,
    // even though the Warriors file lists the Jazz. Reading from one fixed side
    // keeps a pair's value independent of which extra files happen to be loaded.
    expect(table.probability("1998-jazz", "2017-warriors")).toBeUndefined();
  });

  it("rejects a file supplied twice and an out-of-range probability", () => {
    const bulls = readTeamFile("1998-bulls");
    const dup = buildMatchupTable([bulls, bulls]);
    expect(dup.ok || dup.error.code).toBe("duplicate-entrant");

    const { files } = syntheticField(8, "bad-p");
    files[0].opponents[files[1].key] = { p: 1.2, m: 0 };
    const bad = buildMatchupTable(files);
    expect(bad.ok || bad.error.code).toBe("invalid-probability");
  });
});
