import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  biggestDisagreement,
  emptyPicks,
  isComplete,
  isValidPicks,
  pickCount,
  pickSlots,
  roundName,
  roundPoints,
  scorePicks,
  setPick,
  type Picks,
} from "../../src/lib/bracket";
import { seriesWinProbability } from "../../src/lib/series";
import { CURATED_TOURNAMENTS } from "../../src/data/curated-tournaments";
import { encodeTournament, runBracket, validateDefinition, type BracketResult, type TournamentDefinition } from "../../src/tournament";
import type { IndexData } from "../../src/types";
import { REAL_FIELD_16, REAL_FIELD_8, exactSeriesProbability, realTable, unwrap } from "./fixtures";

const DEF_16: TournamentDefinition = { version: 1, entrants: REAL_FIELD_16, seed: "f04-score", seriesBestOf: 7 };
const DEF_8: TournamentDefinition = { version: 1, entrants: REAL_FIELD_8, seed: "f04-score", seriesBestOf: 5 };
const TABLE_16 = realTable(REAL_FIELD_16);
const MODEL_16 = unwrap(runBracket(DEF_16, TABLE_16));

/** The fan's bracket that agrees with the model's story everywhere. */
function modelPicks(model: BracketResult): Picks {
  return model.rounds.map((round) => round.map((s) => s.winner));
}

/** A copy of `picks` with every pick outside `keepRounds` set to null. */
function onlyRounds(picks: Picks, keepRounds: number[]): Picks {
  return picks.map((round, r) => (keepRounds.includes(r) ? [...round] : round.map(() => null)));
}

/** A copy of `picks` where every pick in `rounds` is swapped for its series loser (always wrong). */
function wrongIn(picks: Picks, model: BracketResult, rounds: number[]): Picks {
  return picks.map((round, r) =>
    rounds.includes(r) ? round.map((_, i) => (model.rounds[r][i].winner === model.rounds[r][i].top ? model.rounds[r][i].bottom : model.rounds[r][i].top)) : [...round],
  );
}

describe("round names and weights", () => {
  it("doubles the points each round: 10, 20, 40, 80", () => {
    expect([0, 1, 2, 3].map(roundPoints)).toEqual([10, 20, 40, 80]);
  });

  it("names rounds from the final backwards", () => {
    expect([0, 1, 2, 3].map((r) => roundName(r, 4))).toEqual(["First round", "Quarterfinals", "Semifinals", "Final"]);
    expect([0, 1, 2].map((r) => roundName(r, 3))).toEqual(["Quarterfinals", "Semifinals", "Final"]);
  });
});

describe("scorePicks", () => {
  const perfect = modelPicks(MODEL_16);

  it("gives a perfect 16-team bracket 80 points per round, 320 in total", () => {
    const score = scorePicks(perfect, MODEL_16);
    expect(score.rounds.map((r) => r.points)).toEqual([80, 80, 80, 80]);
    expect(score.rounds.map((r) => r.correct)).toEqual([8, 4, 2, 1]);
    expect(score.points).toBe(320);
    expect(score.maxPoints).toBe(320);
    expect(score.correct).toBe(15);
  });

  it("scores first-round picks at 10 points each", () => {
    const score = scorePicks(onlyRounds(perfect, [0]), MODEL_16);
    expect(score.points).toBe(8 * 10);
    expect(score.rounds[0]).toEqual({ correct: 8, games: 8, points: 80, maxPoints: 80 });
  });

  it("scores semifinal picks at 40 points each", () => {
    const score = scorePicks(onlyRounds(perfect, [2]), MODEL_16);
    expect(score.points).toBe(2 * 40);
    expect(score.rounds[2]).toEqual({ correct: 2, games: 2, points: 80, maxPoints: 80 });
  });

  it("scores the championship pick at 80 points", () => {
    const score = scorePicks(onlyRounds(perfect, [3]), MODEL_16);
    expect(score.points).toBe(80);
    expect(score.rounds[3]).toEqual({ correct: 1, games: 1, points: 80, maxPoints: 80 });
  });

  it("gives nothing for a wrong pick", () => {
    const score = scorePicks(wrongIn(perfect, MODEL_16, [0, 1, 2, 3]), MODEL_16);
    expect(score.points).toBe(0);
    expect(score.correct).toBe(0);
    expect(scorePicks(wrongIn(perfect, MODEL_16, [3]), MODEL_16).points).toBe(240);
  });

  it("only counts revealed rounds, but reports the full maximum", () => {
    const score = scorePicks(perfect, MODEL_16, 2);
    expect(score.rounds).toHaveLength(2);
    expect(score.points).toBe(160);
    expect(score.maxPoints).toBe(320);
    expect(scorePicks(perfect, MODEL_16, 0).points).toBe(0);
  });

  it("scores an 8-team bracket at 40 points per round", () => {
    const model = unwrap(runBracket(DEF_8, realTable(REAL_FIELD_8)));
    const score = scorePicks(modelPicks(model), model);
    expect(score.rounds.map((r) => r.points)).toEqual([40, 40, 40]);
    expect(score.maxPoints).toBe(120);
  });
});

describe("the fan's bracket", () => {
  it("places round one by standard seeding: 1 v 16, 8 v 9, ...", () => {
    const slots = pickSlots(REAL_FIELD_16, emptyPicks(16));
    expect(slots.map((r) => r.length)).toEqual([8, 4, 2, 1]);
    expect(slots[0][0]).toEqual({ top: REAL_FIELD_16[0], bottom: REAL_FIELD_16[15] });
    expect(slots[0][1]).toEqual({ top: REAL_FIELD_16[7], bottom: REAL_FIELD_16[8] });
    expect(slots[1][0]).toEqual({ top: null, bottom: null });
  });

  it("matches the engine's bracket positions", () => {
    const slots = pickSlots(REAL_FIELD_16, modelPicks(MODEL_16));
    MODEL_16.rounds.forEach((round, r) =>
      round.forEach((series, i) => expect(slots[r][i]).toEqual({ top: series.top, bottom: series.bottom })),
    );
  });

  it("advances picks and clears later picks that are no longer possible", () => {
    const entrants = REAL_FIELD_8;
    let picks = emptyPicks(8);
    const [first] = pickSlots(entrants, picks);
    // Pick the top team through to the title.
    picks = setPick(entrants, picks, 0, 0, first[0].top!);
    picks = setPick(entrants, picks, 0, 1, first[1].top!);
    picks = setPick(entrants, picks, 1, 0, first[0].top!);
    picks = setPick(entrants, picks, 0, 2, first[2].top!);
    picks = setPick(entrants, picks, 0, 3, first[3].top!);
    picks = setPick(entrants, picks, 1, 1, first[2].top!);
    picks = setPick(entrants, picks, 2, 0, first[0].top!);
    expect(isComplete(picks)).toBe(true);
    expect(isValidPicks(entrants, picks)).toBe(true);

    // Knocking the champion out in round one clears its later picks only.
    const changed = setPick(entrants, picks, 0, 0, first[0].bottom!);
    expect(changed[1]).toEqual([null, first[2].top]);
    expect(changed[2]).toEqual([null]);
    expect(pickCount(changed)).toEqual({ made: 5, total: 7 });
    expect(picks[1][0]).toBe(first[0].top); // the input is not mutated

    // Re-picking a team that is still alive keeps the later picks.
    expect(setPick(entrants, picks, 0, 1, first[1].bottom!)[2]).toEqual([first[0].top]);
  });

  it("rejects malformed or impossible stored picks", () => {
    const picks = modelPicks(MODEL_16);
    expect(isValidPicks(REAL_FIELD_16, picks)).toBe(true);
    expect(isValidPicks(REAL_FIELD_16, null)).toBe(false);
    expect(isValidPicks(REAL_FIELD_16, picks.slice(1))).toBe(false);
    expect(isValidPicks(REAL_FIELD_8, picks)).toBe(false);
    const impossible = picks.map((r) => [...r]);
    impossible[3][0] = REAL_FIELD_16.find((k) => k !== picks[2][0] && k !== picks[2][1])!;
    expect(isValidPicks(REAL_FIELD_16, impossible)).toBe(false);
    const wrongType = picks.map((r) => [...r]) as unknown[][];
    wrongType[0][0] = 7;
    expect(isValidPicks(REAL_FIELD_16, wrongType)).toBe(false);
  });
});

describe("biggestDisagreement", () => {
  function favoritePicks(entrants: string[]): Picks {
    let picks = emptyPicks(entrants.length);
    for (let r = 0; r < picks.length; r++) {
      const slots = pickSlots(entrants, picks)[r];
      slots.forEach((s, i) => {
        const fav = TABLE_16.probability(s.top!, s.bottom!)! >= 0.5 ? s.top! : s.bottom!;
        picks = setPick(entrants, picks, r, i, fav);
      });
    }
    return picks;
  }

  it("is null when every pick is the model's favorite", () => {
    expect(biggestDisagreement(REAL_FIELD_16, favoritePicks(REAL_FIELD_16), TABLE_16, 7)).toBeNull();
  });

  it("finds the least likely pick and reports its series probability", () => {
    const picks = favoritePicks(REAL_FIELD_16);
    const slot = pickSlots(REAL_FIELD_16, picks)[0][0];
    const underdog = picks[0][0] === slot.top ? slot.bottom! : slot.top!;
    const favorite = picks[0][0]!;
    const upset = setPick(REAL_FIELD_16, picks, 0, 0, underdog);
    const found = biggestDisagreement(REAL_FIELD_16, upset, TABLE_16, 7);
    expect(found).not.toBeNull();
    expect(found!.round).toBe(0);
    expect(found!.winner).toBe(underdog);
    expect(found!.loser).toBe(favorite);
    expect(found!.seriesProbability).toBeCloseTo(exactSeriesProbability(TABLE_16.probability(underdog, favorite)!, 7), 12);
    expect(found!.seriesProbability).toBeLessThan(0.5);
  });
});

describe("seriesWinProbability", () => {
  it("matches the exact series formula for every series length", () => {
    for (const bestOf of [1, 3, 5, 7]) {
      for (const p of [0.01, 0.3, 0.5, 0.62, 0.99]) {
        expect(seriesWinProbability(p, bestOf)).toBeCloseTo(exactSeriesProbability(p, bestOf), 12);
        expect(seriesWinProbability(p, bestOf) + seriesWinProbability(1 - p, bestOf)).toBeCloseTo(1, 12);
      }
    }
  });

  it("defaults to best-of-7", () => {
    expect(seriesWinProbability(0.6)).toBe(seriesWinProbability(0.6, 7));
  });
});

describe("curated tournaments", () => {
  const indexPath = fileURLToPath(new URL("../../public/data/index.json", import.meta.url));
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as IndexData;
  const known = new Set(index.teams.map((t) => t.key));

  it.each(CURATED_TOURNAMENTS.map((t) => [t.id, t] as const))("%s is a valid, playable definition", (_id, curated) => {
    unwrap(validateDefinition(curated.definition, known));
    unwrap(encodeTournament(curated.definition));
    const model = unwrap(runBracket(curated.definition, realTable(curated.definition.entrants)));
    expect(model.rounds.at(-1)).toHaveLength(1);
  });

  it("uses unique ids", () => {
    const ids = CURATED_TOURNAMENTS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
