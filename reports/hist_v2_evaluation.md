# hist-v2 evaluation (F11 Phase A)

Should the site serve `hist-v2`? This report gives the evidence. Measured
2026-10-01 on branch `f11-older-seasons`. `hist-v2` is built
(`models/releases/hist-v2/`) but **not active**: the site still serves
`hist-v1`, and nothing it reads has changed.

Season numbers are the year a season ends (1987 = 1986–87). Regenerate the
tables below the marker with `python scripts/evaluate_hist_v2.py`; this
summary is kept.

## Summary in plain words

1. **What `hist-v2` is.** It compares two teams by how far each one stood
   above or below its own season's league, not by raw numbers. It was offered
   14 such stats. It ended up using two: **net rating against the league**
   (73% of the weight) and **win percentage against the league** (27%).
   Every other stat (shooting, pace, turnovers, assists, offensive and
   defensive rating on their own) gets zero weight. The playoff-context
   feature sets were tried too; none did better, so the model has no
   playoff input. In short, `hist-v2` says "the team that was more dominant
   in its own season is the favourite". It is simple and easy to explain.
   It knows nothing about rosters, styles or matchups.
2. **It predicts real games far better than `hist-v1`.** Both were scored on
   the same point-in-time games, where each feature uses only earlier games.
   On the test seasons (2022–26, scored once, after choosing on 2019–21):
   - **`hist-v2`:** 64.6% accuracy, log loss 0.638;
   - **`hist-v1`:** 55.6%, log loss 0.712;
   - **baselines:** "the home team wins" 55.5%; "the better record wins"
     62.9%.

   `hist-v1` barely beats a coin weighted for home court. `hist-v2` is more
   accurate than `hist-v1` in all 40 seasons from 1987 to 2026. It beats
   "the better record wins" in 36 of them, and trails it by 1.3 points or
   less in the other four (1997, 2014, 2015, 2021). Its probabilities match
   how often teams actually won, except at the very top: games it gave 90%+
   were won 80% of the time (81 games).
3. **Cross-era fairness holds.** Take every 1987–97 team against every
   2022–26 team, and keep the pairs whose season net ratings are within one
   point. `hist-v2` gives the older team **49.9%** on average, and no such
   pair strays far from 50% (1.7 points on average). `hist-v1` gives 52.0%,
   and its individual pairs stray 16.6 points. Its picks follow playoff win
   percentage, not team quality.
4. **Served numbers change, and they get less extreme.**
   - `1998-bulls` vs `2017-warriors` goes from 26% to 36% for the Bulls.
   - `1998-jazz` vs `2016-cavaliers` goes from 37% to 51%.
   - Among the Champions Bracket's 16, the spread narrows: `hist-v1`'s mean
     win rates run from 35% to 73%, `hist-v2`'s from 43% to 60%.
   - `2017-warriors` stays the bracket's best team.
   - `1999-spurs` falls from 2nd to 9th. Its `hist-v1` rank came from its
     playoff run.
   - The `2008-celtics` rise from 16th to 6th.
5. **New pairs, `hist-v2`, P(first team wins):**
   - `1996-bulls` vs `2017-warriors`: 46.9%;
   - `1986-celtics` vs `2008-celtics`: 54.1%;
   - `1989-pistons` vs `2004-pistons`: 48.0%;
   - `1987-lakers` vs `2001-lakers`: 61.8%.

   The 72–10 Bulls trail the 2017 Warriors slightly. 1995–96 added two
   expansion teams, which widened that season's spread, so the Bulls' +13.3
   net rating is 2.35 steps above their league. The Warriors' +11.4 is 2.67
   steps above theirs. That is how "compared with its own league" works,
   and it may surprise fans.
6. **The rankings look right.**
   - **Top five:** `2017-warriors`, `1996-bulls`, `1986-celtics`,
     `2016-warriors`, `1992-bulls`.
   - **Bottom:** the 7–59 `2012-bobcats` and the 11–71 `1993-mavericks`.
   - **Widest gap:** the best team against the worst is about 93%.
7. **The margin is no better than before.** The point-margin estimate
   (ridge regression) misses real games by 11.4 points on average.
   `hist-v1`'s regressor misses by 11.4 too. The site's "about N pts"
   wording should stay approximate.
8. **Two data holes are fixed in hist-v2's data, and served from Phase B.**
   - **2021–22:** almost every row had no game type. Fixed from `Games.csv`.
     2022 now has all 30 teams. The two broken served teams,
     `2022-clippers` (1–0) and `2022-lakers` (0–1), get full seasons.
     2022's 1,307 games join the test set.
   - **2000–01:** half its games had no game type. The handoff didn't know
     about this one. Today the site serves every 2001 team on about 41 of
     its 82 games; Phase B fixes that.
   - **October 2020 Finals:** the 5 Finals games played in October 2020
     move back from 2021 to 2020. This changes the 2020 and 2021 Lakers and
     Heat.

   `matchup_training_data.csv`, which duel mode and the pre-game model use,
   is unchanged (sha256 checked).

## Decision for the owner

1. **Go ahead (recommended):** Phase B serves `hist-v2` for every
   team-season from 1985–86 on. It is clearly better on real games, fair
   across eras, and simple to explain. The trade-off is that it ignores
   playoff runs and style: a team is exactly as good as its regular season
   against its league.
2. **Adjust:** retrain with a stated change. For example, force playoff
   context in, or soften the 90%+ end.
3. **Keep `hist-v1`:** serve the older teams through `hist-v1`, and leave
   `hist-v2` built but inactive.

Also: **publish an accuracy number?** The default is no, so
`publicAccuracyClaim` is `null`. If yes, the honest figure is the test
result above: 65.0% on test games where both teams had played 20+ games,
64.6% on all test games.

## Where this departs from the handoff plan

- **The 2001 hole.** A1 expected blank game types only in 2022 (plus
  preseason). 2000–01 also has 1,194 blank regular-season rows. The same fix
  covers them, and 2001's training and served profiles become full seasons.
- **Playoff ratings are left out.** A3 allowed z-scoring them or leaving
  them out. Non-playoff teams carry 0 there, which is meaningless as a
  z-score, so they are out. Playoff win % and net rating stayed available
  and got no weight.
- **Training mode is picked from the file.** `train_model_experiments.py`
  runs the hist-v2 mode when the file already carries `league_reference`
  z-scores, so the handoff's command needs no extra flag. The default file
  runs exactly as before.
- **Rows with no earlier game are left out.** A row needs both teams to have
  played at least one regular-season game that season; opening games have no
  profile.
- **`predict_matchup` bug fixed.** `build_model_input` computed each `_diff`
  only from the model's own `home_`/`away_` columns. A model like `hist-v2`,
  which lists only diffs, got NaN everywhere and a flat 50% on every
  matchup. The export didn't have the bug, so the two paths disagreed. It
  now reads the profiles. Output for `hist-v1` is unchanged (verifier
  200/200).

<!-- Everything below is generated by scripts/evaluate_hist_v2.py -->

## Data fixes

### Blank `gameType` rows in the raw team-game files

Every script drops a row whose `gameType` is blank. `Games.csv` has a type for every game. hist-v2 fills a blank only for a counted type (game id prefix 2 regular season, 4 playoffs, 5 play-in) and raises if one stays blank or disagrees with its id; preseason (prefix 1) and NBA Cup (prefix 6) rows stay out.

| File | Season | Blank rows | Counted (filled) | Type in Games.csv |
|---|---|---|---|---|
| TeamStatisticsExtended.csv | 2001 | 1,194 | 1,194 | Regular Season 1,194 |
| TeamStatisticsExtended.csv | 2004 | 30 | 0 | Preseason 30 |
| TeamStatisticsExtended.csv | 2005 | 96 | 0 | Preseason 96 |
| TeamStatisticsExtended.csv | 2006 | 176 | 0 | Preseason 176 |
| TeamStatisticsExtended.csv | 2007 | 196 | 0 | Preseason 196 |
| TeamStatisticsExtended.csv | 2008 | 188 | 0 | Preseason 188 |
| TeamStatisticsExtended.csv | 2009 | 210 | 0 | Preseason 210 |
| TeamStatisticsExtended.csv | 2010 | 224 | 0 | Preseason 224 |
| TeamStatisticsExtended.csv | 2011 | 222 | 0 | Preseason 222 |
| TeamStatisticsExtended.csv | 2012 | 60 | 0 | Preseason 60 |
| TeamStatisticsExtended.csv | 2013 | 212 | 0 | Preseason 212 |
| TeamStatisticsExtended.csv | 2014 | 216 | 0 | Preseason 216 |
| TeamStatisticsExtended.csv | 2015 | 214 | 0 | Preseason 214 |
| TeamStatisticsExtended.csv | 2016 | 200 | 0 | Preseason 200 |
| TeamStatisticsExtended.csv | 2017 | 196 | 0 | Preseason 196 |
| TeamStatisticsExtended.csv | 2018 | 150 | 0 | Preseason 150 |
| TeamStatisticsExtended.csv | 2019 | 118 | 0 | Preseason 118 |
| TeamStatisticsExtended.csv | 2020 | 196 | 0 | Preseason 196 |
| TeamStatisticsExtended.csv | 2021 | 98 | 0 | Preseason 98 |
| TeamStatisticsExtended.csv | 2022 | 2,778 | 2,644 | Regular Season 2,458, Playoffs 174, Preseason 134, Play-in Tournament 12 |
| TeamStatisticsExtended.csv | 2023 | 128 | 0 | Preseason 128 |
| TeamStatisticsExtended.csv | 2024 | 128 | 0 | Preseason 128 |
| TeamStatisticsExtended.csv | 2025 | 138 | 0 | Preseason 138 |
| TeamStatisticsExtended.csv | 2026 | 142 | 0 | Preseason 142 |
| TeamStatistics.csv | 2001 | 1,194 | 1,194 | Regular Season 1,194 |
| TeamStatistics.csv | 2004 | 30 | 0 | Preseason 30 |
| TeamStatistics.csv | 2005 | 96 | 0 | Preseason 96 |
| TeamStatistics.csv | 2006 | 226 | 0 | Preseason 226 |
| TeamStatistics.csv | 2007 | 220 | 0 | Preseason 220 |
| TeamStatistics.csv | 2008 | 188 | 0 | Preseason 188 |
| TeamStatistics.csv | 2009 | 210 | 0 | Preseason 210 |
| TeamStatistics.csv | 2010 | 224 | 0 | Preseason 224 |
| TeamStatistics.csv | 2011 | 222 | 0 | Preseason 222 |
| TeamStatistics.csv | 2012 | 60 | 0 | Preseason 60 |
| TeamStatistics.csv | 2013 | 212 | 0 | Preseason 212 |
| TeamStatistics.csv | 2014 | 216 | 0 | Preseason 216 |
| TeamStatistics.csv | 2015 | 214 | 0 | Preseason 214 |
| TeamStatistics.csv | 2016 | 200 | 0 | Preseason 200 |
| TeamStatistics.csv | 2017 | 196 | 0 | Preseason 196 |
| TeamStatistics.csv | 2018 | 150 | 0 | Preseason 150 |
| TeamStatistics.csv | 2019 | 118 | 0 | Preseason 118 |
| TeamStatistics.csv | 2020 | 196 | 0 | Preseason 196 |
| TeamStatistics.csv | 2021 | 98 | 0 | Preseason 98 |
| TeamStatistics.csv | 2022 | 2,778 | 2,644 | Regular Season 2,458, Playoffs 174, Preseason 134, Play-in Tournament 12 |
| TeamStatistics.csv | 2023 | 128 | 0 | Preseason 128 |
| TeamStatistics.csv | 2024 | 130 | 0 | Preseason 128, NBA Cup 2 |
| TeamStatistics.csv | 2025 | 140 | 0 | Preseason 138, Regular Season 2 |
| TeamStatistics.csv | 2026 | 144 | 2 | Preseason 142, Regular Season 2 |

### Served team-seasons that change (Phase B)

28 team-seasons from 1998 on are added (all from 2022: 2022). 35 already-served team-seasons get different stats: 2001: 29, 2020: 2, 2021: 2, 2022: 2. The 2001 and 2022 rows gain the regular-season games their blank game types hid; 2022's two served one-game teams (`2022-clippers` 1-0, `2022-lakers` 0-1) get full seasons. The October 2020 Finals move from 2021 to 2020:

| Season | Team | Change |
|---|---|---|
| 2020 | Miami Heat | playoffs 16 -> 21 games |
| 2020 | Los Angeles Lakers | playoffs 16 -> 21 games |
| 2021 | Miami Heat | playoffs 9 -> 4 games |
| 2021 | Los Angeles Lakers | playoffs 11 -> 6 games |

## Real games

Both releases score the same rows: every game in `historical_training_data.csv` (point-in-time profiles, playoff games in the calendar year they were played, 2001 and 2022 game types filled) in which both teams had played at least one regular-season game. Each game is scored with its real home and away sides. `hist-v1` reads the raw stats; `hist-v2` reads them as z-scores against the previous season. "Better record wins" picks the higher season-to-date win percentage (home on a tie). `hist-v2` was chosen on the "both teams 20+ games" validation rows; test was scored once.

| Games | Model | n | Accuracy | Log loss | Brier | ROC-AUC | Home team wins | Better record wins |
|---|---|---|---|---|---|---|---|---|
| Validation, 2019-2021, all | `hist-v2` | 3,578 | 63.7% | 0.6395 | 0.2236 | 0.679 | 56.2% | 63.4% |
| Validation, 2019-2021, all | `hist-v1` | 3,578 | 56.3% | 0.7069 | 0.2508 | 0.485 | 56.2% | 63.4% |
| Validation, 2019-2021, both teams 20+ games | `hist-v2` | 2,698 | 64.4% | 0.6282 | 0.2193 | 0.694 | 56.0% | 64.9% |
| Validation, 2019-2021, both teams 20+ games | `hist-v1` | 2,698 | 56.2% | 0.7134 | 0.2521 | 0.485 | 56.0% | 64.9% |
| Validation, 2019-2021, regular season | `hist-v2` | 3,321 | 63.8% | 0.6383 | 0.2231 | 0.681 | 56.3% | 63.2% |
| Validation, 2019-2021, regular season | `hist-v1` | 3,321 | 56.3% | 0.6893 | 0.2480 | 0.473 | 56.3% | 63.2% |
| Validation, 2019-2021, playoffs | `hist-v2` | 250 | 62.0% | 0.6574 | 0.2323 | 0.671 | 53.6% | 64.8% |
| Validation, 2019-2021, playoffs | `hist-v1` | 250 | 55.6% | 0.9451 | 0.2897 | 0.576 | 53.6% | 64.8% |
| Test, 2022-2026, all | `hist-v2` | 6,453 | 64.6% | 0.6375 | 0.2222 | 0.688 | 55.5% | 62.9% |
| Test, 2022-2026, all | `hist-v1` | 6,453 | 55.6% | 0.7120 | 0.2528 | 0.474 | 55.5% | 62.9% |
| Test, 2022-2026, both teams 20+ games | `hist-v2` | 5,053 | 65.0% | 0.6275 | 0.2190 | 0.701 | 54.8% | 63.9% |
| Test, 2022-2026, both teams 20+ games | `hist-v1` | 5,053 | 54.9% | 0.7204 | 0.2552 | 0.468 | 54.8% | 63.9% |
| Test, 2022-2026, regular season | `hist-v2` | 6,001 | 64.7% | 0.6364 | 0.2215 | 0.692 | 55.3% | 63.1% |
| Test, 2022-2026, regular season | `hist-v1` | 6,001 | 55.3% | 0.6937 | 0.2502 | 0.462 | 55.3% | 63.1% |
| Test, 2022-2026, playoffs | `hist-v2` | 422 | 62.6% | 0.6526 | 0.2302 | 0.630 | 58.1% | 59.5% |
| Test, 2022-2026, playoffs | `hist-v1` | 422 | 59.2% | 0.9763 | 0.2924 | 0.588 | 58.1% | 59.5% |

### By season

| Season | n | Playoff games | hist-v2 accuracy | hist-v2 log loss | hist-v1 accuracy | hist-v1 log loss | Better record wins |
|---|---|---|---|---|---|---|---|
| 1987 | 1,001 | 71 | 69.5% | 0.5971 | 65.9% | 0.6767 | 63.5% |
| 1988 | 1,011 | 80 | 69.0% | 0.5876 | 65.9% | 0.6795 | 64.4% |
| 1989 | 1,072 | 62 | 71.2% | 0.5744 | 68.1% | 0.6490 | 66.5% |
| 1990 | 1,164 | 72 | 72.6% | 0.5834 | 64.2% | 0.6768 | 65.4% |
| 1991 | 1,161 | 68 | 68.6% | 0.5887 | 65.9% | 0.6690 | 63.7% |
| 1992 | 1,165 | 73 | 69.4% | 0.5940 | 62.8% | 0.6781 | 64.5% |
| 1993 | 1,167 | 76 | 66.3% | 0.6063 | 61.0% | 0.6949 | 64.5% |
| 1994 | 1,170 | 77 | 71.3% | 0.5837 | 60.5% | 0.6916 | 66.1% |
| 1995 | 1,165 | 73 | 67.6% | 0.6079 | 59.4% | 0.6965 | 65.3% |
| 1996 | 1,242 | 68 | 69.9% | 0.5890 | 60.4% | 0.6880 | 67.6% |
| 1997 | 1,246 | 72 | 69.4% | 0.5807 | 58.3% | 0.6996 | 69.7% |
| 1998 | 1,245 | 71 | 72.4% | 0.5738 | 59.7% | 0.6975 | 68.6% |
| 1999 | 774 | 66 | 68.3% | 0.6127 | 62.8% | 0.6889 | 63.7% |
| 2000 | 1,249 | 75 | 68.4% | 0.5964 | 60.6% | 0.6897 | 64.4% |
| 2001 | 1,244 | 71 | 65.4% | 0.6143 | 59.6% | 0.6910 | 64.2% |
| 2002 | 1,243 | 71 | 63.5% | 0.6329 | 58.7% | 0.6993 | 63.3% |
| 2003 | 1,260 | 88 | 65.6% | 0.6153 | 61.9% | 0.6951 | 62.7% |
| 2004 | 1,254 | 82 | 65.9% | 0.6300 | 61.2% | 0.6810 | 62.9% |
| 2005 | 1,296 | 84 | 66.8% | 0.6132 | 60.4% | 0.6887 | 64.1% |
| 2006 | 1,301 | 89 | 63.8% | 0.6344 | 60.4% | 0.6954 | 62.0% |
| 2007 | 1,292 | 79 | 64.2% | 0.6501 | 59.4% | 0.6906 | 61.5% |
| 2008 | 1,297 | 86 | 68.2% | 0.5955 | 59.8% | 0.6968 | 65.6% |
| 2009 | 1,298 | 85 | 70.8% | 0.5918 | 60.6% | 0.6954 | 65.9% |
| 2010 | 1,294 | 82 | 67.7% | 0.6084 | 59.1% | 0.6980 | 64.1% |
| 2011 | 1,294 | 81 | 68.5% | 0.6015 | 60.2% | 0.6907 | 65.4% |
| 2012 | 1,056 | 84 | 66.2% | 0.6234 | 58.5% | 0.7044 | 63.0% |
| 2013 | 1,294 | 85 | 66.6% | 0.6106 | 61.4% | 0.6879 | 65.1% |
| 2014 | 1,302 | 89 | 64.0% | 0.6254 | 56.9% | 0.7143 | 65.3% |
| 2015 | 1,294 | 81 | 66.8% | 0.6054 | 57.8% | 0.6963 | 67.0% |
| 2016 | 1,299 | 86 | 68.2% | 0.6005 | 59.0% | 0.6952 | 66.1% |
| 2017 | 1,293 | 79 | 63.2% | 0.6367 | 58.8% | 0.6932 | 61.4% |
| 2018 | 1,296 | 82 | 65.2% | 0.6374 | 57.9% | 0.7024 | 63.7% |
| 2019 | 1,296 | 82 | 64.7% | 0.6268 | 58.6% | 0.6943 | 63.7% |
| 2020 | 1,127 | 83 | 64.4% | 0.6313 | 55.6% | 0.7077 | 64.1% |
| 2021 | 1,155 | 85 | 62.0% | 0.6617 | 54.4% | 0.7203 | 62.3% |
| 2022 | 1,307 | 87 | 63.7% | 0.6592 | 54.3% | 0.7166 | 62.0% |
| 2023 | 1,304 | 84 | 62.2% | 0.6574 | 58.1% | 0.7016 | 58.9% |
| 2024 | 1,237 | 82 | 64.1% | 0.6327 | 54.8% | 0.7147 | 63.0% |
| 2025 | 1,300 | 84 | 64.7% | 0.6253 | 54.9% | 0.7141 | 64.1% |
| 2026 | 1,305 | 85 | 68.3% | 0.6128 | 55.8% | 0.7130 | 66.6% |

### Calibration

**`hist-v2`, test seasons 2022-2026**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 19 | 6.5% | 42.1% |
| 0.1-0.2 | 89 | 16.5% | 21.3% |
| 0.2-0.3 | 311 | 25.8% | 27.7% |
| 0.3-0.4 | 595 | 35.6% | 32.8% |
| 0.4-0.5 | 946 | 45.4% | 40.1% |
| 0.5-0.6 | 1,459 | 55.4% | 54.5% |
| 0.6-0.7 | 1,444 | 64.8% | 61.2% |
| 0.7-0.8 | 1,024 | 74.7% | 74.7% |
| 0.8-0.9 | 485 | 84.1% | 79.6% |
| 0.9-1.0 | 81 | 92.6% | 80.2% |

**`hist-v2`, test-season playoffs**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.3-0.4 | 20 | 36.4% | 25.0% |
| 0.4-0.5 | 51 | 45.0% | 41.2% |
| 0.5-0.6 | 137 | 54.9% | 58.4% |
| 0.6-0.7 | 149 | 64.5% | 62.4% |
| 0.7-0.8 | 59 | 74.6% | 69.5% |
| 0.8-0.9 | 6 | 80.8% | 83.3% |

**`hist-v1`, test seasons 2022-2026**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 51 | 2.5% | 52.9% |
| 0.1-0.2 | 30 | 17.5% | 36.7% |
| 0.2-0.3 | 42 | 25.6% | 50.0% |
| 0.3-0.4 | 31 | 35.0% | 41.9% |
| 0.4-0.5 | 33 | 45.5% | 57.6% |
| 0.5-0.6 | 2,036 | 59.3% | 59.7% |
| 0.6-0.7 | 4,137 | 60.7% | 53.6% |
| 0.7-0.8 | 26 | 73.7% | 57.7% |
| 0.8-0.9 | 20 | 83.8% | 65.0% |
| 0.9-1.0 | 47 | 96.6% | 63.8% |

**`hist-v1`, test-season playoffs**

| Predicted home win | Games | Mean predicted | Home won |
|---|---|---|---|
| 0.0-0.1 | 51 | 2.5% | 52.9% |
| 0.1-0.2 | 30 | 17.5% | 36.7% |
| 0.2-0.3 | 42 | 25.6% | 50.0% |
| 0.3-0.4 | 31 | 35.0% | 41.9% |
| 0.4-0.5 | 33 | 45.5% | 57.6% |
| 0.5-0.6 | 76 | 54.1% | 63.2% |
| 0.6-0.7 | 66 | 63.4% | 72.7% |
| 0.7-0.8 | 26 | 73.7% | 57.7% |
| 0.8-0.9 | 20 | 83.8% | 65.0% |
| 0.9-1.0 | 47 | 96.6% | 63.8% |

## Cross-era check

Every 1987-1997 team-season against every 2022-2026 team-season (43,650 pairs), on the Phase B profiles (1986-2026, full seasons), neutral court exactly as the export computes it. `hist-v2` measures each season against its own league; `hist-v1` reads raw stats. "Matched quality" keeps the 4,704 pairs whose season net ratings are within 1 point: a model with no era preference gives those about 50% on average.

| Model | Mean P(older team wins) | Older team favoured | Matched quality: mean P(older) | Matched quality: mean distance from 50% |
|---|---|---|---|---|
| `hist-v2` | 50.0% | 49.8% | 49.9% | 1.7 pts |
| `hist-v1` | 51.1% | 51.6% | 52.0% | 16.6 pts |

## Before and after

Neutral-court P(first team wins). "hist-v1 served today" is the live site's number (`frontend/public/data/teams/`, current profiles). "hist-v1 on Phase B profiles" is what a rollback to `hist-v1` would serve after Phase B (1986 on, 2001 and 2022 fixed). The site shows the 1998 Bulls vs 2017 Warriors as 73.8% for the Warriors: 0.2625 for the Bulls below (shown rounded).

| Pair | hist-v1 served today | hist-v1 on Phase B profiles | hist-v2 | hist-v2 margin (pts) |
|---|---|---|---|---|
| `1998-bulls` vs `2017-warriors` | 26.2% | 26.2% | 35.6% | -4.7 |
| `1998-jazz` vs `2016-cavaliers` | 37.2% | 37.2% | 50.8% | -0.2 |
| `1996-bulls` vs `2017-warriors` | not served | 37.1% | 46.9% | -0.7 |
| `1986-celtics` vs `2008-celtics` | not served | 74.1% | 54.1% | 0.6 |
| `1989-pistons` vs `2004-pistons` | not served | 71.1% | 48.0% | 0.2 |
| `1987-lakers` vs `2001-lakers` | not served | 38.4% | 61.8% | 3.6 |
| `1992-bulls` vs `1996-bulls` | not served | 34.4% | 47.6% | -0.4 |
| `1995-rockets` vs `2022-warriors` | not served | 44.5% | 42.1% | -3.1 |

### Champions Bracket entrants

The 16 entrants of `champions-v1` (`frontend/src/data/curated-tournaments.ts`), in seed order. Mean neutral P(win) against the other 15, and the rank that gives inside the bracket.

| Seed | Entrant | hist-v1 served: mean P(win) | hist-v2: mean P(win) | hist-v2 rank | hist-v1 rank |
|---|---|---|---|---|---|
| 1 | `2025-thunder` | 44.9% | 53.9% | 2 | 9 |
| 2 | `2024-celtics` | 62.1% | 52.6% | 4 | 3 |
| 3 | `2017-warriors` | 72.5% | 59.7% | 1 | 1 |
| 4 | `2008-celtics` | 35.1% | 50.8% | 6 | 16 |
| 5 | `2015-warriors` | 52.1% | 52.2% | 5 | 6 |
| 6 | `1999-spurs` | 66.6% | 49.6% | 9 | 2 |
| 7 | `2007-spurs` | 56.8% | 53.3% | 3 | 4 |
| 8 | `2000-lakers` | 39.6% | 50.7% | 7 | 15 |
| 9 | `2005-spurs` | 44.4% | 50.0% | 8 | 12 |
| 10 | `2014-spurs` | 44.3% | 48.7% | 11 | 13 |
| 11 | `2013-heat` | 44.1% | 49.5% | 10 | 14 |
| 12 | `2009-lakers` | 44.8% | 47.6% | 13 | 11 |
| 13 | `1998-bulls` | 47.4% | 44.2% | 15 | 7 |
| 14 | `2002-lakers` | 55.7% | 48.1% | 12 | 5 |
| 15 | `2004-pistons` | 44.9% | 45.7% | 14 | 8 |
| 16 | `2012-heat` | 44.8% | 43.4% | 16 | 10 |

## Top and bottom team-seasons

Each of the 1,177 Phase B team-seasons against every other one, neutral court; the mean of its win probabilities.

**Top 10, `hist-v2`**

| Rank | Team-season | Record | Net rating | Mean neutral P(win) |
|---|---|---|---|---|
| 1 | `2017-warriors` | 67-15 | 11.4 | 76.2% |
| 2 | `1996-bulls` | 72-10 | 13.3 | 73.9% |
| 3 | `1986-celtics` | 67-15 | 9.1 | 72.9% |
| 4 | `2016-warriors` | 73-9 | 10.7 | 72.1% |
| 5 | `1992-bulls` | 67-15 | 10.8 | 72.0% |
| 6 | `2025-thunder` | 68-14 | 12.6 | 72.0% |
| 7 | `2016-spurs` | 67-15 | 11.2 | 71.7% |
| 8 | `2007-spurs` | 58-24 | 9.2 | 71.6% |
| 9 | `2007-mavericks` | 67-15 | 7.7 | 71.1% |
| 10 | `2024-celtics` | 64-18 | 11.7 | 71.0% |

**Bottom 10, `hist-v2`**

| Rank | Team-season | Record | Net rating | Mean neutral P(win) |
|---|---|---|---|---|
| 1168 | `2001-bulls` | 15-67 | -10.0 | 28.0% |
| 1169 | `2003-cavaliers` | 17-65 | -9.8 | 27.6% |
| 1170 | `1998-nuggets` | 11-71 | -13.1 | 27.5% |
| 1171 | `2000-clippers` | 15-67 | -11.8 | 26.4% |
| 1172 | `2023-spurs` | 22-60 | -9.9 | 26.1% |
| 1173 | `2005-hawks` | 13-69 | -10.3 | 26.1% |
| 1174 | `1987-clippers` | 12-70 | -10.9 | 26.1% |
| 1175 | `2006-trail-blazers` | 21-61 | -10.6 | 26.0% |
| 1176 | `1993-mavericks` | 11-71 | -14.9 | 22.3% |
| 1177 | `2012-bobcats` | 7-59 | -15.1 | 21.8% |

## The model

### Selection

lowest log loss on one shared validation set: 2019-2021 games, both teams with 20+ regular-season games. Test scored once, for the chosen candidate only. 576 candidates: 6 era-safe feature sets x 4 training filters x 24 models. Train seasons 1987-2018. Best candidate per filter and feature set:

| Training rows | Feature set | Model | Train rows | Validation log loss | Validation accuracy |
|---|---|---|---|---|---|
| both_teams_20_games | era_adjusted_plus_playoff_context | LogisticRegression {'penalty': 'l1', 'C': 0.001, 'solver': 'liblinear', 'class_weight': 'None'} | 29,834 | 0.6282 | 64.4% |
| both_teams_20_games | era_adjusted_diff_plus_playoff_diff | LogisticRegression {'penalty': 'l1', 'C': 0.001, 'solver': 'liblinear', 'class_weight': 'None'} | 29,834 | 0.6282 | 64.4% |
| both_teams_20_games | era_adjusted_core | LogisticRegression {'penalty': 'l1', 'C': 0.001, 'solver': 'liblinear', 'class_weight': 'None'} | 29,834 | 0.6282 | 64.4% |
| both_teams_20_games | era_adjusted_diff_only | LogisticRegression {'penalty': 'l1', 'C': 0.001, 'solver': 'liblinear', 'class_weight': 'None'} | 29,834 | 0.6282 | 64.4% |
| both_teams_20_games | era_neutral_record | LogisticRegression {'penalty': 'l1', 'C': 0.001, 'solver': 'liblinear', 'class_weight': 'None'} | 29,834 | 0.6285 | 64.4% |
| both_teams_20_games | minimal_era_adjusted_diff | LogisticRegression {'penalty': 'l1', 'C': 0.001, 'solver': 'liblinear', 'class_weight': 'None'} | 29,834 | 0.6292 | 64.6% |
| all_games | era_adjusted_plus_playoff_context | LogisticRegression {'penalty': 'l2', 'C': 0.001, 'solver': 'lbfgs', 'class_weight': 'balanced'} | 38,739 | 0.6298 | 64.4% |
| regular_season_only | era_adjusted_core | LogisticRegression {'penalty': 'l2', 'C': 0.001, 'solver': 'lbfgs', 'class_weight': 'balanced'} | 36,251 | 0.6299 | 64.7% |
| regular_season_only | era_adjusted_plus_playoff_context | LogisticRegression {'penalty': 'l2', 'C': 0.001, 'solver': 'lbfgs', 'class_weight': 'balanced'} | 36,251 | 0.6299 | 64.7% |
| all_games | era_adjusted_diff_plus_playoff_diff | LogisticRegression {'penalty': 'l2', 'C': 0.001, 'solver': 'lbfgs', 'class_weight': 'balanced'} | 38,739 | 0.6300 | 64.5% |
| all_games | era_adjusted_core | LogisticRegression {'penalty': 'l2', 'C': 0.001, 'solver': 'lbfgs', 'class_weight': 'balanced'} | 38,739 | 0.6301 | 64.6% |
| regular_season_only | era_adjusted_diff_plus_playoff_diff | LogisticRegression {'penalty': 'l2', 'C': 0.001, 'solver': 'lbfgs', 'class_weight': 'balanced'} | 36,251 | 0.6305 | 64.5% |

Chosen: **LogisticRegression** {"penalty": "l1", "C": 0.001, "solver": "liblinear", "class_weight": "None"}, feature set `era_adjusted_diff_only`, trained on `both_teams_20_games` rows (29,834).

### Margin regressor

| Model | Estimator | Validation MAE | Test MAE (both 20+ games) | Test MAE (all test games) |
|---|---|---|---|---|
| `hist-v2` | Ridge | 10.66 | 11.41 | 11.40 |
| `hist-v1` | HistGradientBoostingRegressor |  | 11.37 |  |

### Columns and weights

`hist-v2` reads 14 columns. The largest weight is `regular_net_rating_z_diff`, 73.2% of the total absolute weight; the top three hold 100.0%. For comparison, `hist-v1` put 1.19 on `playoff_win_pct_diff` and 0.15 or less on everything else.

| Column | Coefficient (standardised) | Share of total weight |
|---|---|---|
| `regular_net_rating_z_diff` | 0.507 | 73.2% |
| `regular_win_pct_z_diff` | 0.186 | 26.8% |
| `regular_offensive_rating_z_diff` | 0.000 | 0.0% |
| `regular_defensive_rating_z_diff` | 0.000 | 0.0% |
| `regular_pace_z_diff` | 0.000 | 0.0% |
| `regular_true_shooting_percentage_z_diff` | 0.000 | 0.0% |
| `regular_effective_field_goal_percentage_z_diff` | 0.000 | 0.0% |
| `regular_three_pt_pct_z_diff` | 0.000 | 0.0% |
| `regular_ft_pct_z_diff` | 0.000 | 0.0% |
| `regular_assist_percentage_z_diff` | 0.000 | 0.0% |
| `regular_assist_to_turnover_ratio_z_diff` | 0.000 | 0.0% |
| `regular_team_turnover_percentage_z_diff` | 0.000 | 0.0% |
| `regular_opponent_effective_field_goal_percentage_z_diff` | 0.000 | 0.0% |
| `regular_opponent_turnover_percentage_z_diff` | 0.000 | 0.0% |

## Release record

`models/releases/hist-v2/manifest.json` (built from `models/experiments/hist_v2/release_info.json`, not activated).

**Description.** Neutral-court historical matchup simulator. Compares two completed NBA team-seasons (1985-86 onward), each measured against its own season's league rather than by raw numbers. An L1 logistic-regression classifier estimates the win probability; a ridge regressor gives a rough point margin. Output is a model estimate for entertainment, not a forecast or betting advice.

**Limitations**

- Cross-era matchups never happened, so these outcomes cannot be validated against real results.
- Results are for a neutral court: each matchup is scored with both teams at home and the two averaged.
- Each team is compared with its own season's league: its stats are read as how far above or below that season's league average it was (a z-score), not as raw numbers, because scoring, shooting and pace changed between eras.
- In practice the model reads two numbers per team: its net rating and its win percentage, each against its own league. Every other stat it was offered carries zero weight.
- Seasons before 1996-97 use ratings, pace and shooting computed from the box score; the NBA's own advanced values exist only from 1996-97.
- Rebound percentages are not used: they cannot be rebuilt from the box score for older seasons.
- No accuracy figure is published for this release.
- The point margin is approximate; typical error on real games was about 11 points.
- Team strength comes from full-season averages, not rosters, injuries, or rest.

**Source.** models/experiments/hist_v2/ (F11 Phase A, branch f11-older-seasons, 2026-10-01): train_model_experiments.py on data/processed/historical_training_data.csv (1986-87 to 2025-26, point-in-time, z-scores against the previous season), dataset filter both_teams_20_games, feature set era_adjusted_diff_only, L1 LogisticRegression (C=0.001), chosen on one shared validation set.

**metrics.json**

```json
{
  "publicAccuracyClaim": null,
  "publicClaimNote": "Do not publish an accuracy number for this release without the owner's OK. The figures below are honest point-in-time results, recorded for review.",
  "trainingFilter": "both_teams_20_games",
  "featureSet": "era_adjusted_diff_only",
  "pointInTime": {
    "honest": true,
    "note": "Every training feature is built only from games that tipped off earlier; z-scores use the previous season's league. Checked by src/models/test_pregame_leakage.py.",
    "split": "train 1987-2018, validation 2019-2021, test 2022-2026",
    "selection": "lowest log loss on one shared validation set: 2019-2021 games, both teams with 20+ regular-season games. Test scored once, for the chosen candidate only.",
    "validation": {
      "accuracy": 0.6442,
      "roc_auc": 0.6941,
      "log_loss": 0.6282,
      "brier_score": 0.2193
    },
    "test": {
      "accuracy": 0.6501,
      "roc_auc": 0.7009,
      "log_loss": 0.6275,
      "brier_score": 0.219,
      "n": 5053
    },
    "testByGameType": {
      "regular_season": {
        "accuracy": 0.6525,
        "roc_auc": 0.7067,
        "log_loss": 0.625,
        "brier_score": 0.2179,
        "n": 4601
      },
      "playoffs": {
        "accuracy": 0.6256,
        "roc_auc": 0.6303,
        "log_loss": 0.6526,
        "brier_score": 0.2302,
        "n": 422
      }
    },
    "testAllGames": {
      "accuracy": 0.6459,
      "roc_auc": 0.6885,
      "log_loss": 0.6375,
      "brier_score": 0.2222,
      "n": 6453
    },
    "regressionTest": {
      "mae": 11.411,
      "rmse": 14.5343,
      "r2": 0.1493
    }
  }
}
```
