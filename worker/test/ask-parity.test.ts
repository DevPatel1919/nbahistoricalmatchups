// F13 Session 5: the Worker's port against the Python reference. Every expected
// value here was produced by src/rag/ (scripts/build_rag_worker_fixtures.py,
// scripts/build_rag_tool_fixtures.py), on real questions and real model answers.

import { describe, expect, it } from "vitest";
import corpusText from "../../data/rag/corpus.jsonl?raw";
import factsFile from "../../data/rag/facts.json";
import modelInputsFile from "../../data/rag/model_inputs.json";
import indexFile from "../../frontend/public/data/index.json";
import linkerFixtures from "../../tests/fixtures/rag/linker.json";
import toolFixtures from "../../tests/fixtures/rag/tools.json";
import parity from "../../tests/fixtures/rag/worker_parity.json";
import { check, feedback, stripUnsupported } from "../src/ask/grounding";
import { Linker } from "../src/ask/linker";
import {
  allowed,
  constraintsFor,
  ftsQuery,
  promptText,
  REFUSAL_TEXT,
  REGENERATE,
  rrf,
  selectChunks,
  sourcesOf,
  SYSTEM_PROMPT,
  toolFacts,
  userMessage,
  type Chunk,
} from "../src/ask/pipeline";
import { fixed, ordinal, pct1, seasonLabel, signed } from "../src/ask/textfmt";
import { templateAnswer, Tools, type Facts, type ModelInputs, type Opponents, type Suggested } from "../src/ask/tools";

const chunkList: Chunk[] = corpusText.trim().split("\n").map((line) => JSON.parse(line));
const chunks = new Map(chunkList.map((c) => [c.id, c]));
const linker = new Linker(indexFile.teams);
const facts = factsFile as unknown as Facts;
const modelInputs = modelInputsFile as unknown as ModelInputs;

type LinkCase = { text: string; keys?: string[]; seasons?: number[]; range?: number[]; franchises?: string[]; unresolved?: string[] };
type Part = { feature: string; z_a: string; z_b: string; favours: string | null; contribution: number; share: number };
type WantMatchup = { p: number; m: number; p_a: string; p_b: string; favoured: string | null; margin: string; score: number; parts: Part[] };
type Matchup = { a: string; b: string; get_matchup: WantMatchup; facts: string[]; templates: Record<string, { facts: string[]; text: string }> };
type ToolFixtures = { matchups: Matchup[]; teams: { key: string; fact: string }[]; seasons: { season: number; fact: string }[] };

const fixtures = toolFixtures as unknown as ToolFixtures;

const fixtureOpponents = new Map<string, Opponents>();
for (const m of fixtures.matchups) {
  const row = fixtureOpponents.get(m.a) ?? {};
  row[m.b] = { p: m.get_matchup.p, m: m.get_matchup.m };
  fixtureOpponents.set(m.a, row);
}
const tools = new Tools(facts, modelInputs, async (key) => fixtureOpponents.get(key) ?? {});
const parityOpponents = parity.opponents as unknown as Record<string, Opponents>;
const contextTools = new Tools(facts, modelInputs, async (key) => parityOpponents[key] ?? {});

describe("formatting", () => {
  it("matches Python's rounding, including exact ties", () => {
    expect(fixed(46.25, 1)).toBe("46.2"); // Python rounds an exact tie to even
    expect(fixed(46.75, 1)).toBe("46.8");
    expect(fixed(2.125, 2)).toBe("2.12");
    expect(fixed(0.125, 0)).toBe("0");
    expect(fixed(1.5, 0)).toBe("2");
    expect(fixed(-2.354, 2)).toBe("-2.35");
    expect(signed(-0.004, 2)).toBe("+0.00");
    expect(signed(2.354, 2)).toBe("+2.35");
    expect(pct1(0.4687)).toBe("46.9%");
    expect(seasonLabel(2000)).toBe("1999–00");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});

describe("linker", () => {
  it("passes every linker fixture", () => {
    for (const c of linkerFixtures.cases as LinkCase[]) {
      expect(linker.link(c.text), c.text).toEqual({
        keys: c.keys ?? [],
        seasons: c.seasons ?? [],
        range: c.range ?? null,
        franchises: c.franchises ?? [],
        unresolved: c.unresolved ?? [],
      });
    }
  });

  it("agrees with Python on every evaluation question", () => {
    for (const q of parity.questions) expect(linker.link(q.question), q.question).toEqual(q.link);
  });
});

describe("retrieval pieces", () => {
  it("writes the same FTS5 queries", () => {
    for (const q of parity.questions) expect(ftsQuery(q.question), q.question).toBe(q.fts);
  });

  it("keeps the same chunks through the filters", () => {
    for (const q of parity.questions) {
      const cons = constraintsFor(linker.link(q.question), q.context);
      expect(cons.keys).toEqual(q.constraint_keys);
      expect(chunkList.filter((c) => allowed(c, cons)).length, q.question).toBe(q.allowed);
    }
  });

  it("fuses by reciprocal rank, ties by id", () => {
    expect(rrf([["a", "b", "c"], ["b", "a", "d"]]).slice(0, 2)).toEqual(["a", "b"]);
    expect(rrf([["x"], ["y"]])).toEqual(["x", "y"]);
  });
});

describe("generation pieces", () => {
  it("uses the same prompts", () => {
    expect(SYSTEM_PROMPT).toBe(parity.prompts.system);
    expect(REGENERATE).toBe(parity.prompts.regenerate);
    expect(REFUSAL_TEXT).toBe(parity.prompts.refusal);
  });

  it("builds the same facts, chunk choice and user message", async () => {
    for (const c of parity.context) {
      const link = linker.link(c.question);
      const got = await toolFacts(contextTools, link, c.context);
      expect(got.facts, c.question).toEqual(c.facts);
      expect(got.covered).toEqual(c.covered);
      const chosen = selectChunks(c.ranked, c.covered, 5);
      expect(chosen).toEqual(c.chosen);
      const texts = chosen.map((id) => promptText(chunks.get(id) as Chunk));
      expect(userMessage(c.question, got.facts, texts), c.question).toBe(c.message);
    }
  });
});

describe("grounding", () => {
  it("has both passing and failing cases to compare", () => {
    expect(parity.grounding.filter((c) => c.ok).length).toBeGreaterThan(50);
    expect(parity.grounding.filter((c) => !c.ok).length).toBeGreaterThan(50);
  });

  it("gives Python's verdict on real model answers", () => {
    for (const c of parity.grounding) {
      const label = c.run + "/" + c.id;
      const sources = sourcesOf(c.facts, c.chunk_ids, chunks);
      const report = check(c.answer, sources, c.question);
      expect(report.sentences, label).toEqual(c.sentences);
      expect(report.ok, label).toBe(c.ok);
      expect(report.numbers, label).toBe(c.numbers);
      expect(report.citations, label).toEqual(c.citations);
      expect(report.problems.map((p) => [p.index, p.kind, p.message]), label).toEqual(c.problems);
      expect(feedback(report), label).toBe(c.feedback);
      const stripped = stripUnsupported(report, sources);
      expect(stripped.text, label).toBe(c.stripped);
      expect(stripped.removed, label).toBe(c.removed);
    }
  });

  it("matches rounded, percent and season forms", () => {
    const sources = { F1: "1995–96 Bulls: 72–10 (.878 win %), net rating +13.3, margin 6.9." };
    expect(check("They went 72–10 [F1].", sources).ok).toBe(true);
    expect(check("They won 87.8% of their games [F1].", sources).ok).toBe(true);
    expect(check("By about 7 points [F1].", sources).ok).toBe(true);
    expect(check("In the '96 season, +13.3 [F1].", sources).ok).toBe(true);
    expect(check("They went 70–12 [F1].", sources).ok).toBe(false);
    expect(check("Net rating +13.3.", sources).ok).toBe(false);
    expect(check("Net rating +13.3 [F9].", sources).ok).toBe(false);
    expect(check("It uses three-point % per 100 possessions [F1].", sources).ok).toBe(true);
  });
});

describe("tools", () => {
  it("reproduces every matchup: decomposition, facts and templates", async () => {
    expect(fixtures.matchups.length).toBeGreaterThanOrEqual(30);
    for (const m of fixtures.matchups) {
      const label = m.a + " vs " + m.b;
      const got = await tools.getMatchup(m.a, m.b);
      const want = m.get_matchup;
      expect(got.p_a, label).toBe(want.p_a);
      expect(got.p_b, label).toBe(want.p_b);
      expect(got.favoured, label).toBe(want.favoured);
      expect(got.margin, label).toBe(want.margin);
      expect(got.score, label).toBeCloseTo(want.score, 6);
      got.parts.forEach((part, i) => {
        expect(part.feature).toBe(want.parts[i].feature);
        expect(part.z_a).toBe(want.parts[i].z_a);
        expect(part.z_b).toBe(want.parts[i].z_b);
        expect(part.favours).toBe(want.parts[i].favours);
        expect(part.contribution).toBeCloseTo(want.parts[i].contribution, 6);
        expect(part.share).toBeCloseTo(want.parts[i].share, 4);
      });
      expect(await tools.matchupFacts(m.a, m.b), label).toEqual(m.facts);
      for (const kind of ["why", "defence", "limits"] as Suggested[]) {
        expect(await templateAnswer(tools, kind, m.a, m.b), label + " " + kind).toEqual(m.templates[kind]);
      }
    }
  });

  it("templates pass the grounding check by construction", async () => {
    for (const m of fixtures.matchups.slice(0, 10)) {
      for (const kind of ["why", "defence", "limits"] as Suggested[]) {
        const answer = await templateAnswer(tools, kind, m.a, m.b);
        const sources = Object.fromEntries(answer.facts.map((f, i) => ["F" + (i + 1), f]));
        expect(check(answer.text, sources).ok, m.a + " " + kind).toBe(true);
      }
    }
  });

  it("reproduces team and season facts", () => {
    for (const t of fixtures.teams) expect(tools.teamFact(t.key), t.key).toBe(t.fact);
    for (const s of fixtures.seasons) expect(tools.seasonFact(s.season), String(s.season)).toBe(s.fact);
  });
});
