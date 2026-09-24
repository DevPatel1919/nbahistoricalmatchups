# F03: Deterministic tournament engine

Status: **complete (2026-09-23)**. Engine `v1` in `frontend/src/tournament/`; F04 can start.

## Outcome

Provide framework-agnostic TypeScript domain logic for reproducible historical
team tournaments. F03 owns calculations and serialization; F04 owns screens.

## Core concepts

```ts
type TournamentSize = 8 | 16;
type TournamentMode = "single-bracket" | "title-odds";

type TournamentDefinition = {
  version: 1;
  entrants: string[];       // exported team-season keys
  seed: string;
  seriesBestOf: 1 | 3 | 5 | 7;
};
```

- `single-bracket` produces one seeded, reproducible story.
- `title-odds` runs a fixed number of seeded Monte Carlo tournaments and reports
  each entrant's championship probability.
- Every game uses the exported neutral win probability. MVP games are
  independent and have no era, fatigue, injury, or roster adjustment.
- A series ends when a team reaches `ceil(bestOf / 2)` wins.

## Work

1. Define validated domain types and explicit error results.
2. Implement a small deterministic PRNG from an explicit string seed. Shared
   outcomes never use `Math.random()`.
3. Implement seeded bracket placement, series simulation, round advancement,
   and title-odds aggregation.
4. Implement a versioned, URL-safe serialization format with strict size and
   entrant validation.
5. Keep functions pure and independent from React, browser storage, analytics,
   and network fetching.
6. Add fixtures using exported matchup values; do not duplicate the export in
   engine code.

## Required invariants

- The same definition, probabilities, simulation count, and engine version
  produce byte-for-byte identical results.
- Each series contains a valid number of games and exactly one winner.
- Every round contains only winners from the preceding round.
- Championship probabilities are in `[0, 1]` and sum to 1 within floating-point
  tolerance.
- Invalid, duplicate, unsupported, or self-matchup entrants are rejected.
- Reversing the lookup perspective produces complementary game probabilities.

## MVP limits

Support 8 and 16 entrants only. Do not add 32/64 teams, custom players, era
controls, server persistence, fan votes, prizes, or invented box scores.

## Completion criteria

- Unit and property tests cover every invariant above.
- Golden tests prove stable results for fixed seeds.
- One 10,000-run 16-team title-odds calculation completes comfortably in a
  current desktop browser; record the measured time and test environment.
- Serialization round-trips and rejects corrupt or oversized input.
- Public exported types and functions are documented for F04.

## Agent kickoff prompt

> Implement F03. Read `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and this
> brief. Inspect the actual frontend and exported JSON contract before choosing
> paths. Build pure deterministic TypeScript tournament logic with exhaustive
> invariant, golden-seed, and serialization tests. Do not create screens or
> introduce server state. Finish by documenting the public engine interface and
> verification results in this brief.

## Handoff record

### 2026-09-23: engine v1

**Location.** `frontend/src/tournament/` (pure TypeScript; no React, storage,
analytics, network, or `Math.random`). F04 imports only from
`frontend/src/tournament/index.ts`.

**Public interface.** Nothing throws on bad input: every entry point returns
`Result<T> = { ok: true, value } | { ok: false, error: { code, message } }`.

| Export | Purpose |
|---|---|
| `TournamentDefinition` | `{ version: 1, entrants, seed, seriesBestOf }`. `entrants` are exported keys **in seed order** (`entrants[0]` is the 1 seed). Seed: 1-32 of `[A-Za-z0-9_-]`. |
| `buildMatchupTable(files)` | Builds the probability lookup from exported `TeamFile`s (F04 loads the entrants' files with `lib/dataLoader`). A pair is always read from the alphabetically smaller key's file and complemented for the other direction, so `p(b,a) === 1 - p(a,b)` exactly. |
| `seedByStrength(keys, table)` | Orders a field by mean neutral win probability against the rest of the field, ties by key. Input-order independent. Optional: a curated order is equally valid. |
| `runBracket(def, table)` | `single-bracket` mode. One reproducible story: `rounds[r][i]` is a `SeriesResult` with `top`, `bottom`, `topWinProbability`, per-game winners, win counts, and `winner`; plus `champion`. |
| `runTitleOdds(def, table, runs = 10000)` | `title-odds` mode. Per entrant (seed order): `advancement[r]` = share of runs won round r, `titles`, `titleProbability`. `runs` is an integer 1..100,000. |
| `encodeTournament(def)` / `decodeTournament(str, knownKeys?)` | URL format `t1.<bestOf>.<seed>.<key1>~...~<keyN>`, RFC 3986 unreserved characters only. Decoding is strict (canonical form only, max `MAX_ENCODED_LENGTH` = 694 chars). Pass the `index.json` keys to reject unsupported team-seasons. |
| `validateDefinition(def, knownKeys?)` | The validation all of the above use. |
| `generateSeed(random)` | A fresh 10-character seed for a new tournament; the caller injects randomness. |
| `bracketOrder(n)`, `createRng(seed)`, `ENGINE_VERSION`, error codes | Supporting pieces. |

**Rules.** Standard bracket placement (8: seeds 1,8,4,5,2,7,3,6), so seeds 1
and 2 can only meet in the final. Every game is an independent draw at the
exported neutral probability; a series ends at `ceil(bestOf / 2)` wins. The
story and the odds use separate PRNG streams (`ct-v1|single-bracket|<seed>`,
`ct-v1|title-odds|<seed>`), so the same link always tells the same story,
and the odds do not replay the story. PRNG: cyrb128-seeded sfc32, 32-bit
integer arithmetic only.

**Versioning.** Serialization `t1`; `ENGINE_VERSION = 1`. Any change that
alters a result for an existing definition (PRNG, stream names, bracket order,
series rule) must bump `ENGINE_VERSION`. The golden tests exist to force that.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Unit, property, golden | `cd frontend && npm test` | 71 passed |
| Browser benchmark + e2e | `cd frontend && npx playwright test` | 16 passed |
| Types (app + tests) | `cd frontend && npm run build` | passes; `tsconfig.test.json` type-checks `tests/unit` |
| Lint | `cd frontend && npm run lint` | clean |

- Property tests: 150 seeds for each of 8/16 entrants x best-of-1/3/5/7 on
  synthetic fields, asserting every series invariant, round continuity, and a
  single champion; title-odds bounds, monotone advancement, titles summing to 1,
  and `n / 2^(r+1)` round winners per run.
- Oracle: 20,000-run title odds on a real 16-team field agree with an exact
  dynamic-programming calculation within 4.5 sigma for every series length.
  Negative control: with a deliberately wrong series rule, best-of-3/5/7 fail.
- Golden: PRNG outputs, strength seeding, a 16-team best-of-7 and an 8-team
  best-of-5 bracket, and 10,000-run odds, all pinned by SHA-256 of the result.
- Serialization: round-trips at both sizes and all series lengths; 15 corrupt
  forms rejected with specific codes; 2,000 random single-character
  corruptions never throw, and anything accepted is canonical.
- Benchmark (`tests/e2e/tournament-benchmark.spec.ts`): 10,000 runs, 16
  entrants, best-of-7, real exported data, in Chromium 153 (Playwright,
  headless) on Windows 10, AMD Ryzen 5 5600X: **median 31 ms, max 33 ms** over
  five runs.

**Notes for F04.**
- Load all entrants' team files before building the table; a table missing an
  entrant's file reports `unknown-entrant`.
- `seedByStrength` reflects the model, which leans on playoff results: in the
  test field the 73-9 2016 Warriors (lost the Finals) seed 15th of 16. Explain
  or offer a curated order rather than presenting the seeding as a ranking.
- An exact title-odds calculation (the test oracle) is cheap for 16 teams. If
  F04 wants noise-free odds, promoting it into the engine is a small change.

**Tooling added.** Vitest 5 (`npm test`, `vitest.config.ts`, unit tests only
under `tests/unit/`) and `tsconfig.test.json`.
