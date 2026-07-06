"""
train_model.py

Runs multiple Logistic Regression experiments across different feature sets
and hyperparameters to find the best binary classifier for home_win prediction.

Run from repo root:
    python src/models/train_model.py
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

REPO_ROOT  = Path(__file__).resolve().parents[2]
DATA_PATH  = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"
MODELS_DIR = REPO_ROOT / "models"

MODEL_OUT       = MODELS_DIR / "historical_matchup_model.pkl"
COLUMNS_OUT     = MODELS_DIR / "model_columns.json"
METRICS_OUT     = MODELS_DIR / "model_metrics.json"
EXPERIMENTS_OUT = MODELS_DIR / "feature_experiment_results.csv"
COEF_OUT        = MODELS_DIR / "logistic_coefficients.csv"
ERRORS_OUT      = MODELS_DIR / "top_prediction_errors.csv"

TRAIN_MAX = 2018
VAL_MIN   = 2019
VAL_MAX   = 2021
TEST_MIN  = 2022

EXCLUDE_COLS = {
    "game_id", "game_date", "game_type", "game_subtype",
    "season", "home_team_id", "away_team_id",
    "home_team_city", "away_team_city", "home_team_name", "away_team_name",
    "home_score", "away_score", "homeScore", "awayScore", "winner",
    "home_win",
}
EXCLUDE_SUFFIXES = ("_games_played", "_wins", "_losses")

CORE_STATS = [
    "regular_win_pct",
    "regular_offensive_rating",
    "regular_defensive_rating",
    "regular_net_rating",
    "regular_pace",
    "regular_true_shooting_percentage",
    "regular_effective_field_goal_percentage",
    "regular_three_pt_pct",
    "regular_ft_pct",
    "regular_rebound_percentage",
    "regular_offensive_rebound_percentage",
    "regular_defensive_rebound_percentage",
    "regular_assist_percentage",
    "regular_assist_to_turnover_ratio",
    "regular_team_turnover_percentage",
    "regular_opponent_effective_field_goal_percentage",
    "regular_opponent_turnover_percentage",
]

PLAYOFF_CONTEXT_STATS = [
    "made_playoffs",
    "playoff_win_pct",
    "playoff_net_rating",
    "playoff_offensive_rating",
    "playoff_defensive_rating",
    "playoff_true_shooting_percentage",
]


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    """Create diff columns for playoff context stats not already in the CSV."""
    df = df.copy()
    for stat in PLAYOFF_CONTEXT_STATS:
        h, a, d = f"home_{stat}", f"away_{stat}", f"{stat}_diff"
        if h in df.columns and a in df.columns and d not in df.columns:
            df[d] = df[h] - df[a]
    return df


def add_era_adjusted_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add season-normalized z-score columns (home_*_z, away_*_z, *_z_diff)
    for each CORE_STAT using unique team-season profiles extracted from
    both sides of every game row.
    """
    df = df.copy()

    avail = [s for s in CORE_STATS if f"home_{s}" in df.columns and f"away_{s}" in df.columns]
    if not avail:
        return df

    home_side = df[["season", "home_team_id"] + [f"home_{s}" for s in avail]].rename(
        columns={"home_team_id": "team_id", **{f"home_{s}": s for s in avail}}
    )
    away_side = df[["season", "away_team_id"] + [f"away_{s}" for s in avail]].rename(
        columns={"away_team_id": "team_id", **{f"away_{s}": s for s in avail}}
    )

    pool = pd.concat([home_side, away_side], ignore_index=True)
    pool = pool.drop_duplicates(subset=["season", "team_id"])

    def season_z(x: pd.Series) -> pd.Series:
        s = x.std()
        if pd.isna(s) or s == 0:
            return pd.Series(0.0, index=x.index)
        return (x - x.mean()) / s

    for stat in avail:
        pool[stat + "_z"] = pool.groupby("season")[stat].transform(season_z)

    z_cols = [s + "_z" for s in avail]

    home_z = pool[["season", "team_id"] + z_cols].rename(
        columns={"team_id": "home_team_id", **{z: f"home_{z}" for z in z_cols}}
    )
    away_z = pool[["season", "team_id"] + z_cols].rename(
        columns={"team_id": "away_team_id", **{z: f"away_{z}" for z in z_cols}}
    )

    df = df.merge(home_z, on=["season", "home_team_id"], how="left")
    df = df.merge(away_z, on=["season", "away_team_id"], how="left")

    for z in z_cols:
        df[z + "_diff"] = df[f"home_{z}"] - df[f"away_{z}"]

    return df


# ---------------------------------------------------------------------------
# Feature sets
# ---------------------------------------------------------------------------

def build_feature_sets(df: pd.DataFrame) -> dict:
    def keep(c):
        return (
            c in df.columns
            and c not in EXCLUDE_COLS
            and not any(c.endswith(s) for s in EXCLUDE_SUFFIXES)
            and pd.api.types.is_numeric_dtype(df[c])
        )

    def pick(*cols):
        return [c for c in cols if keep(c)]

    # Set 1: regular core — home + away + diff
    core_hd = []
    for stat in CORE_STATS:
        core_hd += pick(f"home_{stat}", f"away_{stat}", f"{stat}_diff")

    # Set 2: diff features only
    diff_only = [c for stat in CORE_STATS for c in pick(f"{stat}_diff")]

    # Set 3: all regular home + away + diff columns
    all_regular = [
        c for c in df.columns
        if (c.startswith("home_regular_") or c.startswith("away_regular_")
            or (c.startswith("regular_") and c.endswith("_diff")))
        and keep(c)
    ]

    # Set 4: regular core + limited playoff context
    playoff_extra = []
    for stat in PLAYOFF_CONTEXT_STATS:
        playoff_extra += pick(f"home_{stat}", f"away_{stat}", f"{stat}_diff")
    playoff_ctx = list(dict.fromkeys(core_hd + playoff_extra))

    # Set 5: era-adjusted z-scores + original core diffs
    era_cols = []
    for stat in CORE_STATS:
        era_cols += pick(
            f"home_{stat}_z", f"away_{stat}_z", f"{stat}_z_diff",
            f"{stat}_diff",
        )
    era_cols = list(dict.fromkeys(era_cols))

    sets = {
        "regular_core_home_away_diff":    core_hd,
        "regular_core_diff_only":         diff_only,
        "regular_all_home_away_diff":     all_regular,
        "regular_plus_playoff_context":   playoff_ctx,
        "era_adjusted_core":              era_cols,
    }
    return {k: v for k, v in sets.items() if v}


# ---------------------------------------------------------------------------
# Training helpers
# ---------------------------------------------------------------------------

def make_pipeline(clf) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
        ("clf",     clf),
    ])


def evaluate(pipeline, X, y) -> dict:
    preds  = pipeline.predict(X)
    probas = pipeline.predict_proba(X)[:, 1]
    return {
        "accuracy":    round(float(accuracy_score(y, preds)), 4),
        "roc_auc":     round(float(roc_auc_score(y, probas)), 4),
        "log_loss":    round(float(log_loss(y, probas)), 4),
        "brier_score": round(float(brier_score_loss(y, probas)), 4),
    }


HPARAM_GRID = (
    [{"penalty": "l2", "C": c, "solver": "lbfgs",     "class_weight": cw}
     for c  in [0.001, 0.01, 0.1, 1, 10, 100]
     for cw in [None, "balanced"]]
    +
    [{"penalty": "l1", "C": c, "solver": "liblinear",  "class_weight": cw}
     for c  in [0.001, 0.01, 0.1, 1, 10]
     for cw in [None, "balanced"]]
)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # --- Load and validate ---------------------------------------------------
    if not DATA_PATH.exists():
        raise FileNotFoundError("Missing: " + str(DATA_PATH))

    df = pd.read_csv(DATA_PATH, low_memory=False)
    if df.empty:
        raise ValueError("matchup_training_data.csv is empty.")
    for col in ("home_win", "season"):
        if col not in df.columns:
            raise ValueError("Missing column: " + col)

    df = df.dropna(subset=["home_win", "season"])
    df["home_win"]    = df["home_win"].astype(int)
    df["season"]      = df["season"].astype(int)
    df["home_team_id"] = pd.to_numeric(df["home_team_id"], errors="coerce")
    df["away_team_id"] = pd.to_numeric(df["away_team_id"], errors="coerce")

    print("Loaded matchup data: " + str(len(df)) + " rows, " + str(len(df.columns)) + " columns")

    # --- Feature engineering -------------------------------------------------
    df = add_derived_features(df)
    df = add_era_adjusted_features(df)

    # --- Chronological split -------------------------------------------------
    train = df[df["season"] <= TRAIN_MAX]
    val   = df[(df["season"] >= VAL_MIN) & (df["season"] <= VAL_MAX)]
    test  = df[df["season"] >= TEST_MIN]

    for name, split in [("train", train), ("validation", val), ("test", test)]:
        if split.empty:
            raise ValueError("Split '" + name + "' is empty -- adjust season ranges.")

    print("Train rows:      " + str(len(train)))
    print("Validation rows: " + str(len(val)))
    print("Test rows:       " + str(len(test)))

    # --- Build feature sets --------------------------------------------------
    feature_sets = build_feature_sets(df)
    total_experiments = len(feature_sets) * len(HPARAM_GRID)
    print("Running " + str(total_experiments) + " Logistic Regression experiments...")

    # --- Experiment loop -----------------------------------------------------
    experiment_rows = []
    best_val_log_loss   = float("inf")
    best_val_accuracy   = 0.0
    best_pipeline       = None
    best_feature_cols   = None
    best_result         = None

    for fs_name, feature_cols in feature_sets.items():
        X_train = train[feature_cols]
        y_train = train["home_win"]
        X_val   = val[feature_cols]
        y_val   = val["home_win"]
        X_test  = test[feature_cols]
        y_test  = test["home_win"]

        for hp in HPARAM_GRID:
            clf = LogisticRegression(
                penalty=hp["penalty"],
                C=hp["C"],
                solver=hp["solver"],
                class_weight=hp["class_weight"],
                max_iter=3000,
                random_state=42,
            )
            pipeline = make_pipeline(clf)
            pipeline.fit(X_train, y_train)

            train_acc = round(float(accuracy_score(y_train, pipeline.predict(X_train))), 4)
            val_m     = evaluate(pipeline, X_val,  y_val)
            test_m    = evaluate(pipeline, X_test, y_test)

            experiment_rows.append({
                "feature_set":            fs_name,
                "penalty":                hp["penalty"],
                "solver":                 hp["solver"],
                "C":                      hp["C"],
                "class_weight":           str(hp["class_weight"]),
                "feature_count":          len(feature_cols),
                "train_accuracy":         train_acc,
                "validation_accuracy":    val_m["accuracy"],
                "validation_roc_auc":     val_m["roc_auc"],
                "validation_log_loss":    val_m["log_loss"],
                "validation_brier_score": val_m["brier_score"],
                "test_accuracy":          test_m["accuracy"],
                "test_roc_auc":           test_m["roc_auc"],
                "test_log_loss":          test_m["log_loss"],
                "test_brier_score":       test_m["brier_score"],
            })

            is_better = (
                val_m["log_loss"] < best_val_log_loss or
                (val_m["log_loss"] == best_val_log_loss and val_m["accuracy"] > best_val_accuracy)
            )
            if is_better:
                best_val_log_loss  = val_m["log_loss"]
                best_val_accuracy  = val_m["accuracy"]
                best_pipeline      = pipeline
                best_feature_cols  = feature_cols
                best_result        = {
                    "feature_set":         fs_name,
                    "hyperparameters":     hp,
                    "train_accuracy":      train_acc,
                    "validation_accuracy": val_m["accuracy"],
                    "validation_roc_auc":  val_m["roc_auc"],
                    "validation_log_loss": val_m["log_loss"],
                    "validation_brier_score": val_m["brier_score"],
                    "test_accuracy":       test_m["accuracy"],
                    "test_roc_auc":        test_m["roc_auc"],
                    "test_log_loss":       test_m["log_loss"],
                    "test_brier_score":    test_m["brier_score"],
                }

    # --- Print results -------------------------------------------------------
    print("")
    print("Best feature set:     " + best_result["feature_set"])
    print("Best hyperparameters: " + str(best_result["hyperparameters"]))
    print("Validation accuracy:  " + str(best_result["validation_accuracy"]))
    print("Validation AUC:       " + str(best_result["validation_roc_auc"]))
    print("Validation log_loss:  " + str(best_result["validation_log_loss"]))
    print("Test accuracy:        " + str(best_result["test_accuracy"]))
    print("Test AUC:             " + str(best_result["test_roc_auc"]))
    print("Test log_loss:        " + str(best_result["test_log_loss"]))

    reached_80     = best_result["validation_accuracy"] >= 0.80
    accuracy_note  = (
        "Reached 80%+ validation accuracy."
        if reached_80
        else "Did not reach 80% validation accuracy; saved the best honest model."
    )
    print("80% accuracy target:  " + ("reached" if reached_80 else "not reached"))

    # --- Save artifacts ------------------------------------------------------
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    with open(MODEL_OUT, "wb") as f:
        pickle.dump(best_pipeline, f)

    with open(COLUMNS_OUT, "w") as f:
        json.dump(best_feature_cols, f, indent=2)

    with open(METRICS_OUT, "w") as f:
        json.dump({
            "best_model_name":        "LogisticRegression",
            "best_feature_set":       best_result["feature_set"],
            "best_hyperparameters":   best_result["hyperparameters"],
            "best_validation_metrics": {
                "accuracy":    best_result["validation_accuracy"],
                "roc_auc":     best_result["validation_roc_auc"],
                "log_loss":    best_result["validation_log_loss"],
                "brier_score": best_result["validation_brier_score"],
            },
            "best_test_metrics": {
                "accuracy":    best_result["test_accuracy"],
                "roc_auc":     best_result["test_roc_auc"],
                "log_loss":    best_result["test_log_loss"],
                "brier_score": best_result["test_brier_score"],
            },
            "target_accuracy_note": accuracy_note,
            "all_results":          experiment_rows,
        }, f, indent=2)

    pd.DataFrame(experiment_rows)\
      .sort_values("validation_log_loss")\
      .to_csv(EXPERIMENTS_OUT, index=False)

    # Coefficients for best model
    coef = best_pipeline.named_steps["clf"].coef_[0]
    pd.DataFrame({
        "feature":         best_feature_cols,
        "coefficient":     coef,
        "abs_coefficient": np.abs(coef),
        "direction":       ["helps_home_win" if c > 0 else "hurts_home_win" for c in coef],
    }).sort_values("abs_coefficient", ascending=False)\
      .to_csv(COEF_OUT, index=False)

    # Top prediction errors on test set
    X_test_best = test[best_feature_cols]
    test_probas = best_pipeline.predict_proba(X_test_best)[:, 1]
    test_preds  = (test_probas >= 0.5).astype(int)
    true_labels = test["home_win"].values
    error_mask  = test_preds != true_labels

    errors = test[error_mask].copy()
    errors["predicted_probability"] = test_probas[error_mask]
    errors["predicted_label"]       = test_preds[error_mask]
    errors["error_confidence"]      = np.abs(test_probas[error_mask] - true_labels[error_mask])

    keep_meta = [c for c in ("game_id", "season", "game_date", "home_team_name", "away_team_name",
                              "home_win", "predicted_probability", "predicted_label", "error_confidence")
                 if c in errors.columns]
    errors[keep_meta]\
        .sort_values("error_confidence", ascending=False)\
        .head(100)\
        .to_csv(ERRORS_OUT, index=False)

    print("")
    print("Saved: " + str(MODEL_OUT))
    print("Saved: " + str(COLUMNS_OUT))
    print("Saved: " + str(METRICS_OUT))
    print("Saved: " + str(EXPERIMENTS_OUT))
    print("Saved: " + str(COEF_OUT))
    print("Saved: " + str(ERRORS_OUT))


if __name__ == "__main__":
    main()
