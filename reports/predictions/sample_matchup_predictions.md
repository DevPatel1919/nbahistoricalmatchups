# Sample Matchup Predictions

Generated: 2026-09-23 17:15:44
Model release: hist-v1  (historical_entertainment)

## Source

| Field | Value |
| ----- | ----- |
| Team profile CSV | `data\processed\team_season_profiles_extended.csv` |
| Release bundle | `models/releases/hist-v1` |
| Classification model | LogisticRegression |
| Regression model | HistGradientBoostingRegressor |
| Model feature count | 70 |
| Published accuracy | none; see the release's metrics.json |

Total team-seasons available: **835** (1998–2026)

## Matchup Results

| Matchup | Mode | Predicted Winner | A Win% | B Win% | Margin | A Reg Win% | B Reg Win% | A Playoff Win% | B Playoff Win% | Warnings |
| ------- | ---- | ---------------- | ------ | ------ | ------ | ---------- | ---------- | -------------- | -------------- | -------- |
| 1998 Chicago Bulls vs 2017 Golden State Warriors | playoff_context_model | 2017 Golden State Warriors | 22.9% | 77.1% | 1998 Chicago Bulls by about 1.9 pts | 0.7561 | 0.8171 | 0.7143 | 0.9412 | none |
| 2001 Los Angeles Lakers vs 2017 Golden State Warriors | playoff_context_model | 2017 Golden State Warriors | 43.4% | 56.6% | 2017 Golden State Warriors by about 1.7 pts | 0.7143 | 0.8171 | 0.9375 | 0.9412 | none |
| 2023 Denver Nuggets vs 2019 Toronto Raptors | playoff_context_model | 2023 Denver Nuggets | 62.3% | 37.7% | 2023 Denver Nuggets by about 2.5 pts | 0.6463 | 0.7073 | 0.8 | 0.6667 | none |
| 2024 Boston Celtics vs 2023 Denver Nuggets | playoff_context_model | 2024 Boston Celtics | 51.0% | 49.0% | 2024 Boston Celtics by about 12.3 pts | 0.7805 | 0.6463 | 0.8421 | 0.8 | none |
| 2004 Detroit Pistons vs 2016 Golden State Warriors | playoff_context_model | 2004 Detroit Pistons | 59.0% | 41.0% | 2016 Golden State Warriors by about 0.0 pts | 0.6585 | 0.8902 | 0.6957 | 0.625 | none |
| 2020 Los Angeles Lakers vs 2021 Milwaukee Bucks | playoff_context_model | 2020 Los Angeles Lakers | 61.3% | 38.7% | 2020 Los Angeles Lakers by about 3.3 pts | 0.7324 | 0.6389 | 0.8125 | 0.6957 | none |

## Key Feature Diffs

| Matchup | playoff_win_pct_diff | regular_net_rating_diff | regular_ts_pct_diff | regular_3pt_pct_diff |
| ------- | -------------------- | ----------------------- | ------------------- | -------------------- |
| 1998 Chicago Bulls vs 2017 Golden State Warriors | -0.2269 | -3.75 | -0.0807 | -0.06 |
| 2001 Los Angeles Lakers vs 2017 Golden State Warriors | -0.0037 | -7.79 | -0.0622 | -0.0426 |
| 2023 Denver Nuggets vs 2019 Toronto Raptors | 0.1333 | -2.45 | 0.0209 | 0.0124 |
| 2024 Boston Celtics vs 2023 Denver Nuggets | 0.0421 | 8.39 | 0.0071 | 0.0093 |
| 2004 Detroit Pistons vs 2016 Golden State Warriors | 0.0707 | -4.26 | -0.0821 | -0.0715 |
| 2020 Los Angeles Lakers vs 2021 Milwaukee Bucks | 0.1168 | -0.18 | -0.0216 | -0.0401 |

## Notes

**Classification model** predicts win probability using 71 features.
The strongest predictor is `playoff_win_pct_diff` (coefficient 1.19 — by far the dominant feature).

**Regression model** predicts the projected point margin.
A positive margin means Team A is favored by that many points.
A negative margin means Team B is favored.

**Prediction mode:**
- `playoff_context_model` — both teams made the playoffs; model is operating within its training distribution.
- `playoff_context_model_extrapolated` — one or both teams did not make the playoffs;
  playoff context features for those teams are filled with 0, which may reduce accuracy.
  A warning is added to the result.

**Model strengths:** Cross-era comparisons between playoff-caliber teams.
Dynasty teams (championship runs, high playoff win%) will be heavily favored over regular-season teams.
This is by design — the model learned from actual playoff game outcomes.

**Model limitations:** The regression R² is only 0.22, meaning projected margins have
high variance (~13 RMSE). Use margins as rough guidance, not precise forecasts.