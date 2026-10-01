# Older seasons backtest (F11 Session 1)

Can the served simulator score the 1985–86 to 1996–97 teams honestly, and do
older teams need era-relative inputs? Measured 2026-09-30 on branch
`f11-older-seasons`. Nothing served changed: `frontend/public/data/`,
`models/releases/`, `team_season_profiles_extended.csv` and
`matchup_training_data.csv` are byte-identical to before this session.

Season numbers are the year a season ends (1986 = 1985–86).

## Summary

1. **The advanced stats can be rebuilt from the basic box score, except
   rebound percentages.** Where both exist (1996–97 onward), every
   rating, pace, shooting, assist and turnover formula is within 14% of the
   gap between an average and a good team, most within 8%. Offensive rating
   is off by 0.29 points on average, net rating by 0.13, and true shooting
   and eFG% are exact. Possessions use the standard estimate, scaled by
   0.985 to match the NBA's own counts; the scale was fit on 1997–2010 and
   holds on 2011–2026. **Offensive, defensive and total rebound
   percentage (and opponent offensive rebound %) are not usable.** The
   NBA's values are not a fixed function of the box score: the plain formula
   runs 0.028 low in 1997 and 0.045 low by 2026. They are left blank for
   seasons before 1996–97 (`UNMATCHED_FORMULA_COLS`).
2. **Every 1986–97 team-season has a unique, era-correct key.** There are
   314 of them (1,149 from 1986 to 2026), for example `1986-celtics`,
   `1990-bullets` and `1996-supersonics`. Every key the site serves today
   is unchanged.
3. **`hist-v1` does no worse on 1986–97 than on its own test seasons.**
   It never trained on them. Log loss is 0.682 for 1986–97, against 0.721
   on its validation seasons and 0.711 on its test seasons. In the playoffs
   it is 0.949 against 0.972. But that is because `hist-v1` is weak
   everywhere when scored honestly. It was trained on leaky full-season
   playoff features, and its classifier now reads almost nothing but
   `playoff_win_pct_diff` (coefficient 1.19; every other weight is 0.15 or
   less, and all ratings, pace and shooting are 0). On real games it barely
   beats "home team wins" and loses to "the better record wins" (65.5% in
   1986–97, 63.2% in 2022–26). Its playoff probabilities are overconfident
   in both eras. Rebuilding 1996–97 with the formulas instead of the NBA's
   values changes its probabilities by 0.01 points on average, with no
   picks flipped.
4. **Raw ratings drift a long way between eras.** League offensive rating
   was 105–108 in 1986–97 and is 114.7 in 2022–26, about 1.6 times the gap
   between an average and a good team. True shooting went from .53–.54 to
   .58, three-point attempt rate from .04–.21 to .39, and pace from 92–103
   to 99.
5. **Raw inputs tilt cross-era matchups against older teams; era-relative
   inputs do not.** Two probe models (not releases) were trained alike on
   1998–2018 games, one on raw inputs and one on league-relative z-scores.
   Pairs of an older and a modern team with season net ratings within 1
   point should come out near 50%. The raw-input probe gives the older team
   46.4%, the relative probe 49.9%, and `hist-v1` 52.3%. On real games the
   two probes score the same: 69.6% against 69.4% accuracy (log loss 0.582
   against 0.584) in 1987–97, and log loss 0.623 against 0.627 in 2024–26.
6. **The 2022 season breaks a previous-season reference for 2023.** Its
   profiles hold 2 team-seasons of 1 game each (the known `gameType` gap).
   That is why the relative probe scores worse on 2022–26 (0.667) than on
   2024–26. Session 2 must handle it (see below).

## Recommendation: era-relative inputs for `hist-v2`

Serve 1986–97 through a `hist-v2` trained on **era-relative inputs**: each
team's stats as a z-score against its league. Do not train a new model on
raw ratings across 1986–2026.

- A raw-input model judges an older team by a scale that moved. The probe
  shows the result: about a 3.6-point tilt against older teams in
  evenly matched pairs. Real-game backtests cannot catch this, because both
  teams in a real game come from the same season.
- Era-relative inputs remove the tilt and cost nothing measurable on real
  games.
- `train_model_experiments.py` already builds `_z` features against the
  previous season (`_build_pool`). The point-in-time retrain that is the
  `hist-v2` candidate already selects them.

What Session 2 has to settle if the owner agrees:

- **The served reference.** Training normalises a game against the
  previous season, which the point-in-time rule requires. For a completed
  season's served profile, I recommend normalising against that season's
  own league (all its team-seasons, full season). Both mean "relative to
  the league of the time". The probe used exactly this split, and it gave
  49.9% on matched pairs. Compute the z-scores in `predict_matchup.py` and
  the export from one shared function, so training and serving cannot drift
  apart.
- **The 2022 hole.** Either restore the 2022 rows that have no `gameType`,
  or let 2023 fall back to 2021 as its reference. Record either way whether
  the test split changes.
- **Rebound percentages.** Leave them out of `hist-v2`. The other option is
  to recompute them from the box score for every season, training
  included, so that one definition holds throughout.
- **The alternative** is to keep `hist-v1` and serve 1986–97 through it as
  it is. The backtest says that is no less honest for older teams than for
  modern ones, and its cross-era tilt is small (52.3%). But `hist-v1` is in
  effect a ranking by playoff win percentage, with probabilities that are
  too confident. Replacing it was already the plan.

**Owner decision needed:** era-relative inputs (recommended) or the
current raw feature set for `hist-v2`.

<!-- Everything below is generated by scripts/backtest_older_seasons.py -->

## Formula validation

Possessions per team-game against the NBA's count (error = estimate - NBA). Fit period: seasons 1997-2010; held-out: 2011 on.

| Possession estimate | Bias, fit seasons | Bias, held-out | Mean abs. error, held-out |
|---|---|---|---|
| Standard formula (scale 1.0) | 1.29 | 1.58 | 1.80 |
| Fitted on 1997-2010 (scale 0.9863) | -0.00 | 0.22 | 1.22 |
| As used (POSSESSION_SCALE 0.985) | -0.12 | 0.09 | 1.22 |

Per team-season averages, 1997-2026, formula minus NBA value. "Avg-to-good gap" is the distance between the 50th and 80th percentile team-season (20th and 50th where lower is better). A stat is usable when its mean absolute error is under 25% of that gap. Stats marked **no** are left blank for seasons before 1996-97 (`UNMATCHED_FORMULA_COLS`).

| Profile stat | Team-seasons | NBA mean | Bias | Mean abs. error | Max abs. error | Avg-to-good gap | Error / gap | Usable |
|---|---|---|---|---|---|---|---|---|
| regular_point_diff_per_game | 864 | -0.006 | 0.000 | 0.002 | 0.195 | 3.846 | 0% | yes |
| regular_possessions_per_game | 864 | 95.620 | -0.013 | 0.260 | 1.451 | 4.392 | 6% | yes |
| regular_pace | 864 | 94.943 | -0.014 | 0.254 | 1.451 | 4.441 | 6% | yes |
| regular_offensive_rating | 864 | 106.628 | 0.017 | 0.294 | 1.753 | 4.835 | 6% | yes |
| playoff_offensive_rating | 464 | 104.987 | -0.075 | 0.717 | 3.756 | 5.515 | 13% | yes |
| regular_defensive_rating | 864 | 106.635 | 0.017 | 0.297 | 1.753 | 3.895 | 8% | yes |
| playoff_defensive_rating | 464 | 107.792 | -0.043 | 0.749 | 3.972 | 5.509 | 14% | yes |
| regular_net_rating | 864 | -0.006 | 0.001 | 0.133 | 0.622 | 3.949 | 3% | yes |
| playoff_net_rating | 464 | -2.804 | -0.032 | 0.370 | 2.061 | 4.744 | 8% | yes |
| regular_assist_percentage | 864 | 0.596 | -0.000 | 0.000 | 0.004 | 0.037 | 0% | yes |
| regular_assist_to_turnover_ratio | 864 | 1.714 | 0.009 | 0.010 | 0.255 | 0.251 | 4% | yes |
| regular_assist_ratio | 864 | 17.055 | 0.146 | 0.146 | 0.401 | 1.210 | 12% | yes |
| regular_offensive_rebound_percentage | 864 | 0.299 | -0.037 | 0.037 | 0.058 | 0.026 | 144% | **no** |
| regular_defensive_rebound_percentage | 864 | 0.701 | 0.038 | 0.038 | 0.055 | 0.023 | 165% | **no** |
| regular_rebound_percentage | 864 | 0.500 | 0.000 | 0.003 | 0.014 | 0.012 | 28% | **no** |
| regular_team_turnover_percentage | 864 | 0.152 | -0.001 | 0.001 | 0.013 | 0.011 | 8% | yes |
| regular_effective_field_goal_percentage | 864 | 0.504 | -0.000 | 0.000 | 0.001 | 0.031 | 0% | yes |
| regular_true_shooting_percentage | 864 | 0.544 | -0.000 | 0.000 | 0.008 | 0.028 | 0% | yes |
| playoff_true_shooting_percentage | 464 | 0.533 | -0.000 | 0.000 | 0.001 | 0.026 | 0% | yes |
| regular_opponent_effective_field_goal_percentage | 864 | 0.504 | -0.000 | 0.000 | 0.000 | 0.023 | 0% | yes |
| regular_opponent_free_throw_attempt_rate | 864 | 0.292 | -0.000 | 0.000 | 0.000 | 0.032 | 0% | yes |
| regular_opponent_turnover_percentage | 864 | 0.152 | -0.001 | 0.001 | 0.010 | 0.013 | 7% | yes |
| regular_opponent_offensive_rebound_percentage | 864 | 0.299 | -0.038 | 0.038 | 0.055 | 0.023 | 165% | **no** |

## Identity

314 team-seasons from 1986 to 1997; 1149 from 1986 to 2026, every key unique. Keys for seasons the export already serves are unchanged (names still come from TeamStatisticsExtended.csv wherever it has the season).

| Era-correct name | Seasons | Team-seasons | First key |
|---|---|---|---|
| Atlanta Hawks | 1986-1997 | 12 | 1986-hawks |
| Boston Celtics | 1986-1997 | 12 | 1986-celtics |
| Charlotte Hornets | 1989-1997 | 9 | 1989-hornets |
| Chicago Bulls | 1986-1997 | 12 | 1986-bulls |
| Cleveland Cavaliers | 1986-1997 | 12 | 1986-cavaliers |
| Dallas Mavericks | 1986-1997 | 12 | 1986-mavericks |
| Denver Nuggets | 1986-1997 | 12 | 1986-nuggets |
| Detroit Pistons | 1986-1997 | 12 | 1986-pistons |
| Golden State Warriors | 1986-1997 | 12 | 1986-warriors |
| Houston Rockets | 1986-1997 | 12 | 1986-rockets |
| Indiana Pacers | 1986-1997 | 12 | 1986-pacers |
| Los Angeles Clippers | 1986-1997 | 12 | 1986-clippers |
| Los Angeles Lakers | 1986-1997 | 12 | 1986-lakers |
| Miami Heat | 1989-1997 | 9 | 1989-heat |
| Milwaukee Bucks | 1986-1997 | 12 | 1986-bucks |
| Minnesota Timberwolves | 1990-1997 | 8 | 1990-timberwolves |
| New Jersey Nets | 1986-1997 | 12 | 1986-nets |
| New York Knicks | 1986-1997 | 12 | 1986-knicks |
| Orlando Magic | 1990-1997 | 8 | 1990-magic |
| Philadelphia 76ers | 1986-1997 | 12 | 1986-76ers |
| Phoenix Suns | 1986-1997 | 12 | 1986-suns |
| Portland Trail Blazers | 1986-1997 | 12 | 1986-trail-blazers |
| Sacramento Kings | 1986-1997 | 12 | 1986-kings |
| San Antonio Spurs | 1986-1997 | 12 | 1986-spurs |
| Seattle SuperSonics | 1986-1997 | 12 | 1986-supersonics |
| Toronto Raptors | 1996-1997 | 2 | 1996-raptors |
| Utah Jazz | 1986-1997 | 12 | 1986-jazz |
| Vancouver Grizzlies | 1996-1997 | 2 | 1996-grizzlies |
| Washington Bullets | 1986-1997 | 12 | 1986-bullets |

## Backtest of `hist-v1`

Release scored: `hist-v1` (70 columns, trained on playoff games through 2018). Each game is scored with the real home and away sides, from point-in-time profiles: only games that tipped off earlier that season, ordered by `gameDateTimeEst`, exactly as `build_matchup_training_data.py` builds them. A game is scored when both teams have played at least one regular-season game that season (171 opening games dropped in 1986-1997, 1,078 from 1998 on). "Better record wins" picks the team with the higher season-to-date win percentage (home team on a tie); it is a baseline, not the model.

The 1998-2018 rows are the seasons `hist-v1` trained on, with leaky features at the time, so they flatter it and are shown only for reference. The honest comparison for 1986-1997 is the validation and test seasons.

### Summary

| Games | n | Accuracy | Log loss | Brier | Home team wins | Better record wins |
|---|---|---|---|---|---|---|
| 1986-1997 (never trained on) | 13,563 | 63.0% | 0.6815 | 0.2386 | 63.5% | 65.5% |
| 1998-2018 (training seasons) | 25,574 | 59.7% | 0.6952 | 0.2447 | 60.1% | 64.3% |
| 2019-2021 (validation seasons) | 3,573 | 56.5% | 0.7211 | 0.2546 | 56.2% | 63.4% |
| 2022-2026 (test seasons) | 5,148 | 55.9% | 0.7108 | 0.2523 | 55.7% | 63.2% |

### Regular season and playoffs

| Games | n | Accuracy | Log loss | Brier | Home team wins | Better record wins |
|---|---|---|---|---|---|---|
| 1986-1997 (never trained on), regular season | 12,703 | 63.2% | 0.6634 | 0.2352 | 63.2% | 65.6% |
| 1986-1997 (never trained on), playoffs | 860 | 60.6% | 0.9487 | 0.2883 | 67.3% | 63.1% |
| 1986-1997 (never trained on), regular season after 20 games | 9,625 | 63.3% | 0.6626 | 0.2348 | 63.3% | 66.9% |
| 1998-2018 (training seasons), regular season | 23,878 | 59.8% | 0.6757 | 0.2413 | 59.8% | 64.4% |
| 1998-2018 (training seasons), playoffs | 1,696 | 58.4% | 0.9704 | 0.2927 | 64.6% | 63.1% |
| 1998-2018 (training seasons), regular season after 20 games | 17,825 | 59.9% | 0.6750 | 0.2409 | 59.9% | 64.9% |
| 2019-2021 (validation seasons), regular season | 3,321 | 56.5% | 0.7044 | 0.2518 | 56.3% | 63.2% |
| 2019-2021 (validation seasons), playoffs | 245 | 54.3% | 0.9536 | 0.2946 | 53.9% | 64.9% |
| 2019-2021 (validation seasons), regular season after 20 games | 2,441 | 56.2% | 0.7059 | 0.2525 | 56.1% | 64.9% |
| 2022-2026 (test seasons), regular season | 4,789 | 55.5% | 0.6928 | 0.2497 | 55.5% | 63.5% |
| 2022-2026 (test seasons), playoffs | 335 | 60.6% | 0.9722 | 0.2904 | 57.6% | 58.5% |
| 2022-2026 (test seasons), regular season after 20 games | 3,679 | 54.5% | 0.6970 | 0.2518 | 54.5% | 64.7% |

### By season

| Season | n | Playoff games | Accuracy | Log loss | Brier | Home team wins | Better record wins |
|---|---|---|---|---|---|---|---|
| 1986 | 999 | 68 | 65.7% | 0.6713 | 0.2338 | 65.9% | 63.6% |
| 1987 | 1,001 | 71 | 65.9% | 0.6767 | 0.2350 | 66.7% | 63.5% |
| 1988 | 1,011 | 80 | 65.9% | 0.6795 | 0.2345 | 67.9% | 64.4% |
| 1989 | 1,072 | 62 | 68.1% | 0.6490 | 0.2257 | 67.3% | 66.5% |
| 1990 | 1,164 | 72 | 64.2% | 0.6768 | 0.2365 | 65.1% | 65.4% |
| 1991 | 1,161 | 68 | 65.9% | 0.6690 | 0.2328 | 65.7% | 63.7% |
| 1992 | 1,165 | 73 | 62.8% | 0.6781 | 0.2374 | 63.8% | 64.5% |
| 1993 | 1,167 | 76 | 61.0% | 0.6949 | 0.2433 | 61.6% | 64.5% |
| 1994 | 1,170 | 77 | 60.5% | 0.6916 | 0.2437 | 61.7% | 66.1% |
| 1995 | 1,165 | 73 | 59.4% | 0.6965 | 0.2456 | 59.5% | 65.3% |
| 1996 | 1,242 | 68 | 60.4% | 0.6880 | 0.2425 | 60.7% | 67.6% |
| 1997 | 1,246 | 72 | 58.3% | 0.6996 | 0.2485 | 58.3% | 69.7% |
| 1998 | 1,245 | 71 | 59.7% | 0.6975 | 0.2452 | 59.9% | 68.6% |
| 1999 | 774 | 66 | 62.8% | 0.6889 | 0.2386 | 62.3% | 63.7% |
| 2000 | 1,249 | 75 | 60.6% | 0.6897 | 0.2425 | 61.8% | 64.4% |
| 2001 | 643 | 71 | 60.8% | 0.6991 | 0.2424 | 61.3% | 64.5% |
| 2002 | 1,243 | 71 | 58.7% | 0.6993 | 0.2469 | 59.0% | 63.3% |
| 2003 | 1,260 | 88 | 61.9% | 0.6951 | 0.2425 | 62.6% | 62.7% |
| 2004 | 1,254 | 82 | 61.2% | 0.6810 | 0.2396 | 62.0% | 62.9% |
| 2005 | 1,296 | 84 | 60.4% | 0.6887 | 0.2424 | 60.2% | 64.1% |
| 2006 | 1,301 | 89 | 60.4% | 0.6954 | 0.2443 | 60.9% | 62.0% |
| 2007 | 1,292 | 79 | 59.4% | 0.6906 | 0.2441 | 59.6% | 61.5% |
| 2008 | 1,297 | 86 | 59.8% | 0.6968 | 0.2452 | 61.0% | 65.6% |
| 2009 | 1,298 | 85 | 60.6% | 0.6954 | 0.2444 | 61.3% | 65.9% |
| 2010 | 1,294 | 82 | 59.1% | 0.6980 | 0.2459 | 59.7% | 64.1% |
| 2011 | 1,294 | 81 | 60.2% | 0.6907 | 0.2425 | 60.7% | 65.4% |
| 2012 | 1,056 | 84 | 58.5% | 0.7044 | 0.2483 | 59.5% | 63.0% |
| 2013 | 1,294 | 85 | 61.4% | 0.6879 | 0.2413 | 61.3% | 65.1% |
| 2014 | 1,302 | 89 | 56.9% | 0.7143 | 0.2530 | 57.5% | 65.3% |
| 2015 | 1,294 | 81 | 57.8% | 0.6963 | 0.2472 | 57.4% | 67.0% |
| 2016 | 1,299 | 86 | 59.0% | 0.6952 | 0.2456 | 59.6% | 66.1% |
| 2017 | 1,293 | 79 | 58.8% | 0.6932 | 0.2450 | 58.3% | 61.4% |
| 2018 | 1,296 | 82 | 57.9% | 0.7024 | 0.2481 | 58.6% | 63.7% |
| 2019 | 1,296 | 82 | 58.6% | 0.6943 | 0.2452 | 59.0% | 63.7% |
| 2020 | 1,122 | 78 | 55.6% | 0.7076 | 0.2518 | 54.6% | 64.1% |
| 2021 | 1,155 | 85 | 54.8% | 0.7641 | 0.2678 | 54.6% | 62.3% |
| 2022 | 2 | 0 | 50.0% | 0.7665 | 0.2847 | 50.0% | 100.0% |
| 2023 | 1,304 | 84 | 58.1% | 0.7016 | 0.2475 | 58.1% | 58.9% |
| 2024 | 1,237 | 82 | 54.8% | 0.7147 | 0.2545 | 54.5% | 63.0% |
| 2025 | 1,300 | 84 | 54.9% | 0.7141 | 0.2545 | 54.8% | 64.1% |
| 2026 | 1,305 | 85 | 55.8% | 0.7130 | 0.2527 | 55.4% | 66.6% |

### Calibration

**1986-1997**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 96 | 2.2% | 52.1% |
| 0.1-0.2 | 87 | 16.5% | 49.4% |
| 0.2-0.3 | 62 | 25.0% | 56.5% |
| 0.3-0.4 | 56 | 35.1% | 71.4% |
| 0.4-0.5 | 110 | 45.9% | 64.5% |
| 0.5-0.6 | 6,113 | 58.3% | 66.7% |
| 0.6-0.7 | 6,823 | 61.4% | 60.7% |
| 0.7-0.8 | 62 | 74.9% | 77.4% |
| 0.8-0.9 | 62 | 84.2% | 66.1% |
| 0.9-1.0 | 92 | 98.4% | 71.7% |

**2022-2026 (test)**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 42 | 2.8% | 52.4% |
| 0.1-0.2 | 24 | 17.4% | 29.2% |
| 0.2-0.3 | 33 | 25.8% | 48.5% |
| 0.3-0.4 | 24 | 35.2% | 41.7% |
| 0.4-0.5 | 21 | 45.0% | 57.1% |
| 0.5-0.6 | 1,526 | 59.3% | 60.7% |
| 0.6-0.7 | 3,398 | 60.7% | 53.8% |
| 0.7-0.8 | 23 | 73.8% | 52.2% |
| 0.8-0.9 | 20 | 83.8% | 65.0% |
| 0.9-1.0 | 37 | 96.8% | 62.2% |

**1986-1997 playoffs**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 96 | 2.2% | 52.1% |
| 0.1-0.2 | 87 | 16.5% | 49.4% |
| 0.2-0.3 | 62 | 25.0% | 56.5% |
| 0.3-0.4 | 56 | 35.1% | 71.4% |
| 0.4-0.5 | 83 | 44.8% | 63.9% |
| 0.5-0.6 | 174 | 55.1% | 75.9% |
| 0.6-0.7 | 101 | 63.4% | 81.2% |
| 0.7-0.8 | 47 | 74.7% | 78.7% |
| 0.8-0.9 | 62 | 84.2% | 66.1% |
| 0.9-1.0 | 92 | 98.4% | 71.7% |

**2022-2026 playoffs**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 42 | 2.8% | 52.4% |
| 0.1-0.2 | 24 | 17.4% | 29.2% |
| 0.2-0.3 | 33 | 25.8% | 48.5% |
| 0.3-0.4 | 24 | 35.2% | 41.7% |
| 0.4-0.5 | 21 | 45.0% | 57.1% |
| 0.5-0.6 | 55 | 53.7% | 67.3% |
| 0.6-0.7 | 56 | 63.4% | 73.2% |
| 0.7-0.8 | 23 | 73.8% | 52.2% |
| 0.8-0.9 | 20 | 83.8% | 65.0% |
| 0.9-1.0 | 37 | 96.8% | 62.2% |

### 1996-97 with the NBA's values versus the box-score formulas

1996-97 is the one season that is both out of sample and covered by the NBA's own advanced values, so it shows what the formulas alone do to the model's output. Same 1,246 games, same model, profiles built from each source (rebound percentages left blank in the formula version, as they are for older seasons).

| Games | n | Accuracy | Log loss | Brier | Home team wins | Better record wins |
|---|---|---|---|---|---|---|
| 1996-97, NBA values | 1,246 | 58.3% | 0.6996 | 0.2485 | 58.3% | 69.7% |
| 1996-97, box-score formulas | 1,246 | 58.3% | 0.6996 | 0.2485 | 58.3% | 69.7% |

Mean absolute change in the home-win probability: 0.01 points (max 0.08). Picks that flip: 0 of 1,246.

## Era drift

League average per team-game, regular season. Ratings, pace and TS% for seasons before 1996-97 come from the box-score formulas; from 1996-97 on they are the NBA's values. 3PA rate is three-point attempts / field-goal attempts.

| Season | Off. rating | Pace | 3PA rate | TS% | Source |
|---|---|---|---|---|---|
| 1986 | 106.3 | 103.1 | 0.037 | 0.542 | box score |
| 1987 | 107.1 | 102.0 | 0.053 | 0.539 | box score |
| 1988 | 106.9 | 100.7 | 0.057 | 0.539 | box score |
| 1989 | 106.6 | 101.9 | 0.073 | 0.538 | box score |
| 1990 | 107.1 | 99.3 | 0.076 | 0.538 | box score |
| 1991 | 106.8 | 98.9 | 0.082 | 0.536 | box score |
| 1992 | 107.1 | 97.6 | 0.088 | 0.532 | box score |
| 1993 | 107.2 | 97.6 | 0.105 | 0.538 | box score |
| 1994 | 105.4 | 95.9 | 0.117 | 0.529 | box score |
| 1995 | 107.5 | 93.6 | 0.188 | 0.544 | box score |
| 1996 | 107.0 | 92.4 | 0.200 | 0.544 | box score |
| 1997 | 105.0 | 91.6 | 0.213 | 0.537 | NBA |
| 1998 | 103.4 | 91.8 | 0.160 | 0.525 | NBA |
| 1999 | 100.5 | 90.5 | 0.169 | 0.513 | NBA |
| 2000 | 102.4 | 94.7 | 0.167 | 0.524 | NBA |
| 2001 | 102.5 | 92.4 | 0.172 | 0.521 | NBA |
| 2002 | 103.1 | 92.0 | 0.181 | 0.521 | NBA |
| 2003 | 102.2 | 92.3 | 0.182 | 0.520 | NBA |
| 2004 | 101.4 | 91.5 | 0.187 | 0.517 | NBA |
| 2005 | 104.5 | 92.3 | 0.196 | 0.530 | NBA |
| 2006 | 104.9 | 91.7 | 0.202 | 0.537 | NBA |
| 2007 | 105.3 | 92.9 | 0.212 | 0.542 | NBA |
| 2008 | 106.2 | 93.5 | 0.222 | 0.541 | NBA |
| 2009 | 107.0 | 92.8 | 0.224 | 0.545 | NBA |
| 2010 | 106.6 | 93.6 | 0.222 | 0.544 | NBA |
| 2011 | 106.3 | 92.9 | 0.222 | 0.542 | NBA |
| 2012 | 103.5 | 92.3 | 0.226 | 0.528 | NBA |
| 2013 | 104.8 | 93.0 | 0.244 | 0.536 | NBA |
| 2014 | 105.7 | 94.8 | 0.260 | 0.542 | NBA |
| 2015 | 104.8 | 94.7 | 0.268 | 0.535 | NBA |
| 2016 | 105.6 | 96.6 | 0.285 | 0.542 | NBA |
| 2017 | 108.2 | 97.0 | 0.317 | 0.554 | NBA |
| 2018 | 107.9 | 98.0 | 0.338 | 0.557 | NBA |
| 2019 | 109.7 | 100.7 | 0.359 | 0.561 | NBA |
| 2020 | 110.1 | 100.8 | 0.384 | 0.566 | NBA |
| 2021 | 111.7 | 99.8 | 0.393 | 0.573 | NBA |
| 2022 | 116.3 | 95.0 | 0.333 | 0.574 | NBA |
| 2023 | 114.1 | 99.8 | 0.388 | 0.583 | NBA |
| 2024 | 114.6 | 99.2 | 0.395 | 0.581 | NBA |
| 2025 | 113.8 | 99.6 | 0.421 | 0.578 | NBA |
| 2026 | 114.8 | 100.2 | 0.415 | 0.582 | NBA |
| 2022-2026 mean | 114.7 | 98.8 | 0.391 | 0.579 |  |

## Era probe

Two probe models, not releases: the same logistic regression on the same 12 regular-season stats (home, away and difference), trained on point-in-time games from 1998-2018. "Raw" reads the stats as they are. "League-relative" reads each one as a z-score against the previous season's teams (the point-in-time rule; `_build_pool` in `train_model_experiments.py` does the same). 1986 has no previous season, so these rows start in 1987. 2022 is almost missing from the profiles (2 team-seasons of 1 game each; see CONTRIBUTING.md), so 2023 is measured against a meaningless reference: the 2024-2026 rows show the relative probe without that defect.

**Real games** (both teams always from the same season)

| Model, seasons | n | Accuracy | Log loss | Brier |
|---|---|---|---|---|
| Raw inputs, 1987-1997 | 12,564 | 69.6% | 0.5817 | 0.1981 |
| Raw inputs, 2019-2021 | 3,573 | 63.6% | 0.6398 | 0.2239 |
| Raw inputs, 2022-2026 | 5,148 | 64.5% | 0.6305 | 0.2197 |
| Raw inputs, 2024-2026 | 3,842 | 65.2% | 0.6230 | 0.2163 |
| League-relative inputs, 1987-1997 | 12,564 | 69.4% | 0.5843 | 0.1989 |
| League-relative inputs, 2019-2021 | 3,573 | 63.3% | 0.6425 | 0.2248 |
| League-relative inputs, 2022-2026 | 5,148 | 63.9% | 0.6674 | 0.2291 |
| League-relative inputs, 2024-2026 | 3,842 | 65.1% | 0.6268 | 0.2179 |

**Cross-era pairings**: every 1987-1997 team-season against every 2022-2026 team-season (35,502 pairs), full-season profiles, neutral court as the export computes it. For the league-relative probe a completed season is measured against its own league. "Matched quality" keeps the 3,820 pairs whose season net ratings are within 1 point: a model with no era preference should give those about 50%.

| Model | Mean P(older team wins) | Older team favoured | Matched quality: mean P(older) |
|---|---|---|---|
| `hist-v1` (served) | 51.4% | 52.6% | 52.3% |
| Probe, raw inputs | 46.8% | 42.0% | 46.4% |
| Probe, league-relative inputs | 50.0% | 49.7% | 49.9% |

## Season labels

- Games from 1986-1997 played in October of the year their season ends: 0. Every older season starts in late October or November and ends by June.
- 2020 playoff games played in October 2020 (the bubble Finals): 5 games, labelled season 2021 by the `month < 10` rule. This is existing behaviour for every script, not new in F11; it moves those games into 2020-21's playoff profiles, so 2020 and 2021 per-season figures should be read with that in mind.
