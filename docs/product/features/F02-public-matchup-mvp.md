# F02: Public matchup MVP

Status: **complete (2026-09-23)** against F01 release `hist-v1`. Deploy waits
only on the owner items listed at the end of the handoff record.

## Outcome

Ship the fastest credible fan loop:

```text
choose two team-seasons -> understand result -> try another -> share
```

## Authoritative specification

`docs/frontend-handoff.md` owns the detailed routes, visual direction, data
shape, neutral-site behavior, accessibility, copy, deployment, and acceptance
checks. Implement that document rather than restating it here.

## Dependency

F01 must provide a coherent release and verified export. F00 may remain under
review for a noncommercial prototype, but the public deployment must follow the
owner's legal guidance and cannot accept money, ads, or sponsorship without
commercial clearance.

## Current evidence

Verified 2026-09-23, after F01 activated `hist-v1`, by running every command
below.

| Check | Command | Result |
|---|---|---|
| Export correctness | `python scripts/verify_static_export.py` | PASSED, 200/200 sampled pairs, max probability diff `0.0`, max margin diff `0.0`, release tag matches `hist-v1` |
| Lint | `cd frontend && npm run lint` | clean |
| Build | `cd frontend && npm run build` | passes, ~278 kB JS / 89 kB gzipped |
| End-to-end | `cd frontend && npx playwright test` | 15 passed (7 smoke, 8 acceptance) |

- `frontend/` contains the React/Vite application, v1 pages, components, styles,
  helpers, configuration, and precomputed data (835 team files + `index.json`).
- Era-correct names confirmed in `index.json`: 2005 Seattle SuperSonics,
  Charlotte Bobcats, New Jersey Nets, New Orleans Hornets.
- Copy audit: no accuracy figure, no logos or imagery, and explicit
  "not betting advice" / "unofficial" disclaimers in `Layout.tsx` and `/about`.
- F01 is complete. `/about` shows the release tag from `index.json`, and its
  copy restates the `hist-v1` manifest's description and limitations.

## Owned surface

- `frontend/` application shell, routes, components, styles, tests, and build
  configuration;
- read-only consumption of `frontend/public/data/`;
- `/`, canonical matchup result route, and `/about`;
- free core matchup, stat comparison, series probability, random matchup, theme,
  accessibility, and honest limitations.

F02 does not own tournament domain logic, analytics naming, accounts, payment,
community voting, creator exports, or server state.

## Integration contracts

- Expose a tested function that loads `index.json` once and a team opponent file
  on demand.
- Expose canonical team and matchup URL helpers for F04 and F05.
- Keep matchup presentation components reusable by a tournament matchup view.
- Provide one extension point for analytics events without binding the UI to a
  vendor-specific SDK.

## Completion criteria

- Every v1 requirement and acceptance check in `docs/frontend-handoff.md` passes.
- Direct and reverse-order matchup URLs show one canonical result.
- The app works at 360px width, by keyboard, and with reduced motion.
- A non-playoff warning and `/about` limitations are visible and accurate.
- No official logos, player imagery, stale accuracy claim, or betting copy is
  present.
- F03/F04 can reuse data and canonical URL helpers without importing page
  components.

## Agent kickoff prompt

> Implement F02. Read `CONTRIBUTING.md`, `docs/product/HANDOFF.md`, this brief,
> and all of `docs/frontend-handoff.md`. Confirm F01's release/export contract
> first. Build only the public matchup MVP and the stated extension points; do
> not add accounts, tournaments, payments, or server state. Run the build,
> component tests, and Playwright acceptance checks, then update this brief with
> status, commands, results, and changed contracts.

## Handoff record

2026-09-22: implementation detected during documentation work. Production build
passes; lint has one warning; end-to-end acceptance coverage is not present.
Next agent should preserve the implementation, verify every frontend-handoff
requirement, add the required Playwright suite, and close F01 first.

2026-09-22 (later): acceptance closed out. The Playwright suite was already
present (`tests/e2e/smoke.spec.ts`, 7 tests) -- the earlier note that no test
files existed was wrong. Changes made:

- `tests/e2e/acceptance.spec.ts` (new, 5 tests) covers the completion criteria
  the smoke suite did not: 360px width with no horizontal overflow, a matchup
  built by keyboard alone, reduced motion, and the data-loading contract
  (`index.json` fetched exactly once; a team file only once a team is chosen).
- `src/lib/analytics.ts` (new) is the analytics extension point required by the
  integration contract: `track(event)` plus `registerAnalyticsSink(sink)`, with
  a closed `AnalyticsEvent` union and no vendor SDK anywhere in the UI. There
  are deliberately zero sinks today, since Cloudflare Web Analytics reports page
  views from a script tag on its own. Wired into matchup views, link copies,
  random rolls, team swaps, and theme changes.
- `src/pages/ResultPage.tsx`: the result is now keyed by its pair and discarded
  during render, removing the `set-state-in-effect` lint warning and the stale
  `setResult(null)`.
- `src/components/CountUpPercent.tsx`: **bug fix.** `requestAnimationFrame`
  passes the timestamp of the start of the frame, which can predate the
  `performance.now()` captured when scheduling, so the first tick computed a
  negative elapsed time and painted a negative win probability (`-0.9%`) for one
  frame. Progress is now clamped at both ends. Confirmed by sampling frames
  before and after: 14 negative-capable frames before, 0 after, animation still
  reaching its settled value.
- `src/components/SearchPicker.tsx`: options carry stable ids and the input
  exposes `aria-activedescendant`, so the keyboard highlight is reported to
  assistive tech rather than being visual only.

Note on the reduced-motion test: asserting the value once immediately would
pass vacuously, because `CountUpPercent` initialises its state to the target
before animating. The test samples ~25 frames and requires all of them to be the
settled value; this was validated against a temporary negative control with
reduced motion disabled, which failed as it should.

2026-09-23: aligned with F01 release `hist-v1` and the revised
`docs/frontend-handoff.md`. Changes made:

- `/about` rewritten from the `hist-v1` manifest: trained on playoff games
  only (non-playoff matchups are extrapolations), no published accuracy figure,
  a margin typically off by ~10 points, and "not betting advice". It reads
  `index.json` for the team count and shows `Model release hist-v1` from the new
  `release` field (`IndexData.release` in `src/types.ts`). When a new release is
  promoted, update this copy from its manifest.
- Margin copy no longer implies precision: `src/lib/margin.ts` renders
  "wins by about N pts" (or "by under 1 pt") instead of "wins by 0.6".
- Independent palette by default, per the revised spec and F00's open brand
  review: winner-card accents come from `--side-a` / `--side-b` in
  `index.css`. The team mapping in `src/data/team-colors.ts` stays, behind
  `TEAM_COLORS_APPROVED = false`; flip it only after F00's written approval.
- `tests/e2e/acceptance.spec.ts` gained 3 tests: the `/about` release tag and
  limitations, a rounded margin, and the independent palette. The palette test
  was validated against a negative control (flag set to `true`), and failed as
  it should.

Changed contracts for F03/F04/F05: `IndexData` now carries `release`; the margin
display goes through `formatMargin`; `WinnerCard` accents are per side, not per
team.

Remaining before deploy (owner): domain purchase, and F00 brand/legal review
(which also decides whether team colors return).
