# F11: Older seasons (1985–86 to 1996–97)

Status: **not started.** Decided 2026-09-29; the build is later sessions on the
branch `f11-older-seasons`, which already holds this brief.

Read first, in order: `CONTRIBUTING.md` (the point-in-time rule, the release
rules, and "Known gotchas"), `docs/product/HANDOFF.md`,
`features/F01-model-release-integrity.md`, then this brief.

## Outcome

The matchup explorer and tournaments cover every season from 1985–86 on,
not only 1998 onward. That adds the 314 team-seasons from 1985–86 to
1996–97. A fan can put the 72–10 1996 Bulls, the 1986 Celtics, or the 1989
Pistons against any modern team. Every result still
comes from an honest, integrity-checked release, and older-era results are
labelled with what the model can and cannot know about them.

## Why

The teams fans argue about most are missing today: the 1991–93 and 1996–97
Bulls, the 1986 Celtics, the 1987 Lakers, the Bad Boy Pistons, the 1994–95
Rockets, and the 1990s Knicks, Jazz and Sonics. The data already on the
owner's machine covers them. The site stops at 1998 only because of a
constant in the build scripts.

## What the data holds (measured 2026-09-29)

All from the Kaggle dataset `eoinamoore/historical-nba-data-and-player-box-scores`
already in `data/raw/`:

| Seasons | Team-seasons | What exists |
|---|---|---|
| **1985–86 to 1996–97** | **314** | **Full basic box scores**: FG, 3P, FT, offensive and defensive rebounds, assists, steals, blocks, turnovers, fouls. Player box scores too. `gameType` is filled on every row |
| 1997–98 onward | 835 (served today) | The above, plus the NBA's advanced box score (`TeamStatisticsExtended.csv`) |

Season numbers in this brief are the year the season ends (1986 = 1985–86),
as in the exported keys.

Facts that shape the work:

1. **`TeamStatisticsExtended.csv` starts at the 1996–97 season.** The profile
   builder, the matchup training data, the static export, and the leakage
   guard all read it. The older seasons exist only in `TeamStatistics.csv`.
2. **Where both files overlap they agree exactly.** All 79,724 overlapping
   rows match on scores, box-score stats, and `gameDateTimeEst`. So
   `TeamStatistics.csv` can be the source for older seasons without changing
   the game-ordering rule.
3. **The advanced numbers must be computed for older seasons.** The served
   model (`hist-v1`, 70 columns) uses regular-season and playoff offensive,
   defensive and net rating, pace, true shooting, effective FG%, rebound
   percentages, assist percentage, assist-to-turnover ratio, turnover
   percentage, and opponent eFG% and turnover percentage. Today
   `build_team_season_profiles_extended.py` averages those from the NBA's
   per-game values (`offensiveRating`, `pace`, `possessions`,
   `trueShootingPercentage`, and so on) in the Extended file. Before
   1996–97 they must be computed from the basic box score with standard
   formulas (possessions from FGA, FTA, offensive rebounds and turnovers).
4. **Some profile columns cannot exist before 1996–97:** bench, fast-break,
   paint, second-chance and off-turnover points. The served model does not
   use them. A new model must not use them either, or older teams cannot be
   scored.
5. **Every franchise name from 1986–97 is already a name the site knows how
   to show era-correctly** (for example Washington Bullets, Seattle
   SuperSonics, Vancouver Grizzlies, New Jersey Nets, Charlotte Hornets). The
   export derives the name as of each season. The 1986–97 teams are listed
   in the table at the end of this brief.
6. **The cutoff is `MODERN_ERA_START = 1997`**, copied into five scripts:
   `clean_team_histories.py`, `build_team_season_profiles.py`,
   `build_team_season_profiles_extended.py`, `build_matchup_training_data.py`
   and `build_pregame_features.py`. **Do not change it in
   `build_pregame_features.py`**; see "Out of scope".

## Decisions

Agreed with the owner on 2026-09-29 unless marked **(owner to decide)**.

- **Scope:** 1985–86 to 1996–97, with the same kind of analysis the site
  does today. The site then covers 1985–86 onward.
- **The explorer is protected.** Every existing matchup URL and tournament
  link keeps working. Existing team-season keys (`1998-bulls`) never change.
- **Honest numbers only.** No accuracy figure is published unless it comes
  from a point-in-time evaluation (`CONTRIBUTING.md`). Older-era results carry
  the same neutral-court and limitation language as today, and more if the
  backtest shows weaker results for them.
- **Nothing goes live without the owner's OK.** A merge to `main` deploys the
  site at once (`DEPLOYMENT.md`). The site stays static.
- **Era adjustment (owner to decide after Session 1).** Whether older teams
  need era-relative inputs (each team measured against its own season's
  league average) is decided from Session 1's backtest, not assumed.
- **The Champions Bracket (owner to decide in Session 3).** Either keep it as
  "16 champions since 1998", or add the 1986–97 champions as a new curated
  bracket. Existing shared bracket links must
  keep working either way.

## Out of scope

- **Duel mode and the pre-game model.** Do not touch
  `build_pregame_features.py`, `train_pregame_model.py`, `models/pregame/`,
  `scripts/generate_duel_pool.py`, `data/processed/duel_pool/`, or
  `worker/`. Deployment phase 3 uploads the current duel pool, with its salt,
  to production, and puzzle ids depend on it. Older games in duel mode would
  be a separate brief after launch.
- **Seasons before 1985–86.** Keep the cutoff at 1985–86 in every script
  this brief changes.
- **Pricing, accounts, and anything commercial.**
- **Other leagues (ABA, BAA-only analysis).** The dataset marks non-NBA and
  All-Star teams, and `clean_team_histories.py` filters them. Keep that
  filter.

## Session plan

Each session runs on `f11-older-seasons` (or a branch from it), ends in a
verifiable state, and updates the "Handoff records" section at the end of this
brief. Run the full "How to verify" list in
`features/F09-continuation-handoff.md` before finishing any session that
changes code.

### Session 1: rebuild and backtest 1986–97 (no site change)

**Goal.** Know whether the current model can score 1986–97 teams honestly,
with numbers.

1. **Profile source.** Make the profile builder accept 1985–86 onward. For
   seasons before 1996–97, read `TeamStatistics.csv` and compute each
   advanced stat from the basic box score. Keep 1996–97 onward on the
   NBA's own values, unchanged.
   - Put the formulas in one place (next to `MEAN_STATS` / `PCT_STATS`), per
     `CONTRIBUTING.md` "Constants".
   - **Validate the formulas where both exist.** For 1996–97 to 2025–26,
     compute each stat from the basic box score and compare it with the
     NBA's value, per team-season. Record the error per stat (mean and
     maximum absolute difference) in the report. A formula whose error is
     large compared with the gap between an average and a good team is not
     usable. Say so, and do not use that stat for older teams.
2. **Identity.** Make `clean_team_histories.py` and the export's
   era-correct naming produce a unique key for every 1986–97 team-season
   (`1986-celtics`, `1990-bullets`, `1996-supersonics`). Raise `ValueError`
   on any duplicate, as the export already does.
3. **Backtest, out of sample.** `hist-v1` never trained on 1986–97. Score it
   on every 1986–97 game for which both teams have a point-in-time
   (pre-game, cumulative) profile. Build those with the same rules as
   `build_matchup_training_data.py`: `shift()`-ed cumulative aggregates, and
   ordering by the `gameDateTimeEst` timestamp. Report:
   - accuracy, log loss, and Brier score, and a calibration table, for
     1986–97 and, for comparison, for the model's own test seasons;
   - results split by season and by regular season and playoffs.
4. **Era drift.** For each season from 1986 to 2026, report the league
   average offensive rating, pace, three-point attempt rate and true
   shooting. This shows how far older raw ratings sit from modern ones.
5. **Leakage guard.** Extend `src/models/test_pregame_leakage.py`, or add a
   sibling check, so that it recomputes the 1986–97 profiles and features
   from raw files. It must exit 0 and must fail on deliberately leaked data,
   as the existing guard does.

**Output.** `reports/older_seasons_backtest.md`, with the tables above and a
recommendation: serve 1986–97 with the current feature set, or with
era-relative inputs (Session 2). Stop and let the owner decide the era
adjustment.

**Done when:** the report exists, the leakage guard passes, and the owner has
decided the era question. Nothing in `frontend/public/data/` or
`models/releases/` has changed.

### Session 2: a release that covers 1986 onward (`hist-v2`)

**Goal.** An immutable release that scores every 1986–2026 team-season, with
honest metrics.

1. If the owner chose era-relative inputs, compute them in **both** training
   and `src/models/predict_matchup.py`. The gotcha in `CONTRIBUTING.md` ("Some
   features can't be served") is exactly this: `_z` and `_pctile` features
   cannot be served until the prediction code computes them. Follow the
   point-in-time rule for training features. Normalising a training game
   uses the previous season's distribution (`_build_pool` in
   `train_model_experiments.py`). Decide and document what a completed
   season's served profile is normalised against, and keep training and
   serving consistent.
2. Extend the matchup training data to 1985–86 (`MODERN_ERA_START` in
   `build_matchup_training_data.py` and the profile scripts). Keep the
   chronological split (train ≤ 2018, validation 2019–2021, test ≥ 2022), or
   record why it changed. More early seasons go into training, never into
   test.
3. Train, then build and activate `hist-v2` with
   `scripts/promote_release.py`. Its `metrics.json` records honest,
   point-in-time metrics. Set `publicAccuracyClaim` only if the owner agrees
   to publish a number.
4. `python -m pytest tests/test_release_integrity.py` passes. `hist-v1` stays
   in `models/releases/` so it can be reactivated.

**Done when:** `hist-v2` is active on the branch, its release checks pass, and
its metrics are recorded in the handoff record next to `hist-v1`'s.

### Session 3: the site shows the older seasons

**Goal.** The explorer and tournaments offer every 1986–2026 team-season, and
nothing that works today breaks.

1. Re-export: `python scripts/export_static_site_data.py`, then
   `python scripts/verify_static_export.py`. The export must read
   `TeamStatistics.csv` for pre-1996–97 names (fact 1).
   - Size: about 1,150 team-seasons, each file listing every opponent. That
     is roughly 1.9× today's 27 MB in `frontend/public/data/teams/`. Pages
     allows 20,000 files and 25 MiB per file, so it fits, but measure the
     largest team file and the page weight of a matchup page.
2. The frontend, starting with these 1998 references:
   - `lib/search.ts` `MIN_SEASON = 1998`;
   - the home page ("835 team-seasons since 1998", suggested matchups; add at
     least one older headline matchup such as `1996-bulls` vs
     `2017-warriors`);
   - the About page ("any two seasons since 1998", plus limitation copy for
     older eras, such as no three-point-heavy offence before the 1990s);
   - `data/curated-tournaments.ts` (the Champions Bracket decision above).
   Leave the duel pages' "1998 to 2026" wording alone: duel mode is out of
   scope.
3. **Stability tests.** Add tests showing that every key in the current
   `index.json` still exists, that a sample of existing matchup URLs still
   resolves, and that an existing shared tournament link still decodes and
   replays. Existing matchups get new probabilities when `hist-v2` replaces
   `hist-v1`. Tell the owner, and record some before and after examples in
   the handoff record (for example `1998-bulls` vs `2017-warriors`, today
   73.8%).
4. Open the PR from `f11-older-seasons`. Its Pages preview is where the owner
   reviews it. **Stop for the owner's OK before merging**, because the merge
   deploys to `courtofalltime.win`.

**Done when:** the preview shows the 1986–97 teams, every existing URL works,
the verify list passes, and the owner has approved the merge.

## How to verify (every code session)

```
cd frontend && npm run build && npm run lint && npm test && npx playwright test
cd worker && npx tsc --noEmit && npm test
python -m pytest tests
python src/models/test_pregame_leakage.py        # must exit 0
python scripts/verify_static_export.py           # Sessions 2-3
python -m pytest tests/test_release_integrity.py # Sessions 2-3
```

The data scripts need `data/raw/` (gitignored). It is already on the owner's
machine. On another machine, run `backend/scripts/import_dataset.py` first
(Kaggle credentials in `.env`).

## Gotchas to expect

- **Windows and long jobs.** Training takes 10+ minutes. Launch it with
  PowerShell `Start-Process` and redirect to a log, or it can die silently
  (`CONTRIBUTING.md`).
- **Python file encoding.** Open files with `encoding="utf-8"`; cp1252 once
  truncated a source file (F09 handoff).
- **The season rule.** Every script treats a game in October or later as
  the next season (`dt.month < 10`). That works for 1986–97, whose seasons
  began in late October or November. Check that no pre-1998 game falls in
  October of the season it finishes. Separately, the 2020 Finals were played
  in October 2020, so check how those games are labelled before trusting
  per-season figures for 2020 and 2021.
- **1998–99 lockout, and short seasons.** 1998–99 had 50 games and
  2019–20 and 2020–21 were shortened. Per-game rates handle this; totals do
  not.
- **2022 is almost missing** in the matchup data (`CONTRIBUTING.md`). This
  does not affect older seasons, but do not fix it by accident in a way that
  changes the test split without recording it.
- **Three-point rate.** Before the mid-1990s few threes were taken, and the
  line moved in 1994–97. Three-point percentage on few attempts is noisy.

## Team names 1985–86 to 1996–97

From `TeamStatistics.csv`, regular season, as each season names them.

| Team | Seasons |
|---|---|
| Atlanta Hawks, Boston Celtics, Chicago Bulls, Cleveland Cavaliers, Dallas Mavericks, Denver Nuggets, Detroit Pistons, Golden State Warriors, Houston Rockets, Indiana Pacers, Los Angeles Clippers, Los Angeles Lakers, Milwaukee Bucks, New Jersey Nets, New York Knicks, Philadelphia 76ers, Phoenix Suns, Portland Trail Blazers, Sacramento Kings, San Antonio Spurs, Seattle SuperSonics, Utah Jazz, Washington Bullets | 1986–1997 |
| Charlotte Hornets, Miami Heat | 1989–1997 |
| Minnesota Timberwolves, Orlando Magic | 1990–1997 |
| Toronto Raptors, Vancouver Grizzlies | 1996–1997 |

## Handoff records

_(Each session adds its record here: what changed, the numbers, the owner's
decisions, and anything that differed from this plan.)_

## Kickoff prompts

Session 1:

```text
Implement F11 Session 1 (older seasons: rebuild and backtest 1986-97). Check
out the branch f11-older-seasons. Read CONTRIBUTING.md,
docs/product/HANDOFF.md, docs/product/features/F01-model-release-integrity.md
and docs/product/features/F11-older-seasons.md in full. Do Session 1 only:
compute the advanced stats for 1985-86 to 1995-96 from TeamStatistics.csv and
validate the formulas against the NBA's values, give every 1986-97
team-season a unique era-correct key, backtest hist-v1 out of sample on
1986-97 games, report era drift, and extend the leakage guard. Write
reports/older_seasons_backtest.md, run the verify list, fill in the Session 1
handoff record, commit, and push. Do not change the served release, the
exported site data, or anything in duel mode. Then ask me the era-adjustment
question with your recommendation.
```

Session 2:

```text
Implement F11 Session 2 (the hist-v2 release covering 1986 onward). Check out
f11-older-seasons. Read CONTRIBUTING.md, docs/product/HANDOFF.md, F01, and
F11 including the Session 1 record and my era-adjustment decision. Build the
features that decision needs in training and in predict_matchup.py, extend
the training data to 1985-86, train, then build and activate hist-v2 with
honest metrics. Keep hist-v1 available. Run the verify list and the release
checks, fill in the Session 2 record, commit, and push. Ask me before setting
publicAccuracyClaim.
```

Session 3:

```text
Implement F11 Session 3 (the site shows the older seasons). Check out
f11-older-seasons. Read CONTRIBUTING.md, docs/product/HANDOFF.md,
docs/product/DEPLOYMENT.md, and F11 including the Session 1-2 records.
Re-export and verify the static data, update the frontend's 1998 references
and copy, ask me the Champions Bracket question, add the URL-stability tests,
record before-and-after examples for existing matchups, run the verify list,
fill in the Session 3 record, and open the PR. Do not merge: I review the
Pages preview first.
```
