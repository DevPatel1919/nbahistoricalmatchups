# Contributing

Guide for anyone (human or agent) changing this repo. Read it before touching features, training, or model artifacts.

## What this software is

An NBA game-outcome predictor built on public box-score data (1998 onward). It contains two models with different jobs:

| Model | Question it answers | Inputs | Code | Artifacts |
|---|---|---|---|---|
| **Historical matchup simulator** | "Who wins: 2017 Warriors vs 1998 Bulls?" | Completed full-season team profiles | `src/models/train_model_experiments.py`, `src/models/predict_matchup.py` | `models/experiments/`, `models/production/` |
| **Pre-game model** | "Who wins tonight's game?" Intended for betting. | Only what is known before tip-off: season-to-date stats, Elo, recent form, rest, lineup strength | `src/models/train_pregame_model.py` | `models/pregame/` |

The long-term goal is a betting app that makes money. That means the pre-game model is judged against sportsbook prices, not on raw accuracy. Sportsbook closing lines pick the winner roughly 68–70% of the time. A model beyond that range is almost certainly **leaking**, meaning it is seeing information from after tip-off.

A public website in front of the simulator, **Court of All Time**, is specced in [`docs/frontend-handoff.md`](docs/frontend-handoff.md): precomputed matchups served as static files, with no API.

## The point-in-time rule

This is the one rule that must never break. Every training feature for a game is computed **only from games that tipped off before it**. That means none of the game's own result, and nothing later in the season.

This repo has already been burned once. An earlier model claimed 71% playoff accuracy because its playoff features were aggregated over each team's full playoff run, including the game being predicted. The honest number was about 61%.

When you add or change a feature:

- Build it with cumulative or rolling aggregates that are `shift()`-ed, or with `merge_asof(..., allow_exact_matches=False)`. Follow the existing code: `cumulative_profiles` / `attach_pregame_profile` in `backend/scripts/build_matchup_training_data.py`, and `prior_rolling_mean` in `backend/scripts/build_pregame_features.py`.
- Order games by the timestamp in `TeamStatisticsExtended.csv`. `games.csv` disagrees with it for about 40 games, and mixing the two can put a game's own row before it.
- Season-level normalisations (z-scores, percentiles) use the **previous** season's distribution (see `_build_pool` in `train_model_experiments.py`).
- `team_season_profiles_extended.csv` holds full-season aggregates. It is a valid **input** for the historical simulator and is **never** valid as a training feature.
- Extend `src/models/test_pregame_leakage.py` to cover the new feature, then run it. It must exit 0. It works by recomputing features from raw files and comparing them with the built data. It correctly fails on the old leaky data, so a pass means something.

Lineup features use the players who actually appeared in each game. Live predictions must replace that with the expected active roster from the injury report and inactive list. Keep that assumption visible anywhere those features are used.

## Pipeline

Run from the repo root, in this order:

```
python backend/scripts/import_dataset.py                  # Kaggle download into data/raw/ (needs KAGGLE_USERNAME / KAGGLE_KEY in .env)
python backend/scripts/clean_team_histories.py
python backend/scripts/build_team_season_profiles_extended.py
python backend/scripts/build_pregame_features.py          # ~2 min (player box scores)
python backend/scripts/build_matchup_training_data.py
python src/models/test_pregame_leakage.py                 # must pass before training
python src/models/train_pregame_model.py                  # ~15 s
python src/models/train_model_experiments.py              # historical simulator, 10+ min
```

- Raw inputs live in `data/raw/` and outputs in `data/processed/`. Both are gitignored, so running these scripts is the only way to get the data.
- Each script's module docstring states what it reads and writes.

## Evaluating a change

- **Split:** chronological, with train ≤ 2018, validation 2019–2021 and test ≥ 2022. Choose hyperparameters and feature sets on validation only, then score test once.
- **Trusted number:** the walk-forward table (`models/pregame/walk_forward.csv`). Each season is scored by a model fit on all earlier seasons.
- **Rank models by log loss and calibration first, accuracy second.** Betting stakes depend on probabilities being right, not just the pick. Check `test_calibration` in `pregame_metrics.json` whenever you change the model.
- **Report metrics honestly.** Record what the model actually scored, and state it when a target is not met. The training scripts write the note "Did not reach 80% validation accuracy; saved the best honest model."
- Profit claims need historical odds data, which the repo does not have yet. Until it does, describe results as accuracy and log loss, not as ROI.

## Code conventions

Match the surrounding code:

- **Scripts:** a module docstring that ends with a `Run from repo root:` block. Uppercase path and config constants at the top, built from `REPO_ROOT = Path(__file__).resolve().parents[N]`, and a `main()` function behind `if __name__ == "__main__":`.
- **Section banners:** `# ---...` comment banners between sections, and aligned `=` in blocks of related assignments.
- **Output:** print progress with string concatenation (`print("Rows: " + str(n))`). End each script by printing what it saved and where.
- **Validation:** check inputs and outputs explicitly (empty frames, duplicate keys, nulls in required columns) and `raise ValueError` with a descriptive message.
- **Models:** sklearn `Pipeline` of `SimpleImputer(median)` → `StandardScaler` → estimator. Pickle the whole pipeline and save its column list as JSON next to it.
- **Constants:** shared stat definitions live in one place. `MEAN_STATS` / `PCT_STATS` in `build_team_season_profiles_extended.py` are imported by the matchup builder, so add a stat there once.
- **Artifacts:** training scripts write to their own folder (`models/experiments/` or `models/pregame/`). Promote a model to `models/production/` only deliberately, together with its matching column list.

## Known gotchas

- **2022 season is almost missing:** it has 4 games in the matchup data, because most of its rows in the raw files have no `gameType`. Walk-forward skips it, and the test split effectively covers 2023–2026.
- **Mixed date formats:** `gameDateTimeEst` omits the leading zero on some hours. Parse it with `pd.to_datetime(..., format="mixed")`.
- **Artifact paths can mismatch:** `src/models/model_config.py` loads each artifact from `models/production/` if the file exists there, otherwise from `models/experiments/`. Production currently has only the column list, so a retrain of the experiments model loads new weights with a stale column list and `predict_matchup` breaks. Keep the model and its columns in the same folder.
- **Some features can't be served:** `predict_matchup` builds features only from raw profile columns. A historical-simulator model that selects `_z` or `_pctile` features cannot be served until the prediction code computes them.
- **Long jobs on Windows:** a long training run started with the shell's background option can die silently when the session moves on. Launch it with PowerShell `Start-Process` and redirect output to a log file.
