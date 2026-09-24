# Court of All Time: product and implementation handoff

This is the entry point for every new agent working on the public product,
tournaments, growth, creator tools, or monetization. Read this file first, then
open only the feature brief assigned to you. Read `CONTRIBUTING.md` before
changing code.

Last reviewed: 2026-09-22.

## Product thesis

Court of All Time is a historical basketball debate and content product. A fan
can compare two completed team-seasons, simulate a series or tournament, make a
prediction, and share a stable result. A creator or publisher can turn those
same simulations into audience content.

The model is an ingredient, not the value proposition. Users receive:

- a fast way to explore an unanswerable sports debate;
- an understandable and reproducible result;
- a bracket, prediction, or challenge in which they have participated;
- a result worth sharing or discussing.

Paying customers receive a recurring outcome:

- creators save research and production time;
- publishers receive an interactive engagement and email-capture surface;
- committed fans receive private, larger, saved, and customizable tournaments.

The strongest initial payer is a basketball creator, not a casual fan. The
free fan experience is the audience and distribution loop.

## Monetization decision

Use a **free-core, paid-workflow** strategy. Popularize and monetize in
parallel; do not choose between them as two consecutive stages.

1. Launch the matchup and one curated tournament free. Sharing is part of the
   product and stays free.
2. Show pricing and collect purchase intent from the beginning, without taking
   payment before commercial data rights are cleared.
3. After rights clearance, sell creator content packages manually before
   building creator SaaS.
4. Build paid creator features after at least two paid pilots and one repeat
   purchase or renewal.
5. Build fan subscriptions only after repeat fan use is demonstrated. Prefer
   an annual plan or tournament pass over an immediate monthly subscription.
6. Add direct sponsors and ads after the site has consistent reach. Treat them
   as supporting revenue.
7. Keep betting, sportsbook affiliates, paid-entry contests, and prizes out of
   this product. They require a separate rights, evidence, and compliance plan.

This is the decision unless new evidence crosses one of the review gates below.

## Why this sequence

A basic matchup result is occasional entertainment and has low recurring
willingness to pay. Paywalling it suppresses the sharing loop before the product
has distribution. Waiting for vague "popularity" before testing money is also
risky: traffic can grow without purchase intent. The free core tests demand;
manual creator sales test willingness to pay; software follows repeated paid
workflows.

## Commercial and truthfulness gates

These are release gates, not optional cleanup.

### Commercial-data gate

The current Kaggle dataset is marked CC0 but credits NBA.com as its underlying
source. NBA.com's terms restrict commercial use of its statistics, and CC0 does
not clear third-party rights. Before accepting payments, serving ads, running
sponsorships, providing paid API/widget access, or delivering paid content:

- obtain written permission for the present data and derived outputs; or
- replace it with a commercial license that explicitly covers the intended use;
- have counsel review the chosen source, branding, team-name display, and output.

Record the evidence and permitted uses in the commercial-rights brief. The
full source research is in `reports/monetization_research.md`.

### Model-integrity gate

The code must load one coherent release bundle: classifier, regressor, columns,
metrics, source schema, and version. A deploy is blocked unless the matchup
smoke suite and static-export verifier pass. The public product must not repeat
the stale/leaky 71.04% claim or present margin output as precise.

### Brand gate

Use the independent Court of All Time identity and original visuals. Do not use
league/team logos, player photos, footage, jerseys, or language implying an
official relationship. Plain-text team references and final disclaimers remain
subject to the commercial-rights review.

## Product boundaries

### Free core

- choose any two supported team-seasons;
- neutral-court matchup result and best-of-seven probability;
- side-by-side season statistics and honest limitations;
- stable shareable matchup URL;
- join one curated public tournament;
- complete a personal prediction bracket;
- share result and bracket links;
- play duel mode as a guest against the practice bot or an invited friend;
- create an account to enter the ranked ladder and leaderboard.

### Candidate paid fan value

- larger custom tournaments and private groups;
- saved bracket history and additional visual themes;
- repeated seeded tournament runs and deeper distributions;
- annual membership or one-time tournament packs.

Fan payment is a hypothesis. It becomes roadmap work only after the demand gate
in `features/F07-paid-plans-and-entitlements.md` is satisfied.

### Candidate paid creator value

- batch matchup and tournament generation;
- branded original graphics and reusable templates;
- short-form and long-form script drafts grounded in model output;
- audience voting pages and embeddable tournaments;
- exports and engagement analytics.

### Explicitly outside the current product

- betting picks, betting ROI, or guaranteed outcomes;
- cash-entry tournaments or prizes;
- player-level box-score simulation;
- invented game or player statistics;
- redistribution of the underlying statistical database;
- claims that counterfactual cross-era outcomes can be validated as fact.

## Existing architecture and sources of truth

- `docs/frontend-handoff.md` is the detailed v1 static-site build specification.
- `scripts/export_static_site_data.py` exports neutral-site pair results.
- `scripts/verify_static_export.py` compares exported results with live model
  calls.
- `frontend/public/data/index.json` lists the supported team-seasons.
- `frontend/public/data/teams/*.json` contains precomputed opponent results.
- `src/models/predict_matchup.py` is the current Python prediction interface.
- `models/experiments/experiment_metrics.json` contains the latest experiment
  metrics; production claims must match the promoted bundle, not a stale doc.
- `reports/monetization_research.md` is the sourced commercial research.

The current architecture is static React + TypeScript + Vite on Cloudflare
Pages. Keep the public matchup and local tournament MVP static. Accounts,
cross-device saved state, community vote aggregation, payment webhooks, private
groups, and customer-specific embeds require server-side state; introduce a
Cloudflare Worker and D1/KV only when an accepted feature brief reaches that
need. `features/F09-daily-duel.md` is the first brief that reaches it, and owns
the Worker, D1, and KV footprint. The public matchup explorer stays static and
must keep working with the backend unavailable.

As of 2026-09-23, F01 (release `hist-v1`), F02 (public matchup MVP), F03
(tournament engine, `frontend/src/tournament/`), and F04 (tournament
experience: `/tournament`, `/t/:code`, `/tournament/new`) are complete. F05
(sharing, analytics, price intent) is built; it starts measuring once the owner
configures an analytics provider and an email endpoint (see
`analytics/weekly-dashboard.md`). The `frontend/` builds and lints clean; 103
unit tests and 34 Playwright tests pass. See each brief's handoff record.

F09 (duel mode) Sessions 1–4 are built on branch `f09-duel-mode`: the offline
puzzle pool (`scripts/generate_duel_pool.py`), the pure domain logic
(`frontend/src/duel/`), the first server state (`worker/`: Cloudflare Worker,
D1, KV), and guest-playable `/duel` routes gated on `VITE_DUEL_API`. The
explorer and tournaments stay static and are tested with the API unreachable.
Ranked play is blocked on two owner decisions recorded in the F09 brief:
de-identified puzzles cannot stop a scripted lookup against the public dataset,
and the single-use rule caps ranked at about 1,332 duels. Nothing is deployed;
the owner configuration steps are in the F09 Session 3 handoff. The
`frontend/` now has 130 unit and 40 Playwright tests; `worker/` has 20.

## Feature map

Each feature brief owns a distinct interface. Assign one brief per agent. Do
not assign dependent briefs in parallel until their dependency contracts are
stable.

| ID | Feature brief | Depends on | Can run in parallel with |
|---|---|---|---|
| F00 | [Commercial rights and brand](features/F00-commercial-rights-and-brand.md) | none | F01 |
| F01 | [Model release integrity](features/F01-model-release-integrity.md) | none | F00 |
| F02 | [Public matchup MVP](features/F02-public-matchup-mvp.md) | F01 | F00 |
| F03 | [Tournament engine](features/F03-tournament-engine.md) | exported-data contract from F01 | F02 |
| F04 | [Tournament experience](features/F04-tournament-experience.md) | F02, F03 | F05 after route contract is agreed |
| F05 | [Sharing, analytics, and demand tests](features/F05-growth-and-demand.md) | F02; integrates with F04 | F03 |
| F06 | [Creator content pilot and toolkit](features/F06-creator-toolkit.md) | F00, F02, F05 | F04 |
| F07 | [Paid plans and entitlements](features/F07-paid-plans-and-entitlements.md) | F00 plus demand evidence from F05/F06 | F08 discovery |
| F08 | [Publisher widget and API](features/F08-widget-and-api.md) | F00, F01, F05 | F07 after contracts are stable |
| F09 | [Duel mode and ranked ladder](features/F09-daily-duel.md) | F01 for the pre-game bundle | F02, F03, F04 |

Recommended sequence:

```text
F00 rights -------------------------------> commercial launch permission
F01 integrity -> F02 public MVP -> F05 measurement -> demand evidence
                  |              \
                  v               -> F06 manual creator pilots -> F07 payments
             F03 engine -> F04 tournament UI -----------/
                                                       \
                                                        -> F08 widget/API
```

F00 is primarily owner/legal work and may block commercial launch without
blocking noncommercial prototype development. F06 begins as sales and manual
delivery; a new agent should not build its dashboard before the stated gate.

## Cross-feature contracts

### Team identity

Use the exported `key` as the durable team-season identifier. Display the
era-correct city and name from `index.json`. Do not derive identity from a
current franchise nickname in UI code.

### Matchup result

For team A against team B, read A's exported opponent entry:

```ts
type MatchupResult = {
  teamAKey: string;
  teamBKey: string;
  neutralWinProbabilityA: number;
  neutralMarginA: number;
};
```

Probabilities are model estimates for entertainment. UI copy must preserve
neutral-court and limitation language.

### Deterministic randomness

Shared tournament URLs must reproduce the same bracket result. All random
draws use an explicit seed and a deterministic PRNG owned by F03. No component
may call `Math.random()` for a shareable outcome.

### Analytics vocabulary

Use the canonical events in F05. Feature agents may add properties, but they
must not invent alternate names for the same action. Collect no sensitive data
in event properties.

### Monetization boundary

Feature UI may show non-transactional interest buttons before rights clearance.
Only F07 owns checkout, entitlements, cancellation, and webhooks. Other
features consume an entitlement interface and remain usable in a free mode.

## Decision and evidence log

Update this table only when owner evidence changes a settled decision. Link the
supporting issue, experiment, or document.

| Date | Decision | Evidence | Review trigger |
|---|---|---|---|
| 2026-09-22 | Free core plus paid creator workflow | Occasional fan curiosity is weak recurring value; creator workflow has measurable time/revenue value | Creator pilots fail or fan paid intent is materially stronger |
| 2026-09-22 | Popularize and test monetization concurrently | Free sharing needs low friction; purchase intent must be tested before mass traffic | Paid conversion/retention data |
| 2026-09-22 | Static public MVP | All pair outputs are precomputed and annual refresh is sufficient | A validated feature requires server state |
| 2026-09-22 | Tournament has reproducible seeded outcomes plus probability view | Stable shared stories and honest uncertainty serve different jobs | User testing shows one mode is unused |
| 2026-09-22 | Creator first, fan subscription later | Creators have recurring content needs and a clearer return on spend | At least 25 qualified fan purchase intents with repeat use |
| 2026-09-22 | Betting excluded | No odds-based ROI proof; additional data and regulatory burdens | Separate owner-approved business plan |
| 2026-09-22 | Add duel mode scored against real completed games | Cross-era results have no ground truth; real games give verifiable answers and honest calibration data | Players find the pre-game format unengaging |
| 2026-09-22 | Duel mode crosses into server state | A ranked ladder cannot be made cheat-resistant on a static site | None; the static explorer remains backend-free |
| 2026-09-22 | Play is open to guests; the leaderboard requires an account | Signup walls suppress trial, but free identities make a ladder farmable | Guest abuse of unranked modes becomes costly |
| 2026-09-22 | Fill-in opponent is a disclosed practice bot, never "the model" | A rubber-banded bot told the answer is not a prediction; labelling it as one breaks the model-integrity gate | None; this is a gate, not a preference |
| 2026-09-22 | Unranked sets use a fixed confidence composition; ranked sets use signal divergence | Uniform draws converge scores at both extremes; a rated duel decided by coin flips measures luck, not skill | Archetype gates in F09 Session 1 show the naive-versus-model gap is too thin |

## Success and review gates

Treat these as proposed validation thresholds, not industry benchmarks.

### Public-product gate

- 1,000 targeted visits;
- at least 25% complete a matchup;
- at least 8% share a result or join the email list;
- at least 20% of identifiable users return within seven days, or a comparable
  privacy-preserving cohort measure.

If activation is weak, improve the first result experience before tournaments.
If activation is strong but sharing is weak, improve the artifact and challenge
loop before adding a paywall.

### Creator-product gate

- 30 personalized creator outreaches;
- at least five substantive replies or calls;
- at least two paid pilots after rights clearance;
- at least one repeat purchase or renewal;
- the same production step requested by multiple customers.

Only then automate the repeated creator workflow.

### Fan-payment gate

- repeat use satisfies the public-product gate;
- at least 25 qualified users click a clearly priced annual-plan or tournament-
  pass intent action;
- at least 10 complete a follow-up purchase-interest step;
- interviews identify a repeated paid job such as private group tournaments,
  not merely general enthusiasm.

### B2B gate

- ten publisher/creator widget demonstrations;
- at least one written pilot commitment;
- engagement analytics can measure the promised outcome;
- the commercial data agreement permits customer embeds and derived output.

## How a new agent should work

1. Read `CONTRIBUTING.md`, this file, and the assigned feature brief completely.
2. Inspect the referenced implementation files because the repository is the
   source of truth for current status.
3. State which dependency contracts are satisfied. Stop at an unmet hard gate;
   prototype behind an inert flag only when the brief explicitly permits it.
4. Change only the assigned feature's owned surface unless an interface change
   is unavoidable. Document the interface change in the feature brief.
5. Run every acceptance check in the feature brief plus affected existing
   tests.
6. Update the brief's status, evidence, decisions, and handoff section before
   completing the task.

Copy the `Agent kickoff prompt` from the selected feature brief into a new
session. It is intentionally scoped so multiple agents can work without
rediscovering the whole product strategy.
