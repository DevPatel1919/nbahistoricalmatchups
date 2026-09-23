import { describe, expect, it } from "vitest";
import {
  MAX_ENCODED_LENGTH,
  createRng,
  decodeTournament,
  encodeTournament,
  generateSeed,
  runBracket,
  runTitleOdds,
  seedByStrength,
  validateDefinition,
  type EngineErrorCode,
  type Result,
  type TournamentDefinition,
} from "../../src/tournament";
import { REAL_FIELD_16, REAL_FIELD_8, realTable, unwrap } from "./fixtures";

const VALID: TournamentDefinition = { version: 1, entrants: REAL_FIELD_8, seed: "abc_123-X", seriesBestOf: 7 };

function codeOf<T>(result: Result<T>): EngineErrorCode | "ok" {
  return result.ok ? "ok" : result.error.code;
}

describe("validateDefinition", () => {
  it("accepts 8 and 16 entrants with every series length", () => {
    for (const entrants of [REAL_FIELD_8, REAL_FIELD_16]) {
      for (const seriesBestOf of [1, 3, 5, 7] as const) {
        expect(codeOf(validateDefinition({ ...VALID, entrants, seriesBestOf }))).toBe("ok");
      }
    }
  });

  it.each([
    ["4 entrants", { entrants: REAL_FIELD_8.slice(0, 4) }, "invalid-size"],
    ["12 entrants", { entrants: REAL_FIELD_16.slice(0, 12) }, "invalid-size"],
    ["32 entrants", { entrants: [...REAL_FIELD_16, ...REAL_FIELD_16] }, "invalid-size"],
    ["no entrants", { entrants: [] }, "invalid-size"],
    ["a self-matchup", { entrants: [...REAL_FIELD_8.slice(0, 7), REAL_FIELD_8[0]] }, "duplicate-entrant"],
    ["a malformed key", { entrants: [...REAL_FIELD_8.slice(0, 7), "Bulls"] }, "invalid-entrant-key"],
    ["a key with a separator", { entrants: [...REAL_FIELD_8.slice(0, 7), "1998-bulls~x"] }, "invalid-entrant-key"],
    ["an empty seed", { seed: "" }, "invalid-seed"],
    ["a seed with a dot", { seed: "a.b" }, "invalid-seed"],
    ["a 33-character seed", { seed: "x".repeat(33) }, "invalid-seed"],
    ["best-of-2", { seriesBestOf: 2 }, "invalid-best-of"],
    ["best-of-9", { seriesBestOf: 9 }, "invalid-best-of"],
    ["version 2", { version: 2 }, "unsupported-version"],
  ])("rejects %s", (_label, patch, code) => {
    const definition = { ...VALID, ...patch } as TournamentDefinition;
    expect(codeOf(validateDefinition(definition))).toBe(code);
  });

  it("rejects a well-formed but unsupported team-season when keys are known", () => {
    const known = new Set(REAL_FIELD_8);
    const definition = { ...VALID, entrants: [...REAL_FIELD_8.slice(0, 7), "1997-bulls"] };
    expect(codeOf(validateDefinition(definition))).toBe("ok");
    expect(codeOf(validateDefinition(definition, known))).toBe("unknown-entrant");
  });
});

describe("running with an invalid definition or table", () => {
  const table = realTable(REAL_FIELD_8);

  it("reports entrants the table has no files for as unknown", () => {
    const definition = { ...VALID, entrants: [...REAL_FIELD_8.slice(0, 7), "2023-nuggets"] };
    expect(codeOf(runBracket(definition, table))).toBe("unknown-entrant");
  });

  it("rejects invalid run counts", () => {
    for (const runs of [0, -1, 1.5, 100_001, Number.NaN]) {
      expect(codeOf(runTitleOdds(VALID, table, runs))).toBe("invalid-run-count");
    }
    expect(codeOf(runTitleOdds(VALID, table, 1))).toBe("ok");
  });

  it("seedByStrength rejects duplicates and is independent of input order", () => {
    expect(codeOf(seedByStrength([...REAL_FIELD_8, REAL_FIELD_8[0]], table))).toBe("duplicate-entrant");
    expect(unwrap(seedByStrength(REAL_FIELD_8, table))).toEqual(
      unwrap(seedByStrength([...REAL_FIELD_8].reverse(), table)),
    );
  });
});

describe("serialization", () => {
  it("round-trips 8- and 16-entrant definitions", () => {
    for (const entrants of [REAL_FIELD_8, REAL_FIELD_16]) {
      for (const seriesBestOf of [1, 3, 5, 7] as const) {
        const definition: TournamentDefinition = { version: 1, entrants, seed: "Round_trip-9", seriesBestOf };
        const encoded = unwrap(encodeTournament(definition));
        expect(encoded).toMatch(/^[A-Za-z0-9._~-]+$/); // RFC 3986 unreserved only
        expect(encodeURIComponent(encoded)).toBe(encoded);
        expect(unwrap(decodeTournament(encoded))).toEqual(definition);
      }
    }
  });

  it("has a stable, documented format", () => {
    const encoded = unwrap(encodeTournament(VALID));
    expect(encoded).toBe(`t1.7.abc_123-X.${REAL_FIELD_8.join("~")}`);
  });

  it("fits the largest possible definition within the length limit", () => {
    const longKeys = Array.from({ length: 16 }, (_, i) => `${1000 + i}-${"a".repeat(35)}`);
    const encoded = unwrap(encodeTournament({ version: 1, entrants: longKeys, seed: "s".repeat(32), seriesBestOf: 7 }));
    expect(encoded.length).toBeLessThanOrEqual(MAX_ENCODED_LENGTH);
  });

  it("does not encode an invalid definition", () => {
    expect(codeOf(encodeTournament({ ...VALID, seriesBestOf: 4 as 7 }))).toBe("invalid-best-of");
  });

  const good = `t1.7.abc.${REAL_FIELD_8.join("~")}`;
  it.each([
    ["an empty string", "", "malformed"],
    ["garbage", "hello world", "malformed"],
    ["a future format", good.replace("t1.", "t2."), "unsupported-version"],
    ["a missing field", `t1.7.${REAL_FIELD_8.join("~")}`, "malformed"],
    ["an extra field", `${good}.extra`, "malformed"],
    ["a non-digit series length", good.replace(".7.", ".x."), "invalid-best-of"],
    ["an even series length", good.replace(".7.", ".4."), "invalid-best-of"],
    ["a two-digit series length", good.replace(".7.", ".07."), "invalid-best-of"],
    ["an empty seed", good.replace(".abc.", ".."), "invalid-seed"],
    ["an escaped character", good.replace("abc", "a%20c"), "invalid-seed"],
    ["too few entrants", `t1.7.abc.${REAL_FIELD_8.slice(0, 7).join("~")}`, "invalid-size"],
    ["a trailing separator", `${good}~`, "invalid-size"],
    ["a duplicate entrant", `t1.7.abc.${[...REAL_FIELD_8.slice(0, 7), REAL_FIELD_8[0]].join("~")}`, "duplicate-entrant"],
    ["uppercase keys", good.toUpperCase().replace("T1.", "t1."), "invalid-entrant-key"],
    ["an oversized string", `${good}~${"x".repeat(MAX_ENCODED_LENGTH)}`, "too-long"],
  ])("rejects %s", (_label, encoded, code) => {
    expect(codeOf(decodeTournament(encoded))).toBe(code);
  });

  it("rejects unsupported team-seasons when given the known keys", () => {
    const encoded = `t1.7.abc.${[...REAL_FIELD_8.slice(0, 7), "1990-bulls"].join("~")}`;
    expect(codeOf(decodeTournament(encoded))).toBe("ok");
    expect(codeOf(decodeTournament(encoded, new Set(REAL_FIELD_16)))).toBe("unknown-entrant");
  });

  it("survives random corruption without throwing", () => {
    const encoded = unwrap(encodeTournament({ ...VALID, entrants: REAL_FIELD_16 }));
    const rng = createRng("corrupt");
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789.~-_%/ ";
    let accepted = 0;
    for (let i = 0; i < 2000; i++) {
      const chars = encoded.split("");
      const pos = Math.floor(rng() * chars.length);
      chars[pos] = alphabet[Math.floor(rng() * alphabet.length)];
      const corrupted = chars.join("");
      const result = decodeTournament(corrupted);
      // Anything accepted must be a valid, canonical definition.
      if (result.ok) {
        accepted++;
        expect(unwrap(encodeTournament(result.value))).toBe(corrupted);
      }
    }
    expect(accepted).toBeLessThan(2000);
  });
});

describe("generateSeed", () => {
  it("produces valid seeds from the injected randomness", () => {
    const rng = createRng("seeds");
    for (let i = 0; i < 100; i++) {
      const seed = generateSeed(rng);
      expect(codeOf(validateDefinition({ ...VALID, seed }))).toBe("ok");
    }
    expect(generateSeed(() => 0.999999999)).toHaveLength(10);
  });
});
