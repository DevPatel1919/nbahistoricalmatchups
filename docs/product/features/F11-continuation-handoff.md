# F11 continuation handoff: era-relative `hist-v2`, then the site

Written 2026-10-01 at the end of F11 Session 1. This is the one document a
new session needs to finish F11. It covers:

- Phase A: the model (the brief's Session 2);
- an owner review of the numbers;
- Phase B: the site, up to the merge to `main` (the brief's Session 3).

Branch: `f11-older-seasons` (last commit at writing: `f4105c8`).

**Status (2026-10-01): Phase A is done.** `hist-v2` is built, not active.
The results are in `reports/hist_v2_evaluation.md` and in the Session 2
record in `F11-older-seasons.md`. It includes the 2000–01 blank game types
that A1 did not expect. Phase B waits for the owner's answer to the STOP
below.

## Read first, in order

1. `CONTRIBUTING.md`: the point-in-time rule, the pipeline, code conventions,
   and "Known gotchas" (including the new pre-1996–97 entry).
2. `docs/product/HANDOFF.md`
3. `docs/product/features/F01-model-release-integrity.md`: how releases work.
4. `docs/product/features/F11-older-seasons.md`: the brief, its Decisions,
   and the Session 1 handoff record.
5. `reports/older_seasons_backtest.md`: the evidence behind every decision
   below. Read at least the Summary and Recommendation.
6. This document.
7. Phase B only: `docs/product/DEPLOYMENT.md`. A merge to `main` deploys
   `courtofalltime.win` at once.

## The goal in one paragraph

The explorer should cover every season from 1985–86 on. Older teams must be
judged fairly against modern ones. League scoring, shooting and pace changed
a lot between eras: league offensive rating was about 107 in 1990 and about
115 today. So the new model judges each team **by how good it was compared
with its own season's league** (a z-score: steps above or below that
season's average), not by raw numbers. Session 1 showed why. Evenly matched
cross-era pairs come out 46.4% for the older team with raw inputs, and 49.9%
with league-relative inputs. Real-game accuracy is the same either way.

## Decisions already made (do not reopen)

| Decision | By | When |
|---|---|---|
| Scope is 1985–86 to 1996–97 plus everything served today. Nothing before 1985–86 | owner | 2026-09-29 |
| `hist-v2` uses **era-relative inputs** | owner | 2026-10-01 |
| Existing keys (`1998-bulls`) and URLs never change; shared tournament links keep decoding | owner | 2026-09-29 |
| No accuracy figure is published without the owner's OK (`publicAccuracyClaim` stays `null` until then) | owner | 2026-09-29 |
| Nothing merges to `main` without the owner's OK. The merge goes live | owner | 2026-09-29 |
| Duel mode and the pre-game model are untouched | owner | 2026-09-29 |
| Champions Bracket: keep "16 champions since 1998" or add a 1986–97 bracket | **owner, ask in Phase B** | |

## What Session 1 already built (reuse it, don't rebuild it)

All on `f11-older-seasons`, commit `a022517`.

`backend/scripts/build_team_season_profiles_extended.py`:
- **Constants:**
  - `MODERN_ERA_START = 1997` (the default output starts at 1998).
  - `OLDER_ERA_START = 1985` (earliest supported: season 1986).
  - `EXTENDED_STATS_START = 1996` (the Extended file covers 1997 onward).
  - `POSSESSION_SCALE = 0.985`, `POSSESSION_FT_WEIGHT = 0.44`.
- **Stat definitions:** `MEAN_STATS` and `PCT_STATS` (as before), plus:
  - `BOX_SCORE_FORMULAS`: advanced stats from the basic box score, keyed by
    the Extended column each one replaces.
  - `UNMATCHED_FORMULA_COLS`: the four rebound percentages, blank before
    1996–97.
  - `SITUATIONAL_SOURCE_COLS`: blank before 1996–97.
  - `OPPONENT_BOX_COLS`.
- **Functions:**
  - `estimate_possessions(g)`, `with_opponent_box(df)`,
    `compute_box_score_advanced(df)`.
  - `load_allowed_team_ids()`, `_read_team_games(path)`.
  - **`load_team_games(since_season, allowed_ids)`**: per-team-game rows for
    any season from 1986. It reads the Extended file from 1997 and
    `TeamStatistics.csv` plus the formulas before that.
  - `build_profiles(df, prefix)`, **`build_season_profiles(df)`**: one
    validated row per team-season.
- **CLI:** `--since 1986 --output <csv>`. The default output is unchanged
  (sha256 `05c7199e…`).

`backend/scripts/build_matchup_training_data.py`:
- `load_games(since_season, allowed_ids)`: games from `games.csv`.
- **`attach_point_in_time_profiles(games, stats)`**: the point-in-time
  profile logic (`cumulative_profiles` + `attach_pregame_profile`, which uses
  `allow_exact_matches=False`).
- `main()` still writes `matchup_training_data.csv` from 1998 on. It is
  byte-identical (sha256 `58ceb688…`).

`backend/scripts/clean_team_histories.py`: the cutoff is 1985–86. It adds
only the Washington Bullets row, which shares a team id with the Wizards.

`scripts/export_static_site_data.py`:
- `load_era_correct_names()` reads the Extended file and fills older seasons
  from `TeamStatistics.csv`.
- **`attach_identity(profiles)`** adds `key`, `slug`, `era_city` and
  `era_name`, and raises on a duplicate key.
- `load_profiles_with_identity()` = `attach_identity(read profiles CSV)`.

`src/models/test_pregame_leakage.py`:
- `prepare_stats`, `sample_rows`, `check_rows(m, s, rows, means)`,
  `load_older_stats`, `PROFILE_MEANS`, `OLDER_PROFILE_MEANS`.
- It checks `matchup_training_data.csv`, plus
  `data/processed/older_seasons_matchups.csv` when that exists.

`scripts/backtest_older_seasons.py`:
- It regenerates the tables in `reports/older_seasons_backtest.md` below the
  marker, keeping the hand-written summary above it.
- It writes `data/processed/older_seasons_matchups.csv`.
- Its `era_probe_section` / `to_relative` / `neutral_pairs` code is a working
  prototype of the era-relative idea and the cross-era check. Lift from it.

`tests/test_older_seasons.py`: 11 tests (formulas, keys, and the guard
failing on leaked data).

## What must stay byte-identical (duel mode depends on it)

`scripts/generate_duel_pool.py` and `src/models/train_pregame_model.py`
read **`data/processed/matchup_training_data.csv`**.
`build_pregame_features.py` reads `team_histories_cleaned.csv` and the raw
files. Deployment phase 3 uploads the current duel pool, and its puzzle ids
depend on it. So:

| File | sha256 at writing | Rule |
|---|---|---|
| `data/processed/matchup_training_data.csv` | `58ceb688aeeca19c414a75ca03af3e50f7cb627588f58503f9f0d6b8aa40f45d` | **Never change it.** `hist-v2` trains from a new file (Phase A step 3) |
| `data/processed/pregame_team_features.csv` | `a6fa3051f5636cfd15479aaaafc19012803f853c3308799ff42b9f2af155ff97` | Never change it |
| `data/processed/duel_pool/`, `models/pregame/`, `worker/` | | Don't touch. Never run `generate_duel_pool.py`, `build_pregame_features.py` changes, or `train_pregame_model.py` |

Check both hashes at the end of each phase:
`sha256sum data/processed/matchup_training_data.csv data/processed/pregame_team_features.csv`.

This differs from the brief's Session 2 step 2, which said to extend
`MODERN_ERA_START` in `build_matchup_training_data.py`. That would feed the
duel pool and the pre-game trainer 1986–97 games. Record the change in the
F11 handoff record.

---

# Phase A: build `hist-v2` (no site change)

Phase A ends with a built but **not activated** `hist-v2` and an evaluation
report. Activating it before the re-export would make
`verify_static_export.py` and `test_static_export_matches_active_release`
fail (index.json says `hist-v1`). So activation, the re-export and the served
profile CSV all move together in Phase B.

**Phase A writes nothing the served path reads:**

- not `team_season_profiles_extended.csv`;
- not `models/production/ACTIVE_RELEASE`;
- not `frontend/public/data/`;
- not `matchup_training_data.csv`.

All Phase A outputs go to new files.

## A1. Fix the 2022 hole

**What's wrong:** in both `TeamStatisticsExtended.csv` and
`TeamStatistics.csv`, 2,778 of the 2,780 team-game rows of 2021–22 have a
blank `gameType`. Every script drops them, so:

- the profiles hold 2 one-game team-seasons;
- **the live site serves two broken teams: `2022-clippers` (1–0) and
  `2022-lakers` (0–1)**;
- the 2022 champion is missing;
- 2022 can't be the previous-season reference for 2023;
- the matchup data has only 4 games from 2022 (CONTRIBUTING gotcha).

**The data to fix it exists:**

- `data/raw/Games.csv` has a `gameType` for every 2022 game: 1,230 Regular
  Season, 87 Playoffs, 6 Play-in Tournament, and 67 Preseason.
- The game id prefix agrees: `221…` regular season, `421…` playoffs,
  `521…` play-in, `121…`/`122…` preseason.

**Build:**

- Add `fill_missing_game_types(df)` to
  `build_team_season_profiles_extended.py`.
  - It fills a blank `gameType` from `Games.csv` by `gameId`.
  - It raises `ValueError` if a blank row is still blank and its game id
    prefix is 2, 4 or 5.
  - Preseason rows (prefix 1) stay out, as now.
- Make it **opt-in**:
  `load_team_games(since, allowed_ids, fill_game_types=False)`.
  - The hist-v2 path passes `True`.
  - `build_matchup_training_data.main()` keeps the default, so the duel
    file stays byte-identical.
- Blank rows also exist in other seasons (98–196 a year). Check what they
  are. They are probably preseason or All-Star games, so they should stay
  out. Report the counts.
- **Effect to record:**
  - Real 2022 games join the hist-v2 test split (the split is test ≥ 2022,
    and before this fix 2022 had 4 games).
  - The served list grows by about 28 team-seasons in Phase B.
  - `2022-clippers` and `2022-lakers` keep their keys but get full-season
    stats.

## A2. Fix the October 2020 Finals label

Every script uses `month < 10` to assign a season. The 2020 bubble Finals
ran 30 Sept to 11 Oct 2020, so **5 Finals games are labelled season 2021**.

- The 2020 Lakers and Heat lose those games from their playoff profiles.
- The 2021 Lakers and Heat gain them (their 2021 playoff win % includes
  2020 Finals games).

**Build:** in the hist-v2 path only (`load_team_games` when
`fill_game_types=True`, and the hist-v2 game loader), a **playoff or play-in
game takes the season of the calendar year it was played in**. Playoffs never
cross into a new season, so this is safe.

- Do not change `assign_season` for the duel or pre-game scripts.
- Record which served team-seasons change (the 2020 and 2021 Lakers and
  Heat, plus their opponents' rows in those series).

## A3. One definition of "compared with its own league"

Put it in one place, next to `MEAN_STATS`/`PCT_STATS` in
`build_team_season_profiles_extended.py`, as CONTRIBUTING's "Constants"
rule asks. Import it everywhere else.

- **`RELATIVE_STATS`**: the regular-season stats that become z-scores.
  - Start from `CORE_STATS` in `train_model_experiments.py`, **minus the
    three rebound percentages**: `regular_rebound_percentage`,
    `regular_offensive_rebound_percentage` and
    `regular_defensive_rebound_percentage`. They are blank before 1996–97
    (`UNMATCHED_FORMULA_COLS`), so leaving them in would make older teams
    run on imputed medians.
  - That leaves 14:
    - `regular_win_pct`
    - `regular_offensive_rating`, `regular_defensive_rating`,
      `regular_net_rating`
    - `regular_pace`
    - `regular_true_shooting_percentage`,
      `regular_effective_field_goal_percentage`
    - `regular_three_pt_pct`, `regular_ft_pct`
    - `regular_assist_percentage`, `regular_assist_to_turnover_ratio`
    - `regular_team_turnover_percentage`
    - `regular_opponent_effective_field_goal_percentage`,
      `regular_opponent_turnover_percentage`
- **`league_reference(profiles)`** takes full-season profiles
  (`build_season_profiles` output) and returns, per season, the mean and
  standard deviation of each `RELATIVE_STATS` column over that season's
  team-seasons.
- **`add_relative_columns(frame, seasons, reference)`** adds
  `<stat>_z = (value - mean) / std`, looking each row up under `seasons`.
  - `std <= 0` gives NaN.
  - The column names end in `_z` (`regular_net_rating_z`), so
    `parse_base_stats` in `src/models/release.py` already maps
    `home_regular_net_rating_z` and `regular_net_rating_z_diff` to the
    profile column `regular_net_rating_z`.

**Which season a row is compared with:**

| Where | Reference season | Why |
|---|---|---|
| Training rows (real games, point-in-time profiles) | **the previous season** (`season - 1`) | The point-in-time rule: a game may only use a season that had finished. `_build_pool` in `train_model_experiments.py` does the same |
| Served profiles (completed seasons, full-season stats) | **its own season** | A finished season compared with its own league. This is what the Session 1 probe used: 49.9% on matched pairs |

- Build the reference from the **full-season profiles** in both cases. One
  function, one source.
  - `_build_pool` takes each team's last point-in-time row from the matchup
    data instead. Replace that, so training and serving share
    `league_reference` exactly.
- **1986 has no previous season.** Leave 1986 games out of training and
  evaluation; serve 1986 teams with their own-season reference. Say so in
  the report.
- After A1, 2022 has full profiles, so 2023's reference is real. Check that
  2022 holds 30 team-seasons with about 82 games each before trusting it.
- **Playoff stats:** `playoff_offensive_rating`, `playoff_defensive_rating`
  and `playoff_true_shooting_percentage` drift with the era like their
  regular-season versions. Either z-score them against the same season's
  regular-season reference for the matching stat, or leave them out. Don't
  feed them raw. `playoff_win_pct`, `playoff_net_rating`, `made_playoffs`
  and `made_play_in` are era-neutral (their league average doesn't move) and
  can stay raw.
- **The rule for hist-v2 columns:** every column is either a `_z` feature,
  its `_z_diff`, or an era-neutral stat: win %, net rating, point
  differential, the playoff flags, playoff win % and net rating. Add a test
  that fails if the chosen `columns.json` holds a raw drifting stat
  (offensive or defensive rating, pace, TS, eFG, 3P%, FT%, turnover %,
  assist stats, or any raw playoff rating).

## A4. Historical training data (new file)

- Add a builder for **`data/processed/historical_training_data.csv`**,
  1987–2026. Use either a new function and CLI flag in
  `build_matchup_training_data.py` (`--since 1986 --fill-game-types
  --output …`), or a new script. Reuse `load_games`,
  `load_team_games(..., fill_game_types=True)` and
  `attach_point_in_time_profiles` unchanged.
  - Apply the A1 and A2 fixes to the games side too. `games.csv` already
    has 2022 game types; apply the playoff season rule.
  - Skip the pre-game (Elo/form) merge. The hist model doesn't use it, and
    it would pull in duel-side data.
  - Add the `_z` columns with A3's function against the previous season, and
    the `_z_diff` columns. Also add the diffs `train_model_experiments.py`
    builds today (`add_derived_features`).
- `matchup_training_data.csv` must still come out byte-identical from
  `python backend/scripts/build_matchup_training_data.py`.
- **Leakage guard:** extend `src/models/test_pregame_leakage.py` to check
  `historical_training_data.csv` when it exists.
  - Use `check_rows` with `OLDER_PROFILE_MEANS`. The stats come from the
    same `load_team_games(..., fill_game_types=True)`, so 2022 rows can be
    checked.
  - Also check that every `_z` value equals
    `(value - prev_season_mean) / prev_season_std`, recomputed from raw
    full-season profiles of the previous season. A z-score built from the
    game's own season is look-ahead leakage.
  - Add a test that the guard fails when `_z` uses the own season.
  - Once it covers this file, `older_seasons_matchups.csv` is no longer
    needed. Keep the backtest script working anyway.

## A5. Train

- **Point** `src/models/train_model_experiments.py` at the new file: make
  `DATA_PATH` and `EXP_DIR` arguments (`--data`, `--out`). The defaults keep
  today's behaviour.
  - Write hist-v2 artifacts to **`models/experiments/hist_v2/`**.
  - `models/experiments/*.pkl` is git-tracked and is `hist-v1`'s source
    (F01). Don't overwrite it.
- **Use A3's z-scores** instead of `add_era_adjusted_features` /
  `_build_pool`, for the hist-v2 run.
- **Feature sets:** only era-safe sets (A3's rule). Keep the existing names
  where they fit (`era_adjusted_core`, `era_adjusted_diff_only`,
  `minimal_era_adjusted_diff`), plus a set with the era-neutral playoff
  context. Drop `percentile_core` unless it is rebuilt on the same reference
  and stays era-safe.
- **Split:** unchanged. Train is 1987–2018, validation 2019–2021, test
  2022–2026. Choose on validation only; score test once. Record that train
  now starts in 1987 and that test now includes 2022.
- **Fix the model selection:** today the script picks the lowest
  validation log loss across *different dataset filters* (`all_games`,
  `regular_season_only`, `playoffs_only`). Each filter has a different
  validation set, so the numbers can't be compared. Pick with one shared
  yardstick. My recommendation: every candidate is scored on the **same**
  validation games (all 2019–21 games, both teams with 20+ regular-season
  games), whatever it was trained on. Record what you chose.
  - Early-season rows are noisy (a z-score after 3 games), so compare
    training filters too, such as "both teams have 20+ regular-season games"
    or playoffs only. The served profiles are full seasons, so late-season
    and playoff rows resemble what is served.
- **Running it:** training takes 10+ minutes. On Windows, launch it with
  PowerShell `Start-Process` and send the output to a log file
  (CONTRIBUTING gotcha), for example:

  ```powershell
  Start-Process -FilePath python -ArgumentList "src/models/train_model_experiments.py","--data","data/processed/historical_training_data.csv","--out","models/experiments/hist_v2" -RedirectStandardOutput "$env:TEMP\hist_v2_train.log" -RedirectStandardError "$env:TEMP\hist_v2_train.err" -NoNewWindow -PassThru
  ```

## A6. Serving code computes the z-scores

Without this step, the gotcha in CONTRIBUTING ("Some features can't be
served") applies.

- **`src/models/predict_matchup.py`, `_load()`:**
  - After reading `PROFILES_PATH`, add the `_z` columns with A3's function,
    each season against **its own** league.
  - Then `check_profiles(release, profiles.columns)` passes for hist-v2.
    `build_model_input` needs no change: it reads `home_`/`away_` base
    columns by name and computes `_diff`.
- **`scripts/export_static_site_data.py`, `load_profiles_with_identity()`:**
  the same call, before `check_profiles`. `build_base_stat_arrays` reads any
  profile column by name.
- **Keep `PROFILE_SCHEMA_VERSION = "team_season_profiles_extended.v1"`** in
  `src/models/release.py`.
  - The z-scores are computed in memory, so the CSV's columns don't change
    (only its rows).
  - Bumping the version would make `load_release` reject `hist-v1`, and the
    rollback would be gone.
- **`_prediction_mode` in `predict_matchup.py`** warns "trained on playoff
  games only". Make the wording match how hist-v2 was trained.
- `find_team_profile` matches by **current** franchise names
  (`team_city`/`team_name` in the profile CSV are the latest name). So
  `predict_matchup("Washington Wizards", 1990, …)` is how the 1990 Bullets
  are called. `verify_static_export.py` relies on that lookup
  (`load_current_name_lookup`) and keeps working. Don't change it; just
  know it.
- **Tests:**
  - A `predict_matchup` call and an export row must agree for an older,
    cross-era pair (as `test_historical_name_resolves_through_export` does
    for 2005 vs 1999).
  - The z-scores must be the same in both paths.

## A7. Build the release (do not activate)

1. Write `release_info.json` (gitignored is fine; keep a copy in the
   report). It holds `purpose: "historical_entertainment"`, `description`,
   `limitations` (list), `trainedThroughSeason: 2018`, `source`, and
   `metrics`.
   - `metrics` holds `publicAccuracyClaim: null` plus the honest
     point-in-time numbers below.
   - The limitations should say:
     - each team is compared with its own season's league;
     - seasons before 1996–97 use stats computed from the box score;
     - rebound percentages are not used;
     - the neutral-court and cross-era wording from `hist-v1`'s manifest
       still applies.
2. `python scripts/promote_release.py --build hist-v2 --from models/experiments/hist_v2 --info release_info.json`
3. `python scripts/promote_release.py --list`: `hist-v2` valid; `hist-v1`
   still active.
4. Add release tests: hist-v2 loads, its columns pass A3's era-safe rule,
   and `hist-v1` still loads and is still active. Leave
   `test_active_release_is_hist_v1_and_valid` and the smoke tests alone
   until Phase B.

## A8. The evaluation report: `reports/hist_v2_evaluation.md`

The owner decides on this report. Give each number for `hist-v2` and for
`hist-v1`, scored on the same point-in-time games.
`score()`/`metric_row()`/`calibration_table()` in
`scripts/backtest_older_seasons.py` already do this; reuse them or move
them into a shared module.

- **Test, 2022–2026:** accuracy, log loss, Brier, ROC-AUC, overall and
  split by regular season and playoffs. Also show "home team wins" and
  "better record wins" as baselines.
- **Validation, 2019–2021:** the same numbers.
- **By season**, 1987–2026.
- **Calibration** tables, test seasons.
- **The cross-era check:** every 1987–97 team against every 2022–26 team,
  neutral court as the export computes it. Show the mean P(older team wins)
  and the matched-quality pairs (season net ratings within 1 point), which
  should come out near 50%. Lift `era_probe_section`/`neutral_pairs` from the
  backtest script.
- **Before and after**, neutral-court P(team A wins), `hist-v1` (served
  today) against `hist-v2`, for at least these pairs:
  - `1998-bulls` vs `2017-warriors` (73.8% today);
  - `1998-jazz` vs `2016-cavaliers`;
  - the curated Champions Bracket entrants
    (`frontend/src/data/curated-tournaments.ts`), as a table;
  - new pairs: `1996-bulls` vs `2017-warriors`, `1986-celtics` vs
    `2008-celtics`, `1989-pistons` vs `2004-pistons`, `1987-lakers` vs
    `2001-lakers`.
- **The top 10 and bottom 10 team-seasons** by mean neutral win probability
  against all others. A sanity check: the 1996 Bulls should be near the
  top, and expansion teams near the bottom.
- **The margin regressor's** test mean absolute error.
- **Which columns the model uses** and their weights (from
  `feature_coefficients.csv`). Say plainly if one feature dominates, as
  `playoff_win_pct_diff` did in `hist-v1`.

Write the report's summary in plain words first, with the decision the owner
has to make.

## A9. Finish Phase A

- Run the full verify list (below). Every check passes, because nothing
  served changed and `hist-v1` is still active.
- Check the two duel hashes are unchanged.
- Fill in the **Session 2 handoff record** in
  `docs/product/features/F11-older-seasons.md`:
  - what changed;
  - the hist-v2 and hist-v1 numbers side by side;
  - where you departed from the plan: the training file, the 2022 and 2020
    fixes, and the selection fix.
- Update the memory note if this repo keeps one.
- Commit and push `f11-older-seasons`.

### STOP: the owner reviews the numbers

Show the owner the plain-words summary and these options:

1. **Go ahead:** Phase B serves `hist-v2`.
2. **Adjust:** retrain with a stated change.
3. **Keep `hist-v1`:** serve the older teams through `hist-v1` (Session 1
   showed it is no less honest for them), and leave `hist-v2` built but
   inactive.

Also ask whether to publish an accuracy number (`publicAccuracyClaim`). The
default is no. **Do not start Phase B without an answer.**

---

# Phase B: the site shows the older seasons

## B1. Served profiles

- Change the default of `build_team_season_profiles_extended.py` to serve
  from 1986 with the A1/A2 fixes:
  `load_team_games(OLDER_ERA_START + 1, ids, fill_game_types=True)`.
  - Update the docstring and the `--since` help text.
  - **Only this script's default changes.** `build_matchup_training_data.py`
    and `build_pregame_features.py` keep 1998.
- Run it. Expect about 1,177 team-seasons:
  - 314 from 1986–97;
  - about 863 from 1998–2026, now including all 30 from 2022.

  Check the exact count and record it.
- `python scripts/promote_release.py --activate hist-v2` (or `hist-v1` if
  the owner chose option 3).

## B2. Re-export and verify

- `python scripts/export_static_site_data.py`, then
  `python scripts/verify_static_export.py`. It must pass 200/200.
- **Size:** about 1,177 × 1,176 ≈ 1.38M ordered pairs, roughly 1.7× today's
  696,390, and about 1.7–2× today's 27 MB in
  `frontend/public/data/teams/`. Measure and record:
  - the total size;
  - the largest team file (the Pages limit is 25 MiB per file and 20,000
    files);
  - the page weight of a matchup page (a matchup page loads one team file).
- `index.json` gains `release.version = "hist-v2"`; `/about` shows it.

## B3. Frontend

| File | Change |
|---|---|
| `frontend/src/lib/search.ts` | `MIN_SEASON = 1998` → `1986`. Check the two-digit year parsing (`as1900`/`as2000`): "96 bulls" must now find 1996, and "86" must find 1986 |
| `frontend/src/pages/HomePage.tsx` | The "835 team-seasons since 1998" line uses the real count and "since 1986" (better: read the count from `index.json`). Add at least one older headline matchup, such as `["1996-bulls", "2017-warriors"]`. The "Sixteen title teams since 1998" copy follows the Champions Bracket decision |
| `frontend/src/pages/AboutPage.tsx` | "any two seasons since 1998" → 1986. Add copy on older eras: each team is judged against its own season's league; stats before 1996–97 come from the box score; few threes were taken before the mid-1990s; the three-point line moved in 1994–97. Keep the neutral-court and limitation wording. Check the "A 1998 …" example sentence |
| `frontend/src/data/curated-tournaments.ts` | **Ask the owner the Champions Bracket question.** Option 1: keep "16 champions since 1998". The 2022 Warriors now exist, so the "2022 champion is missing" note goes, and the owner chooses whether they enter the 16. Option 2: add a separate 1986–97 champions bracket (Celtics 1986, Lakers 1987, Lakers 1988, Pistons 1989, Pistons 1990, Bulls 1991, Bulls 1992, Bulls 1993, Rockets 1994, Rockets 1995, Bulls 1996, Bulls 1997) as a new curated tournament. Existing shared bracket links must keep decoding either way |
| `frontend/src/data/team-colors.ts` | Add `Bullets` (colours are off behind `TEAM_COLORS_APPROVED = false`; add the entry so the map is complete) |
| `frontend/src/lib/margin.ts` | The comment cites hist-v1's typical margin error. Update it from hist-v2's regressor numbers |
| `frontend/src/duel/*`, `DuelHomePage.tsx`, `DuelJoinPage.tsx`, `lib/duelFormat.ts` | **Leave alone.** Duel mode stays 1998–2026 |

## B4. Stability tests (the brief's Session 3 step 3)

Add these to `frontend/` (Vitest and/or Playwright) or to `tests/`.

- Every key in the **pre-F11** `index.json` still exists. Snapshot the old
  key list into a fixture from `git show main:frontend/public/data/index.json`
  before re-exporting.
- A sample of existing matchup URLs still resolve, for example
  `/1998-bulls-vs-2017-warriors` and `/2005-supersonics-vs-1999-grizzlies`.
- An existing shared tournament link (format `t1.<bestOf>.<seed>.<key>~…`,
  `frontend/src/tournament/serialize.ts`) still decodes and replays.
  - Keys are the identity, so adding teams doesn't break decoding.
  - **The replayed results change** when probabilities change. Tell the
    owner, and record one example link with its winner before and after.
- `tests/test_release_integrity.py`:
  - `test_active_release_is_hist_v1_and_valid` becomes a hist-v2 test, with
    a separate test that hist-v1 still loads (the rollback).
  - The smoke matchups assert `model_release` and `model_feature_count`
    from the active manifest, not hard-coded `"hist-v1"`/`70`.
  - Add 1986–97 smoke cases: an older playoff team, an older non-playoff
    team, a historical name (1990 Washington, served as the Bullets), and a
    cross-era 1996 vs 2017 pair.

## B5. Docs

- `docs/product/features/F11-older-seasons.md`: status, plus the Session 3
  handoff record:
  - before and after examples;
  - export size;
  - the Champions Bracket decision;
  - test counts.
- `docs/product/HANDOFF.md`: the F11 status, and the frontend and worker
  test counts.
- `CONTRIBUTING.md`:
  - the opening line ("public box-score data (1998 onward)") becomes 1986
    for the simulator;
  - the pipeline gains the historical training data step and the hist-v2
    training command;
  - the 2022 gotcha now says it is fixed for the simulator but still
    missing in `matchup_training_data.csv` (duel and pre-game);
  - the "No public accuracy for `hist-v1`" gotcha is updated.
- `docs/frontend-handoff.md` if it states 1998 or 835.

## B6. Verify, PR, stop

- Run the full verify list. Check the duel hashes.
- Open the PR from `f11-older-seasons` to `main`
  (`gh pr create --base main`). The body ends with the attribution lines in
  the session's instructions.
  - Summarise the before and after probabilities.
  - Say that shared tournament replays change.
  - Name the two 2022 teams whose stats got fixed.
- The Cloudflare Pages preview link appears on the PR. **The owner reviews
  the preview.**
- **STOP. Merge only when the owner says so**
  (`gh pr merge <n> --merge`). The merge deploys `courtofalltime.win` at
  once. After the merge, check the live site loads `/`, a matchup, an older
  matchup (`/1996-bulls-vs-2017-warriors`), `/about` and `/tournament`.

---

## How to verify (every phase)

```
cd frontend && npm run build && npm run lint && npm test && npx playwright test
cd worker && npx tsc --noEmit && npm test
python -m pytest tests
python src/models/test_pregame_leakage.py        # must exit 0
python scripts/verify_static_export.py           # must pass
python -m pytest tests/test_release_integrity.py
sha256sum data/processed/matchup_training_data.csv data/processed/pregame_team_features.csv
```

Baseline at the start (2026-09-30):

- frontend: 146 unit and 48 Playwright tests;
- worker: 123 tests;
- `pytest tests`: 51;
- release integrity: 23;
- the leakage guard checks 350 + 350 games with 0 mismatches;
- the export verifier passes 200/200.

The data scripts need `data/raw/` (gitignored). It is on the owner's
machine; elsewhere run `backend/scripts/import_dataset.py` first.

## Gotchas

- **Encoding:** open every file with `encoding="utf-8"` (cp1252 once
  truncated a source file). In Git Bash, a heredoc holding Python with
  quotes and backticks can fail to parse. Write patch scripts to a file
  first.
- **Mixed date formats:** parse `gameDateTimeEst` with
  `format="mixed"`.
- **Season numbers** are the year a season ends.
- **Lockout and short seasons:** 1998–99 (50 games), 2019–20 and 2020–21
  were short. Rates handle this; totals don't.
- **Three-point stats before the mid-1990s:** few attempts, so three-point
  percentage is noisy. The line moved in from 1994–95 to 1996–97, which is
  why 3PA rate jumps in 1995 and falls in 1998
  (`reports/older_seasons_backtest.md`, Era drift).
- **`TeamStatistics.csv` stores 0, not blank,** for `plusMinusPoints` and
  situational points before 1996–97. `load_team_games` already handles
  this; don't read those columns raw.
- **Expansion teams:** Charlotte and Miami from 1989, Minnesota and Orlando
  from 1990, Toronto and Vancouver from 1996. Their first seasons have few
  wins and very low z-scores; that is real.
- **Releases are immutable.** If `hist-v2` needs a change after it is
  built, build `hist-v3`; never edit a built release.
- **Never pass `--no-verify`.** Never force-push.

## Kickoff prompts

Phase A:

```text
Implement F11 Phase A from docs/product/features/F11-continuation-handoff.md
on the branch f11-older-seasons. Read every file in its "Read first" list in
full. Then do steps A1-A9: fix the 2022 game types and the October 2020
Finals labels in the hist-v2 path, build the one shared "compared with its
own league" (z-score) definition, write historical_training_data.csv and
extend the leakage guard to it, train hist-v2 on era-safe features, make
predict_matchup and the export compute the z-scores, build (do not
activate) hist-v2, and write reports/hist_v2_evaluation.md. Keep
matchup_training_data.csv and pregame_team_features.csv byte-identical and
do not touch duel mode. Run the verify list, fill in the Session 2 record,
commit, and push. Then stop and ask me to review the numbers.
```

Phase B (only after the owner approves the Phase A numbers):

```text
Implement F11 Phase B from docs/product/features/F11-continuation-handoff.md
on f11-older-seasons. Read the "Read first" list, the Session 2 record and
my Phase A decision. Serve profiles from 1986, activate the release I chose,
re-export and verify, update the frontend's 1998 references and copy, ask
me the Champions Bracket question, add the URL and tournament-link
stability tests, record before-and-after examples, update the docs, run the
verify list, fill in the Session 3 record, push, and open the PR. Do not
merge until I approve the Pages preview.
```
