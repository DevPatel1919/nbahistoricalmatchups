# F11: Older seasons (1985–86 to 1996–97)

Status: **Session 3 (Phase B) built (2026-10-01).**
- The site serves 1,177 team-seasons from 1985–86 on, through release
  `hist-v2`.
- The PR from `f11-older-seasons` is open. **Do not merge until the owner
  approves its Pages preview**, because the merge deploys.
- Sessions 1 and 2 (Phase A) were done 2026-09-30 and 2026-10-01. Decided
  2026-09-29.

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
- **Era adjustment: era-relative inputs (owner, 2026-10-01).** `hist-v2`
  measures each team's stats against its own season's league, not as raw
  numbers. The deciding evidence was Session 1's backtest: raw inputs gave
  older teams 46.4% in evenly matched cross-era pairs, era-relative inputs
  49.9%, with the same accuracy on real games.
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

### Session 1 (2026-09-30): rebuild and backtest 1986–97

The full evidence and the recommendation are in
`reports/older_seasons_backtest.md`. Regenerate its tables with
`python scripts/backtest_older_seasons.py`, which keeps the hand-written
summary above its marker.

**What changed**

- `build_team_season_profiles_extended.py` has a new `load_team_games(since,
  allowed_ids)`:
  - It reads 1996–97 onward from the Extended file, unchanged.
  - It reads earlier seasons from `TeamStatistics.csv`, with
    `BOX_SCORE_FORMULAS` computing the advanced stats. Those sit next to
    `MEAN_STATS` and `PCT_STATS` and are keyed by the Extended column each
    one replaces.
  - New constants: `OLDER_ERA_START = 1985`, `EXTENDED_STATS_START = 1996`,
    `POSSESSION_SCALE = 0.985` and `UNMATCHED_FORMULA_COLS`.
  - `--since 1986 --output <csv>` builds the older profiles. The default is
    still 1998 on, and its output is byte-identical.
  - `build_profiles` now keeps its columns when a game type has no games.
    That case only arises in ranges without a play-in.
- `build_matchup_training_data.py`: refactored into
  `load_games(since, allowed_ids)` and `attach_point_in_time_profiles(games,
  stats)` so the backtest uses the identical point-in-time logic.
  `MODERN_ERA_START` is unchanged, and its output is byte-identical (sha256
  `58ceb688…`).
- `clean_team_histories.py`: the cutoff is now 1985–86 (`OLDER_ERA_START`,
  `seasonActiveTill >= 1985`). That adds one row, the Washington Bullets,
  which share the Wizards' team id. Every reader sees the same team ids.
  `pregame_team_features.csv` was rebuilt to check, and it is byte-identical
  (duel mode untouched).
- `export_static_site_data.py`: era-correct names fall back to
  `TeamStatistics.csv` only for (team, season) pairs missing from the
  Extended file. `attach_identity(profiles)` is split out of
  `load_profiles_with_identity()`. The export was **not** re-run.
- `test_pregame_leakage.py` is refactored into
  `check_rows`/`sample_rows`/`prepare_stats`. It also checks
  `data/processed/older_seasons_matchups.csv` (written by the backtest)
  against `TeamStatistics.csv`, including offensive and defensive rating,
  pace, true shooting and turnover percentage.
  `tests/test_older_seasons.py` proves the check fails on full-season
  profiles and on a profile that includes the game itself.
- New: `scripts/backtest_older_seasons.py`,
  `reports/older_seasons_backtest.md`, `tests/test_older_seasons.py` (11
  tests). CONTRIBUTING has the backtest in the pipeline and a gotcha for
  pre-1996–97 data.

**Numbers**

| | Value |
|---|---|
| 1986–97 team-seasons / keys | 314, all unique (1,149 for 1986–2026) |
| Formula error / avg-to-good gap | ratings 6–8% (playoffs 8–14%), pace 6%, TS and eFG 0%, TOV% 7–8%, assist stats 0–12% |
| Not usable | offensive, defensive and total rebound %, and opponent offensive rebound % (144–165%, 28% for total): blank before 1996–97 |
| `hist-v1` on 1986–97 games (13,563) | 63.0% accuracy, log loss 0.682, Brier 0.239 |
| `hist-v1` on 2019–21 / 2022–26 | log loss 0.721 / 0.711 |
| `hist-v1` playoffs, 1986–97 / 2022–26 | log loss 0.949 / 0.972 |
| 1996–97, NBA values vs formulas | mean change in probability 0.01 points, 0 of 1,246 picks flip |
| Matched-quality cross-era P(older wins) | raw probe 46.4%, era-relative probe 49.9%, `hist-v1` 52.3% |

**Found along the way**

- `hist-v1`'s classifier is almost entirely `playoff_win_pct_diff`
  (1.19; nothing else is above 0.15). Every rating, pace and shooting weight
  is 0. On honest point-in-time games it barely beats "home team wins".
- `TeamStatistics.csv` stores 0, not blank, for `plusMinusPoints` and the
  situational points before 1996–97. The builder recomputes plus-minus and
  blanks the situational stats.
- The NBA's turnover % is turnovers per possession, not per play.
- No 1986–97 game falls in October of its ending year.
- Five 2020 Finals games (October 2020) are labelled season 2021 by the
  `month < 10` rule. This is existing behaviour and was left alone.
- 2022's 2 one-game profiles make it useless as a previous-season reference
  for 2023.

**Verify list (all green):** frontend build, lint, 146 unit and 48
Playwright tests; worker `tsc` and 123 tests; `python -m pytest tests` 51
passed; leakage guard exit 0 (350 + 350 games, 0 mismatches);
`verify_static_export.py` 200/200; `test_release_integrity.py` 23 passed.
Nothing in `frontend/public/data/` or `models/releases/` changed.

**Owner decision (2026-10-01):** era-relative inputs for `hist-v2`, as
recommended. The open points for Session 2 are in the report: the served
reference season, the 2022 hole, and rebound %.

### Session 2 / Phase A (2026-10-01): build `hist-v2`

Followed `F11-continuation-handoff.md` Phase A (A1–A9). The evidence and
the owner's decision are in `reports/hist_v2_evaluation.md`. Regenerate its
tables with `python scripts/evaluate_hist_v2.py`; it keeps the summary above
its marker.

**What changed**

- `build_team_season_profiles_extended.py`:
  - **A1, blank game types.** `fill_missing_game_types(df)` fills blank game
    types from `Games.csv` by `gameId`. It fills only counted types: id
    prefix 2 regular season, 4 playoffs, 5 play-in. It raises if one stays
    blank or disagrees with its id.
  - **A2, October 2020 Finals.** `assign_season_playoffs_by_year` gives
    playoff and play-in games the calendar year they were played in.
  - Both are opt-in: `load_team_games(since, ids, fill_game_types=False)`.
  - **A3, era-relative inputs.** One definition, next to `MEAN_STATS`:
    - `RELATIVE_STATS`: 14 stats, which is `CORE_STATS` minus the rebound
      percentages;
    - `ERA_NEUTRAL_STATS` and `is_era_safe_column`;
    - `league_reference(profiles)`;
    - `add_relative_columns(frame, seasons, reference, prefix)`;
    - `add_own_season_relative_columns(profiles)` for served profiles.
- **A4, training data.** The new `backend/scripts/build_historical_training_data.py`
  writes `data/processed/historical_training_data.csv`.
  - It covers 49,415 games from 1987 to 2026, including 1,323 from 2022.
  - It reuses `load_games(..., playoffs_by_year=True)` and
    `attach_point_in_time_profiles` unchanged, and skips the Elo/form merge.
  - The `_z` columns use the previous season's `league_reference`. It
    raises if a reference season is not a full league (fewer than 20 teams
    or 45 games).
  - `build_matchup_training_data.main()` is untouched, and its output is
    byte-identical.
- **Leakage guard.** `test_pregame_leakage.py` checks the new file with
  `check_rows` and `OLDER_PROFILE_MEANS`, using playoff seasons by year.
  - It checks 350 sampled games, plus 40 from 2022 and the 5 October 2020
    Finals games.
  - The new `check_relative` recomputes every `_z` from the previous
    season's raw per-game rows.
  - `tests/test_hist_v2.py` proves it fails when `_z` uses the game's own
    season.
- **A5, training.** `train_model_experiments.py` takes `--data` and `--out`.
  - A file that already holds the `league_reference` z-scores runs the
    era-relative mode:
    - 6 era-safe feature sets × 4 training filters × 24 models;
    - every candidate is chosen on one validation set (2019–21 games, both
      teams with 20+ regular-season games);
    - test is scored once.
  - The default file runs as before.
  - Artifacts are in `models/experiments/hist_v2/`; `models/experiments/*.pkl`
    is untouched.
- **A6, serving.** `predict_matchup._load()` and the export's
  `load_profiles_with_identity()` both call
  `add_own_season_relative_columns`. `PROFILE_SCHEMA_VERSION` is unchanged.
  - `_prediction_mode` words its warning by the release's `trainingFilter`
    in `metrics.json`. `hist-v1` has none and keeps its "playoff games only"
    text.
  - **Bug fixed:** `build_model_input` computed `_diff` columns only from the
    model's own `home_`/`away_` columns, so a diff-only model got NaN and a
    flat 50%. It now reads the profiles, as the export does. `hist-v1`'s
    output is unchanged (verifier 200/200).
- **A7, the release.** `hist-v2` is built from
  `models/experiments/hist_v2/release_info.json` and **not activated**.
  `promote_release.py --list` shows both releases valid, with `hist-v1`
  active.
- **New files:** `scripts/evaluate_hist_v2.py`,
  `reports/hist_v2_evaluation.md`, and `tests/test_hist_v2.py` (27 tests).

**`hist-v2`**

- An L1 logistic regression with C=0.001, trained on 29,834 games from
  1987–2018 in which both teams had played 20+ games.
- It has 14 columns (`era_adjusted_diff_only`), but only two carry weight:
  `regular_net_rating_z_diff` (0.51, 73%) and `regular_win_pct_z_diff`
  (0.19, 27%).
- The margin model is a ridge regression.

**Numbers: `hist-v2` against `hist-v1`, on the same point-in-time games**

| | `hist-v2` | `hist-v1` |
|---|---|---|
| Test 2022–26, all games (6,453) | 64.6% acc, log loss 0.638, ROC-AUC 0.688 | 55.6%, 0.712, 0.474 |
| Test, both teams 20+ games (5,053) | 65.0%, 0.628, 0.701 | 54.9%, 0.720, 0.468 |
| Test playoffs (422) | 62.6%, 0.653 | 59.2%, 0.976 |
| Validation 2019–21, all games (3,578) | 63.7%, 0.640 | 56.3%, 0.707 |
| Baselines, test | home team wins 55.5%; better record wins 62.9% | |
| Seasons above "better record wins" | 36 of 40 (1987–2026) | |
| Cross-era matched pairs, P(older wins) | 49.9% (mean distance from 50%: 1.7 pts) | 52.0% (16.6 pts) |
| Margin test MAE | 11.41 pts | 11.37 pts |
| `1998-bulls` vs `2017-warriors`, P(Bulls) | 35.6% | 26.25% (served) |

**Where this departed from the plan**

- **Training file.** `hist-v2` trains from the new
  `historical_training_data.csv`, not by extending `MODERN_ERA_START` in
  `build_matchup_training_data.py` (the brief's Session 2 step 2). Duel mode
  and the pre-game trainer still read a byte-identical
  `matchup_training_data.csv` (sha256 `58ceb688…`); `pregame_team_features.csv`
  is unchanged too (`a6fa3051…`).
- **2022 fix.** 2,644 blank 2021–22 rows are filled: 2,458 regular season,
  174 playoffs and 12 play-in. The other 134 blank rows are preseason and
  stay out.
  - 2022 now has 30 team-seasons of 82 games.
  - 2022's 1,307 scored games join the test split, which used to cover
    2023–26 in effect.
- **The 2001 hole (not in the plan).** 2000–01 has 1,194 blank
  regular-season rows (all 2xx ids) in both raw files. The same fix fills
  them. Every 2001 team goes from about 41 to 82 games, in training and, from
  Phase B, on the site. The site serves 2001 on half-seasons today.
- **Other blank rows** are preseason in every season (30–226 a year), plus 2
  NBA Cup rows and 4 prefix-6 rows in `TeamStatistics.csv` for 2025–26. That
  file is never read for those seasons. All stay out.
- **October 2020.** All 6 Finals games (Sept 30 to Oct 11) are now in 2020.
  The 5 October ones had moved to 2021. The served team-seasons that change
  in Phase B:
  - 2020 Lakers and Heat: playoffs 16 → 21 games;
  - 2021 Lakers: 11 → 6;
  - 2021 Heat: 9 → 4.
- **Selection fix.** The old script compared validation log loss across
  dataset filters with different validation sets. hist-v2 scores every
  candidate on the same validation games, and test only for the winner.
- **Playoff ratings left out.** Non-playoff teams carry 0 there, which is
  meaningless as a z-score. Playoff win % and net rating, and the flags,
  were offered and got no weight.
- **1986** has no previous season. Its games are not trained or evaluated
  on, and 1986 is only the reference for 1987. 1986 teams are served against
  their own season, like every served team.
- **Rows** need both teams to have played 1+ regular-season game that
  season.

**Phase B count to expect:** 1,177 team-seasons: 314 from 1986–97 and 863
from 1998–2026. Of those, 28 are new 2022 teams and 35 already-served
team-seasons change: 29 from 2001, 2 from 2022, and the 2020 and 2021 Lakers
and Heat.

**Verify list (all green):**

- frontend: build, lint, 146 unit and 48 Playwright tests;
- worker: `tsc` and 123 tests;
- `python -m pytest tests`: 78 passed (51 + 27 new);
- leakage guard: exit 0 (350 + 350 + 395 games, 0 mismatches);
- `verify_static_export.py`: 200/200;
- `test_release_integrity.py`: 23 passed;
- the duel hashes are unchanged.

Nothing in `frontend/public/data/`, `models/production/` or
`team_season_profiles_extended.csv` changed.

**Owner decision (2026-10-01):** go ahead with `hist-v2`. Publish no
accuracy figure, so `publicAccuracyClaim` stays null.

### Session 3 / Phase B (2026-10-01): the site shows the older seasons

**What changed**

- **B1, served profiles.** `build_team_season_profiles_extended.py` now
  writes 1986 onward by default, with `fill_game_types=True`. That is
  1,177 team-seasons: 314 from 1986–97, and 863 from 1998–2026, including all
  30 from 2022.
  - `build_matchup_training_data.py` and `build_pregame_features.py` keep
    1998.
  - `promote_release.py --activate hist-v2` (the previous release was
    `hist-v1`). Roll back with `--activate hist-v1`, then re-export.
- **B2, export.** 1,177 team files, 1,384,152 ordered pairs.
  `verify_static_export.py` passes 200/200 with max diff 0.0.
  `index.json` has `release.version = "hist-v2"`.
- **B3, frontend:**
  - `lib/search.ts`: `MIN_SEASON = 1986`. "96 bulls" finds 1996, "86
    celtics" finds 1986, and "17" still finds 2017.
  - Home page: the count and first season come from `index.json` ("1,177
    team-seasons since 1986"). `1996-bulls` vs `2017-warriors` and
    `1986-celtics` vs `2008-celtics` lead the suggestions.
  - About page: rewritten for `hist-v2`. It covers the own-league
    comparison, box-score stats before 1996–97, no rebound percentages,
    three-point history, non-playoff teams judged the same way, and a margin
    of about 11 points.
  - `team-colors.ts` gains `Bullets`. The `margin.ts` comment cites
    `hist-v2`. Duel files are untouched.
- **B4, stability tests:**
  - `frontend/tests/unit/stability.test.ts` checks:
    - all 835 pre-F11 keys still exist (`pre-f11-keys.json`, from
      `git show main:…/index.json`);
    - four existing matchup URLs resolve;
    - search covers the older seasons;
    - the Champions link and a custom link decode, re-encode identically,
      and replay deterministically.
  - The golden engine results now read a frozen copy of their 16 teams'
    hist-v1 data (`golden-field.hist-v1.json`), so a model release can't
    move them. They pass unchanged, which shows the bracket engine did not
    change.
  - Playwright adds an older-team search and three pre-F11 URLs. The 73.8% /
    "about 1 pt" pins became 64.4% / "about 5 pts".
  - `test_release_integrity.py`:
    - `hist-v2` is active (14 columns);
    - a separate test shows `hist-v1` still loads for rollback;
    - the smoke tests read the release and column count from the active
      manifest;
    - four 1986–97 smoke cases: the 1986 Celtics vs 1989 Pistons, the 1987
      Clippers (non-playoff), the 1990 Bullets via "Washington Wizards", and
      the 1996 Bulls vs 2017 Warriors.
  - `test_existing_keys_and_names_do_not_change` now checks that every key
    from 1998 on keeps its name, and that every pre-F11 key is served.
- **B5, docs:** CONTRIBUTING (scope, pipeline, z-score rule, blank game types
  and season-label gotchas, accuracy and serving gotchas), `HANDOFF.md`,
  `frontend-handoff.md`, and this record.

**Champions Bracket decision.** The question was put to the owner on
2026-10-01 and dismissed without an answer, so the default that changes
nothing was taken: `champions-v1` stays "16 champions since 1998".
- On the fixed data the same 16 still qualify, in the same seed order. The
  2022 Warriors (+5.5 net) rank 23rd of 28 champions.
- Only the "2022 champion is missing" note was removed. The definition and
  its shared link are unchanged.
- A separate 1986–97 bracket would be the 8 best of the 12 champions (the
  engine allows 8 or 16). It is easy to add if the owner wants it.

**Before and after.** Neutral P(first team wins): `hist-v1` as served before
F11 against `hist-v2` now (full tables in `reports/hist_v2_evaluation.md`).

| Pair | Before (`hist-v1`) | After (`hist-v2`) |
|---|---|---|
| `1998-bulls` vs `2017-warriors` | 26.25% (site: Warriors 73.8%, by about 1 pt) | 35.65% (site: Warriors 64.4%, by about 5 pts) |
| `1998-jazz` vs `2016-cavaliers` | 37.2% | 50.8% |
| `1996-bulls` vs `2017-warriors` | not served | 46.9% |
| `1986-celtics` vs `2008-celtics` | not served | 54.1% |
| `1989-pistons` vs `2004-pistons` | not served | 48.0% |
| `1987-lakers` vs `2001-lakers` | not served | 61.8% |

**Shared tournament replays change**, because the probabilities changed.
Every link still decodes.
- The Champions Bracket link (`t1.7.champions-v1.2025-thunder~…~2012-heat`,
  also the default `/tournament`) was won by `2017-warriors` over
  `2025-thunder` in 6. It is now won by `2025-thunder` over `2002-lakers` in
  7.
- A custom link,
  `t1.7.f11demo.2017-warriors~1998-bulls~2016-warriors~2008-celtics~2001-lakers~2013-heat~2004-pistons~2014-spurs`,
  went from `2004-pistons` to `2016-warriors`.

**The two broken 2022 teams** keep their keys and get full seasons:
`2022-clippers` (was 1–0, now 42–40) and `2022-lakers` (was 0–1, now
33–49). Every 2001 team goes from about 41 games to 82.

**Export size**

| | Before | After |
|---|---|---|
| Team files | 835, 27 MB | 1,177, 50.1 MB (47.8 MiB) |
| Largest team file | ~30 KB | 43.9 KB (`1993-mavericks.json`); the Pages limit is 25 MiB per file |
| Files | 836 | 1,178, under Pages' 20,000 |
| `index.json` | 189 KB (20 KB gzip) | 267 KB (28 KB gzip) |
| Matchup page data (index + one team file) | ~219 KB (~28 KB gzip) | ~309 KB (~37 KB gzip) |

**Verify list (all green):**
- frontend: build, lint, 159 unit tests (146 + 13) and 50 Playwright tests
  (48 + 2);
- worker: `tsc` and 123 tests;
- `python -m pytest tests`: 83;
- `test_release_integrity.py`: 28 (23 + 5);
- leakage guard: exit 0;
- `verify_static_export.py`: 200/200;
- `matchup_training_data.csv` (`58ceb688…`) and `pregame_team_features.csv`
  (`a6fa3051…`) are unchanged.

**Review fix: non-playoff teams are not extrapolations under `hist-v2`.**
`hist-v2` was trained on regular-season, play-in and playoff games and reads
regular-season stats only. Even so, `predict_matchup` still returned
`playoff_context_model_extrapolated`, with a warning, whenever a team had
missed the playoffs. The site's `matchup_completed` event also set
`extrapolationWarning` from playoff participation alone, and the smoke tests
kept that behaviour.

- **One rule.** `release.extrapolates_non_playoff_teams(release)` is true only
  for a playoffs-only release. Its `trainingFilter` is `playoffs_only`, or
  missing, as in `hist-v1`.
- **`predict_matchup`.** Under `hist-v2`, every pair gets the mode
  `regular_season_relative_model` and no warnings. `hist-v1`'s modes and
  warnings are unchanged.
- **The export.** `index.json`'s release block gains
  `nonPlayoffExtrapolation` (false for `hist-v2`). `verify_static_export.py`
  fails if the block differs from the active release. Re-exporting changed
  only `index.json`; every team file is byte-identical.
- **The site.** `lib/extrapolation.ts` `isExtrapolation(release, a, b)` drives
  `extrapolationWarning`. An export without the flag counts as `hist-v1`.
- **Tests:**
  - the smoke suite derives the expected mode from the release, and asserts
    that a playoff warning appears exactly when the pair is an
    extrapolation;
  - the same 9 smoke matchups run again under a `hist-v1` rollback;
  - unit tests cover `_prediction_mode` for both kinds of release;
  - `extrapolation.test.ts` covers the site helper;
  - the Playwright test now expects `extrapolationWarning: false` for a
    non-playoff team.
- **Counts after the fix:** `pytest tests` 100, `test_release_integrity.py`
  45, frontend 163 unit and 50 Playwright tests.

**Owner, before merging:**
- review the Pages preview;
- confirm or change the Champions Bracket default.

After the merge, check the live site loads `/`, a matchup,
`/1996-bulls-vs-2017-warriors`, `/about` and `/tournament`.

## Kickoff prompts

**Use `F11-continuation-handoff.md` for Sessions 2 and 3.** It supersedes
the two prompts below. It has the full plan after the owner's era decision,
the duel-safety rules (hist-v2 trains from a new file, so
`matchup_training_data.csv` stays byte-identical), the 2022 and October
2020 fixes, and its own kickoff prompts for Phase A (model) and Phase B
(site).

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
