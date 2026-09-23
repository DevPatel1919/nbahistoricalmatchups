"""
train_pregame_model.py

Trains the pre-game win-probability model intended for betting. Unlike the
historical matchup simulator (train_model_experiments.py), every feature here
is known before tip-off: season-to-date stats, Elo, recent form, rest, and the
strength of the players who suit up.

Evaluation
  - Chronological split: train <= 2018, validation 2019-2021, test >= 2022.
    C is chosen on validation log loss; the saved model is refit on
    train + validation and scored once on test.
  - Walk-forward: for each season from 2015, fit on all earlier seasons and
    score that season. This is the number to trust.

Outputs saved to models/pregame/.

Run from repo root (after the build scripts in backend/scripts/):
    python src/models/train_pregame_model.py
"""

import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"
OUT_DIR   = REPO_ROOT / "models" / "pregame"

TRAIN_MAX = 2018
VAL_MIN   = 2019
VAL_MAX   = 2021
TEST_MIN  = 2022

WALK_FORWARD_START = 2015
MIN_SEASON_GAMES   = 100   # skip near-empty seasons (2022 is missing from the raw data)

GAME_TYPES = ["Regular Season", "Playoffs"]
C_GRID     = [0.001, 0.01, 0.1, 1]

SEASON_STAT_FEATURES = [
    "regular_win_pct_diff",
    "regular_net_rating_diff",
    "regular_offensive_rating_diff",
    "regular_defensive_rating_diff",
    "regular_true_shooting_percentage_diff",
    "regular_rebound_percentage_diff",
    "regular_team_turnover_percentage_diff",
]

TEAM_FORM_FEATURES = [
    "pre_elo_diff",
    "form10_net_rating_diff",
    "form10_win_pct_diff",
    "rest_days_diff",
    "home_back_to_back",
    "away_back_to_back",
    "prev_season_net_rating_diff",
    "prev_season_win_pct_diff",
]

LINEUP_FEATURES = [
    "lineup_top8_gmsc30_diff",
    "lineup_total_gmsc30_diff",
    "lineup_top8_gmsc10_diff",
    "lineup_top8_gmsc82_diff",
    "lineup_plus_minus_diff",
    "missing_rotation_gmsc30_diff",
    "home_missing_rotation_gmsc30",
    "away_missing_rotation_gmsc30",
]

FEATURE_SETS = {
    "season_stats":               SEASON_STAT_FEATURES,
    "season_stats+form":          SEASON_STAT_FEATURES + TEAM_FORM_FEATURES,
    "season_stats+form+lineup":   SEASON_STAT_FEATURES + TEAM_FORM_FEATURES + LINEUP_FEATURES,
}
PRODUCTION_FEATURE_SET = "season_stats+form+lineup"


def make_pipeline(C: float) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
        ("clf",     LogisticRegression(C=C, max_iter=3000)),
    ])


def evaluate(pipeline, df: pd.DataFrame, cols: list) -> dict:
    probas = pipeline.predict_proba(df[cols])[:, 1]
    y = df["home_win"]
    return {
        "games":       int(len(df)),
        "accuracy":    round(float(accuracy_score(y, probas >= 0.5)), 4),
        "roc_auc":     round(float(roc_auc_score(y, probas)), 4),
        "log_loss":    round(float(log_loss(y, probas)), 4),
        "brier_score": round(float(brier_score_loss(y, probas)), 4),
    }


def evaluate_splits(pipeline, df: pd.DataFrame, cols: list) -> dict:
    playoffs = df[df["game_type"] == "Playoffs"]
    return {
        "all_games": evaluate(pipeline, df, cols),
        "playoffs":  evaluate(pipeline, playoffs, cols) if playoffs["home_win"].nunique() == 2 else None,
    }


def calibration_table(pipeline, df: pd.DataFrame, cols: list) -> list:
    """Predicted vs actual home win rate in 10-point probability buckets."""
    probas = pipeline.predict_proba(df[cols])[:, 1]
    bucket = np.clip((probas * 10).astype(int), 0, 9)
    table = []
    for b in range(10):
        mask = bucket == b
        if mask.sum() == 0:
            continue
        table.append({
            "bucket":         f"{b * 10}-{b * 10 + 10}%",
            "games":          int(mask.sum()),
            "mean_predicted": round(float(probas[mask].mean()), 4),
            "actual_rate":    round(float(df["home_win"].to_numpy()[mask].mean()), 4),
        })
    return table


def walk_forward(df: pd.DataFrame, cols: list, C: float) -> pd.DataFrame:
    rows = []
    for season in sorted(df["season"].unique()):
        test = df[df["season"] == season]
        if season < WALK_FORWARD_START or len(test) < MIN_SEASON_GAMES:
            continue
        pipeline = make_pipeline(C).fit(df[df["season"] < season][cols], df[df["season"] < season]["home_win"])
        m = evaluate_splits(pipeline, test, cols)
        rows.append({
            "season":            int(season),
            "games":             m["all_games"]["games"],
            "accuracy":          m["all_games"]["accuracy"],
            "log_loss":          m["all_games"]["log_loss"],
            "playoff_games":     m["playoffs"]["games"] if m["playoffs"] else 0,
            "playoff_accuracy":  m["playoffs"]["accuracy"] if m["playoffs"] else None,
        })
    return pd.DataFrame(rows)


def main():
    if not DATA_PATH.exists():
        raise FileNotFoundError("Missing: " + str(DATA_PATH))

    df = pd.read_csv(DATA_PATH, low_memory=False)
    df = df[df["game_type"].isin(GAME_TYPES)].dropna(subset=["home_win"]).copy()
    df["home_win"] = df["home_win"].astype(int)
    df["season"]   = df["season"].astype(int)

    missing = [c for cols in FEATURE_SETS.values() for c in cols if c not in df.columns]
    if missing:
        raise ValueError("Missing feature columns (rebuild data?): " + str(sorted(set(missing))))

    train = df[df["season"] <= TRAIN_MAX]
    val   = df[(df["season"] >= VAL_MIN) & (df["season"] <= VAL_MAX)]
    test  = df[df["season"] >= TEST_MIN]
    print("Train / validation / test games: "
          + str(len(train)) + " / " + str(len(val)) + " / " + str(len(test)))

    # --- Compare feature sets, choosing C on validation ---------------------
    results = {}
    for name, cols in FEATURE_SETS.items():
        best_C = min(
            C_GRID,
            key=lambda C: evaluate(make_pipeline(C).fit(train[cols], train["home_win"]), val, cols)["log_loss"],
        )
        final = make_pipeline(best_C).fit(pd.concat([train, val])[cols], pd.concat([train, val])["home_win"])
        wf    = walk_forward(df, cols, best_C)
        results[name] = {
            "C":        best_C,
            "pipeline": final,
            "test":     evaluate_splits(final, test, cols),
            "walk_forward": wf,
            "walk_forward_mean": {
                "accuracy":         round(float(wf["accuracy"].mean()), 4),
                "log_loss":         round(float(wf["log_loss"].mean()), 4),
                "playoff_accuracy": round(float(wf["playoff_accuracy"].mean()), 4),
            },
        }
        t = results[name]["test"]
        print("")
        print(name + "  (C=" + str(best_C) + ", " + str(len(cols)) + " features)")
        print("  Test accuracy (all / playoffs): "
              + str(t["all_games"]["accuracy"]) + " / " + str(t["playoffs"]["accuracy"]))
        print("  Test log_loss:                  " + str(t["all_games"]["log_loss"]))
        print("  Walk-forward mean accuracy:     " + str(results[name]["walk_forward_mean"]["accuracy"])
              + "  (playoffs " + str(results[name]["walk_forward_mean"]["playoff_accuracy"]) + ")")

    # --- Save production feature set -----------------------------------------
    best = results[PRODUCTION_FEATURE_SET]
    cols = FEATURE_SETS[PRODUCTION_FEATURE_SET]
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with open(OUT_DIR / "pregame_model.pkl", "wb") as f:
        pickle.dump(best["pipeline"], f)
    with open(OUT_DIR / "pregame_columns.json", "w") as f:
        json.dump(cols, f, indent=2)
    best["walk_forward"].to_csv(OUT_DIR / "walk_forward.csv", index=False)

    coef = best["pipeline"].named_steps["clf"].coef_[0]
    pd.DataFrame({"feature": cols, "coefficient": coef, "abs_coefficient": np.abs(coef)})\
      .sort_values("abs_coefficient", ascending=False)\
      .to_csv(OUT_DIR / "pregame_coefficients.csv", index=False)

    with open(OUT_DIR / "pregame_metrics.json", "w") as f:
        json.dump({
            "model":         "LogisticRegression",
            "feature_set":   PRODUCTION_FEATURE_SET,
            "C":             best["C"],
            "trained_on":    "seasons <= " + str(VAL_MAX) + ", " + ", ".join(GAME_TYPES),
            "test_seasons":  ">= " + str(TEST_MIN),
            "test_metrics":  best["test"],
            "walk_forward_mean": best["walk_forward_mean"],
            "test_calibration":  calibration_table(best["pipeline"], test, cols),
            "feature_set_comparison": {
                name: {"C": r["C"], "test": r["test"], "walk_forward_mean": r["walk_forward_mean"]}
                for name, r in results.items()
            },
            "note": ("Lineup features use the players who actually appeared. Live predictions "
                     "must supply the expected active roster from the injury report."),
        }, f, indent=2)

    print("")
    print("Saved: " + str(OUT_DIR / "pregame_model.pkl"))
    print("Saved: " + str(OUT_DIR / "pregame_columns.json"))
    print("Saved: " + str(OUT_DIR / "pregame_metrics.json"))
    print("Saved: " + str(OUT_DIR / "pregame_coefficients.csv"))
    print("Saved: " + str(OUT_DIR / "walk_forward.csv"))


if __name__ == "__main__":
    main()
