# F04: Tournament fan experience

Status: **complete (2026-09-23)**. Routes `/tournament`, `/tournament/new`, `/t/:code`; F05 can build share images and dashboards on it.

## Outcome

Turn a matchup curiosity into participation and return behavior. A fan selects
or opens a curated tournament, fills a personal bracket, reveals reproducible
model results, compares picks, and shares the bracket.

## MVP journey

1. Open the curated 16-team Champions tournament.
2. Review entrants, seeding, neutral-court assumptions, and limitations.
3. Fill every personal prediction before revealing model results.
4. Reveal rounds one at a time or all at once.
5. Compare personal picks with the seeded model bracket and title odds.
6. See score, champion, biggest disagreement, and share action.
7. Reopen the shared URL and receive the same entrants and model outcome.

## Owned surface

- tournament routes, screens, bracket components, mobile layout, and local
  persistence;
- curated entrant configuration;
- personal prediction scoring and reveal state;
- accessible list/table alternative to any visual bracket;
- calls into F03 and shared F02 data/URL helpers.

F04 does not own simulation math, analytics names, aggregated fan voting,
accounts, payments, cash prizes, or creator branding.

## Decisions

- MVP is one curated 16-team tournament plus an eight-team local custom mode if
  it does not delay the curated journey.
- The personal bracket is chosen before model reveal.
- Shared model outcomes are deterministic. A separately labeled "run another"
  action creates a new seed and URL.
- Display both the single seeded story and multi-run title probabilities. One is
  entertainment; the other communicates uncertainty.
- Store unfinished personal picks locally. Do not place personal picks in a
  public URL unless the user explicitly chooses to share them.

## Completion criteria

- A user can complete the entire journey at 360px width and by keyboard.
- Refreshing or opening the same shared URL reproduces the model bracket.
- Personal scoring is correct for first round, semifinal, and championship
  weights and is covered by tests.
- Invalid shared definitions fail to a safe explanatory screen.
- Assumptions say neutral court, independent games, and model estimate.
- No detailed score or player statistics are fabricated.
- F05 analytics hooks exist at creation, prediction completion, reveal, and
  share boundaries.

## Agent kickoff prompt

> Implement F04 after confirming F02's route/data helpers and F03's public
> engine contract. Read `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, and this
> brief. Build the curated tournament journey, prediction bracket, reveal,
> title-odds view, deterministic sharing, accessibility, and tests. Consume F03
> without changing its math inside UI components. Update this brief with routes,
> scoring rules, tests, and any agreed contract changes.

## Handoff record

Record routes, persistence behavior, curated entrants, scoring weights, and
verification results.

### 2026-09-23: tournament v1

**Routes.**

| Route | Screen |
|---|---|
| `/tournament` | The curated Champions bracket (`src/pages/TournamentPage.tsx`). |
| `/t/:code` | Any definition in the F03 `t1.` format. Shared links and "run another story" land here. A code equal to a curated definition is treated as that curated tournament. |
| `/tournament/new` | Eight-team custom builder (`src/pages/TournamentBuilderPage.tsx`): search, seeding by net rating or added order, best-of-1/3/5/7. |

Header nav gained "Tournament"; the home page has a Champions Bracket card.

**Journey.** Entrants table and assumptions, then "Make my picks". Every
series must be picked before either reveal button appears. Reveal is round by
round or all at once; picks lock once anything is revealed. The full reveal
shows the model champion, score, correct picks, the fan's champion, the
biggest disagreement, score by round, 10,000-run title odds, and share / run
another story / start over. The bracket is one component
(`components/tournament/BracketView.tsx`) rendered as ordered lists of
labelled groups: four columns at >= 760px, stacked rounds below. That list is
also the accessible alternative; there is no separate visual-only bracket.

**Curated entrants** (`src/data/curated-tournaments.ts`, id `champions-v1`,
seed `champions-v1`, best-of-7): the 16 champions 1998-2025 with the best
regular-season net rating, seeded by net rating (ties by win percentage). A
real statistic rather than the model's ranking, per the F03 note. 2022 is
absent from the export; 2026 is excluded until its champion is confirmed.
Never edit a published curated definition: add `champions-v2`.

Model quirk worth knowing for copy: the 1 seed (2025 Thunder) has about 1.5%
title odds in the model; the 2017 Warriors and 1999 Spurs lead. That is the
`hist-v1` playoff-trained model, not a UI bug.

**Scoring** (`src/lib/bracket.ts`). A pick in round r scores `10 * 2^r`
points (10/20/40/80) when the picked team won that bracket position's series
in the model story. Each round of a 16-team bracket is worth 80 (max 320); an
8-team bracket is 40 per round (max 120). Changing a pick clears later picks
that are no longer possible. The biggest disagreement is the fan's pick with the
lowest model series-win probability (best-of-N from the single-game
probability); null if every pick was the favorite.

**Persistence** (`src/lib/tournamentStorage.ts`). `localStorage` key
`ct:tournament:v1:<code>` holds `{ started, picks, revealed,
completionTracked }`, validated on load (corrupt or impossible picks are
dropped). Every access is guarded; the journey works with storage blocked.
Picks never go in a URL. "Run another story" makes a new seed with
`generateSeed(Math.random)` and copies the picks to the new code, unrevealed.

**Analytics (F05 names).** Added to the `AnalyticsEvent` union in
`src/lib/analytics.ts`, each fired once per transition:

| Event | Fired when | Properties |
|---|---|---|
| `tournament_started` | "Make my picks" (curated or custom) | `tournamentId`, `entrantCount` |
| `bracket_predictions_completed` | first time every series is picked (re-completing after an edit does not refire) | `tournamentId` |
| `tournament_revealed` | first reveal action | `tournamentId`, `revealMode: "round" \| "all"` |
| `tournament_shared` | successful share sheet or link copy | `tournamentId`, `shareMethod: "native" \| "copy"` |

`tournamentId` is the curated id or `custom-8`/`custom-16`; never the code,
seed, or picks. In development, `main.tsx` registers a sink that logs every
event to `window.__ctAnalytics` (the e2e suite reads it); production still has
zero sinks. Custom-tournament creation fires no separate event, since F05 has no
canonical name for it; `tournament_started` covers it.

**Contract changes.** `seriesWinProbability(p, bestOf = 7)` in
`src/lib/series.ts` now takes a series length (existing callers unchanged).
No engine change.

**Verification.**

| Check | Command | Result |
|---|---|---|
| Unit | `cd frontend && npm test` | 90 passed (19 new in `tests/unit/bracket.test.ts`) |
| E2E | `cd frontend && npx playwright test` | 22 passed (6 new in `tests/e2e/tournament.spec.ts`) |
| Types + build | `cd frontend && npm run build` | passes |
| Lint | `cd frontend && npm run lint` | clean |

Unit coverage: 10/20/40/80 weights for first round, quarterfinal,
semifinal, and championship picks, 8- and 16-team maxima, revealed-round
limits, wrong picks, bracket positions matching the engine, pick
invalidation, stored-pick validation, disagreement, generalized series odds
against the exact formula, and the curated definition validating against
`index.json`. E2E: the full curated journey at 360px by keyboard with no
horizontal overflow; refresh and a fresh browser context on the shared link
reproduce the same champion and model bracket, and the shared URL carries no
picks; run another story; four invalid link shapes reach the safe screen; the
analytics sequence; an 8-team custom build and play.

**Not done / for later.** Share images are F05's. Picks-in-URL sharing ("share
my picks") is not built; the brief only allows it as an explicit opt-in. The
title odds are Monte Carlo (10,000 runs); F03 notes an exact calculation is
cheap if noise-free odds are wanted.

