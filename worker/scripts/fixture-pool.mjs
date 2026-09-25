// A small synthetic puzzle pool in the KV layout of src/pool.ts. Used by the
// Worker tests and to seed local `wrangler dev` for the frontend e2e suite.
// Team names are invented; no real game is represented.

export const FIXTURE_VERSION = "duel-pool-v1";
export const FIXTURE_ERAS = ["1998-2004", "2005-2011", "2012-2016", "2017-2021", "2022-2026"];
export const FIXTURE_BANDS = ["lock", "favorite", "tossup"];
const PER_ERA_BAND = 6;
// Enough ranked puzzles that tests can play many matches before exposure and cooldown run out.
const RANKED_PER_ERA = 40;

// Distinctive model probabilities, so a test can detect one leaking anywhere.
const BAND_PROBABILITY = { lock: 0.871234, favorite: 0.691234, tossup: 0.541234 };

function snapshot(city, name, i) {
  return {
    city,
    name,
    winsEntering: 20 + (i % 15),
    lossesEntering: 12 + (i % 9),
    restDays: 1 + (i % 3),
    backToBack: i % 4 === 0,
    last10NetRating: Math.round(((i % 13) - 6) * 10) / 10,
    last10WinPct: (i % 11) / 10,
    missingRotationStrength: (i % 5) * 3.5,
  };
}

function puzzle(id, era, band, partition, i) {
  const homeFavourite = i % 3 !== 0;
  const p = BAND_PROBABILITY[band];
  return {
    view: {
      puzzleId: id,
      era,
      isPlayoffGame: i % 7 === 0,
      home: snapshot("Harbor City", "Mariners", i),
      away: snapshot("Mesa Verde", "Comets", i + 5),
    },
    answer: {
      puzzleId: id,
      actualWinner: i % 4 === 1 ? (homeFavourite ? "away" : "home") : homeFavourite ? "home" : "away",
      modelHomeWinProbability: homeFavourite ? p : Math.round((1 - p) * 1e6) / 1e6,
      modelInSample: era !== "2022-2026",
      band,
      partition,
    },
  };
}

/** Returns [{ key, value }] with JSON string values, ready for `wrangler kv bulk put`. */
export function fixturePoolEntries(version = FIXTURE_VERSION) {
  const entries = [];
  const sim = {};
  const ranked = {};
  let i = 0;
  for (const era of FIXTURE_ERAS) {
    for (const band of FIXTURE_BANDS) {
      for (let n = 0; n < PER_ERA_BAND; n++, i++) {
        const id = "pz_fx" + String(i).padStart(4, "0");
        entries.push({ key: "pool:" + version + ":puzzle:" + id, value: JSON.stringify(puzzle(id, era, band, "sim", i)) });
        (sim[era + ":" + band] ??= []).push(id);
        (sim["all:" + band] ??= []).push(id);
      }
    }
    for (let n = 0; n < RANKED_PER_ERA; n++, i++) {
      const id = "pz_fr" + String(i).padStart(4, "0");
      entries.push({ key: "pool:" + version + ":puzzle:" + id, value: JSON.stringify(puzzle(id, era, "favorite", "ranked", i)) });
      (ranked[era] ??= []).push(id);
      (ranked.all ??= []).push(id);
    }
  }
  for (const [k, ids] of Object.entries(sim)) {
    entries.push({ key: "pool:" + version + ":index:sim:" + k, value: JSON.stringify(ids) });
  }
  for (const [k, ids] of Object.entries(ranked)) {
    entries.push({ key: "pool:" + version + ":index:ranked:" + k, value: JSON.stringify(ids) });
  }
  return entries;
}
