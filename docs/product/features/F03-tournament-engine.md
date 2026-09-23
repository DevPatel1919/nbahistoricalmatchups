# F03: Deterministic tournament engine

Status: **ready after F01 stabilizes the exported-data contract**.

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

Record engine location, exported interface, serialization version, benchmark,
and test commands.

