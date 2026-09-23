# F04: Tournament fan experience

Status: **depends on F02 and F03**.

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

