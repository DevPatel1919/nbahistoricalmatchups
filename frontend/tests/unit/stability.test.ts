// F11 stability: adding the 1985-86 to 1996-97 seasons (and replacing the
// model) must not break anything already shared. Every pre-F11 key still
// exists, existing matchup URLs still resolve, and existing tournament links
// still decode and replay. The replayed results themselves may differ: they
// come from the active release's probabilities.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IndexData } from "../../src/types";
import { parseMatchupSlug } from "../../src/lib/slug";
import { searchTeams } from "../../src/lib/search";
import { decodeTournament, encodeTournament, runBracket } from "../../src/tournament";
import { CHAMPIONS } from "../../src/data/curated-tournaments";
import { readTeamFile, realTable, unwrap } from "./fixtures";

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const index = read("../../public/data/index.json") as IndexData;
const preF11 = read("./pre-f11-keys.json") as { count: number; keys: string[] };
const known = new Set(index.teams.map((t) => t.key));

describe("pre-F11 keys", () => {
  it("every key served before F11 still exists", () => {
    expect(preF11.count).toBe(835);
    expect(preF11.keys.filter((k) => !known.has(k))).toEqual([]);
  });

  it("the export now starts in 1985-86 and keys stay unique", () => {
    expect(Math.min(...index.teams.map((t) => t.season))).toBe(1986);
    expect(known.size).toBe(index.teams.length);
    for (const key of ["1986-celtics", "1989-pistons", "1990-bullets", "1996-bulls", "1997-grizzlies"]) {
      expect(known.has(key), key).toBe(true);
    }
  });
});

describe("existing matchup URLs", () => {
  it.each([
    "1998-bulls-vs-2017-warriors",
    "2005-supersonics-vs-1999-grizzlies",
    "2001-lakers-vs-2008-celtics",
    "2022-clippers-vs-2022-lakers",
  ])("/%s resolves to two teams with a result", (slug) => {
    const [a, b] = parseMatchupSlug(slug)!;
    expect(known.has(a) && known.has(b)).toBe(true);
    const result = readTeamFile(a).opponents[b];
    expect(result.p).toBeGreaterThan(0);
    expect(result.p).toBeLessThan(1);
    expect(result.p + readTeamFile(b).opponents[a].p).toBeCloseTo(1, 3);
  });
});

describe("search covers the older seasons", () => {
  it.each([
    ["96 bulls", 1996],
    ["86 celtics", 1986],
    ["98 bulls", 1998],
    ["17 warriors", 2017],
  ])("%s finds season %i", (query, season) => {
    expect(searchTeams(index.teams, query as string)[0].season).toBe(season);
  });
});

describe("existing shared tournament links", () => {
  // The Champions Bracket link as shared since F04 (it is also the default /tournament).
  const championsLink = unwrap(encodeTournament(CHAMPIONS.definition));

  it.each([
    championsLink,
    "t1.7.f11demo.2017-warriors~1998-bulls~2016-warriors~2008-celtics~2001-lakers~2013-heat~2004-pistons~2014-spurs",
  ])("%s decodes and replays the same way twice", (code) => {
    const definition = unwrap(decodeTournament(code, known));
    expect(unwrap(encodeTournament(definition))).toBe(code);
    const table = realTable(definition.entrants);
    const first = unwrap(runBracket(definition, table));
    const second = unwrap(runBracket(definition, table));
    expect(first.rounds.at(-1)).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("the Champions Bracket link has not changed", () => {
    expect(championsLink).toBe(
      "t1.7.champions-v1.2025-thunder~2024-celtics~2017-warriors~2008-celtics~2015-warriors~1999-spurs~2007-spurs~2000-lakers~2005-spurs~2014-spurs~2013-heat~2009-lakers~1998-bulls~2002-lakers~2004-pistons~2012-heat",
    );
  });
});
