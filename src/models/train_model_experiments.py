"""
train_model_experiments.py

Runs classification and regression experiments for the Historical NBA Matchup Simulator.
Tests multiple feature engineering theories and model configurations.

Outputs saved to models/experiments/.
Does NOT overwrite baseline files in models/.

Run from repo root:
    python src/models/train_model_experiments.py
"""

import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"
EXP_DIR   = REPO_ROOT / "models" / "experiments"

TRAIN_MAX  = 2018
VAL_MIN    = 2019
VAL_MAX    = 2021
TEST_MIN   = 2022
MIN_ROWS   = 30  # minimum rows in any split to run a dataset filter

EXCLUDE_COLS = {
    "game_id", "game_date", "game_type", "game_subtype",
    "season", "home_team_id", "away_team_id",
    "home_team_city", "away_team_city", "home_team_name", "away_team_name",
    "home_score", "away_score", "homeScore", "awayScore", "winner",
    "home_win", "home_point_margin",
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
    "made_play_in",
    "playoff_win_pct",
    "playoff_net_rating",
    "playoff_offensive_rating",
    "playoff_defensive_rating",
    "playoff_true_shooting_percentage",
]

STRONG_DIFF_COLS = [
    "regular_win_pct_diff",
    "regular_net_rating_diff",
    "regular_offensive_rating_diff",
    "regular_defensive_rating_diff",
    "regular_true_shooting_percentage_diff",
    "regular_effective_field_goal_percentage_diff",
    "regular_rebound_percentage_diff",
    "regular_team_turnover_percentage_diff",
    "regular_pace_diff",
]

STRONG_ERA_DIFF_COLS = [
    "regular_net_rating_z_diff",
    "regular_offensive_rating_z_diff",
    "regular_defensive_rating_z_diff",
    "regular_true_shooting_percentage_z_diff",
    "regular_rebound_percentage_z_diff",
    "regular_team_turnover_percentage_z_diff",
    "regular_pace_z_diff",
]


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def add_derived_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for stat in PLAYOFF_CONTEXT_STATS:
        h, a, d = f"home_{stat}", f"away_{stat}", f"{stat}_diff"
        if h in df.columns and a in df.columns and d not in df.columns:
            df[d] = df[h] - df[a]
    return df


def _build_pool(df: pd.DataFrame) -> pd.DataFrame:
    """
    League reference distribution for each season: every team's end-of-season
    core stats from the PREVIOUS season.

    Matchup features are point-in-time, so a team's last row in a season holds
    its (near-)complete regular-season profile. Shifting the season by one means
    a game is only ever normalised against a season that has already finished.
    """
    avail = [s for s in CORE_STATS if f"home_{s}" in df.columns and f"away_{s}" in df.columns]
    home_side = df[["season", "game_date", "home_team_id"] + [f"home_{s}" for s in avail]].rename(
        columns={"home_team_id": "team_id", **{f"home_{s}": s for s in avail}}
    )
    away_side = df[["season", "game_date", "away_team_id"] + [f"away_{s}" for s in avail]].rename(
        columns={"away_team_id": "team_id", **{f"away_{s}": s for s in avail}}
    )
    pool = pd.concat([home_side, away_side], ignore_index=True)
    pool = pool.sort_values("game_date").drop_duplicates(subset=["season", "team_id"], keep="last")
    pool["season"] = pool["season"] + 1
    return pool.drop(columns=["game_date", "team_id"])


def _side_values(df: pd.DataFrame, stat: str):
    return [("home", df[f"home_{stat}"]), ("away", df[f"away_{stat}"])]


def add_era_adjusted_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    pool = _build_pool(df)
    avail = [s for s in CORE_STATS if s in pool.columns]

    ref = pool.groupby("season")[avail].agg(["mean", "std"])
    new = {}
    for stat in avail:
        mean = df["season"].map(ref[(stat, "mean")])
        std  = df["season"].map(ref[(stat, "std")]).where(lambda x: x > 0)
        for side, values in _side_values(df, stat):
            new[f"{side}_{stat}_z"] = (values - mean) / std
        new[f"{stat}_z_diff"] = new[f"home_{stat}_z"] - new[f"away_{stat}_z"]
    return pd.concat([df, pd.DataFrame(new, index=df.index)], axis=1)


def add_percentile_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    pool = _build_pool(df)
    avail = [s for s in CORE_STATS if s in pool.columns]

    new = {}
    for stat in avail:
        ref = {season: np.sort(g.dropna().to_numpy()) for season, g in pool.groupby("season")[stat]}
        for side, values in _side_values(df, stat):
            pct = pd.Series(np.nan, index=df.index)
            for season, idx in df.groupby("season").groups.items():
                r = ref.get(season)
                if r is None or len(r) == 0:
                    continue
                v = values.loc[idx]
                pct.loc[idx] = np.where(v.isna(), np.nan, np.searchsorted(r, v.fillna(0), side="right") / len(r))
            new[f"{side}_{stat}_pctile"] = pct
        new[f"{stat}_pctile_diff"] = new[f"home_{stat}_pctile"] - new[f"away_{stat}_pctile"]
    return pd.concat([df, pd.DataFrame(new, index=df.index)], axis=1)


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

    core_hd = []
    for s in CORE_STATS:
        core_hd += pick(f"home_{s}", f"away_{s}", f"{s}_diff")

    diff_only = [c for s in CORE_STATS for c in pick(f"{s}_diff")]

    all_regular = [
        c for c in df.columns
        if (c.startswith("home_regular_") or c.startswith("away_regular_")
            or (c.startswith("regular_") and c.endswith("_diff")))
        and keep(c)
    ]

    playoff_extra = []
    for s in PLAYOFF_CONTEXT_STATS:
        playoff_extra += pick(f"home_{s}", f"away_{s}", f"{s}_diff")
    playoff_ctx = list(dict.fromkeys(core_hd + playoff_extra))

    era_core = []
    for s in CORE_STATS:
        era_core += pick(f"home_{s}_z", f"away_{s}_z", f"{s}_z_diff", f"{s}_diff")
    era_core = list(dict.fromkeys(era_core))

    era_diff_only = [c for s in CORE_STATS for c in pick(f"{s}_z_diff")]

    pctile_core = []
    for s in CORE_STATS:
        pctile_core += pick(f"home_{s}_pctile", f"away_{s}_pctile", f"{s}_pctile_diff")

    minimal_diff     = pick(*STRONG_DIFF_COLS)
    minimal_era_diff = pick(*STRONG_ERA_DIFF_COLS)

    sets = {
        "regular_core_home_away_diff":  core_hd,
        "regular_core_diff_only":       diff_only,
        "regular_all_home_away_diff":   all_regular,
        "regular_plus_playoff_context": playoff_ctx,
        "era_adjusted_core":            era_core,
        "era_adjusted_diff_only":       era_diff_only,
        "percentile_core":              pctile_core,
        "minimal_strong_diff":          minimal_diff,
        "minimal_era_adjusted_diff":    minimal_era_diff,
    }
    return {k: v for k, v in sets.items() if v}


# ---------------------------------------------------------------------------
# Pipelines and evaluation
# ---------------------------------------------------------------------------

def make_clf_pipeline(clf) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
        ("clf",     clf),
    ])


def make_reg_pipeline(reg) -> Pipeline:
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
        ("reg",     reg),
    ])


def eval_clf(pipeline, X, y) -> dict:
    preds  = pipeline.predict(X)
    probas = pipeline.predict_proba(X)[:, 1]
    return {
        "accuracy":    round(float(accuracy_score(y, preds)), 4),
        "roc_auc":     round(float(roc_auc_score(y, probas)), 4),
        "log_loss":    round(float(log_loss(y, probas)), 4),
        "brier_score": round(float(brier_score_loss(y, probas)), 4),
    }


def eval_reg(pipeline, X, y) -> dict:
    preds = pipeline.predict(X)
    return {
        "mae":  round(float(mean_absolute_error(y, preds)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y, preds))), 4),
        "r2":   round(float(r2_score(y, preds)), 4),
    }


def chrono_split(data: pd.DataFrame):
    return (
        data[data["season"] <= TRAIN_MAX],
        data[(data["season"] >= VAL_MIN) & (data["season"] <= VAL_MAX)],
        data[data["season"] >= TEST_MIN],
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
            raise ValueError("Missing required column: " + col)

    df = df.dropna(subset=["home_win", "season"])
    df["home_win"]     = df["home_win"].astype(int)
    df["season"]       = df["season"].astype(int)
    df["home_team_id"] = pd.to_numeric(df["home_team_id"], errors="coerce")
    df["away_team_id"] = pd.to_numeric(df["away_team_id"], errors="coerce")

    print("Loaded matchup data: " + str(len(df)) + " rows, " + str(len(df.columns)) + " columns")

    EXP_DIR.mkdir(parents=True, exist_ok=True)

    # --- Feature engineering -------------------------------------------------
    df = add_derived_features(df)
    df = add_era_adjusted_features(df)
    df = add_percentile_features(df)

    if "homeScore" in df.columns and "awayScore" in df.columns:
        df["home_point_margin"] = df["homeScore"] - df["awayScore"]
    elif "home_score" in df.columns and "away_score" in df.columns:
        df["home_point_margin"] = df["home_score"] - df["away_score"]

    print("After feature engineering: " + str(len(df)) + " rows, " + str(len(df.columns)) + " columns")

    # --- Validate base split -------------------------------------------------
    tr, va, te = chrono_split(df)
    for name, s in [("train", tr), ("validation", va), ("test", te)]:
        if s.empty:
            raise ValueError("Split '" + name + "' is empty -- adjust season ranges.")

    print("Train rows:      " + str(len(tr)))
    print("Validation rows: " + str(len(va)))
    print("Test rows:       " + str(len(te)))

    # --- Dataset filters -----------------------------------------------------
    datasets = {"all_games": df}
    if "game_type" in df.columns:
        for label, gtype in [("regular_season_only", "Regular Season"), ("playoffs_only", "Playoffs")]:
            sub = df[df["game_type"] == gtype]
            if not sub.empty:
                datasets[label] = sub

    # --- Feature sets --------------------------------------------------------
    feature_sets = build_feature_sets(df)

    # --- Classification candidates ------------------------------------------
    clf_candidates = []
    for C in [0.001, 0.01, 0.1, 1, 10, 100]:
        for cw in [None, "balanced"]:
            clf_candidates.append((
                "LogisticRegression",
                LogisticRegression(penalty="l2", C=C, solver="lbfgs",
                                   class_weight=cw, max_iter=3000, random_state=42),
                {"penalty": "l2", "C": C, "solver": "lbfgs", "class_weight": str(cw)},
            ))
    for C in [0.001, 0.01, 0.1, 1, 10]:
        for cw in [None, "balanced"]:
            clf_candidates.append((
                "LogisticRegression",
                LogisticRegression(penalty="l1", C=C, solver="liblinear",
                                   class_weight=cw, max_iter=3000, random_state=42),
                {"penalty": "l1", "C": C, "solver": "liblinear", "class_weight": str(cw)},
            ))
    clf_candidates.append((
        "RandomForest",
        RandomForestClassifier(n_estimators=300, max_depth=8, random_state=42, n_jobs=-1),
        {"n_estimators": 300, "max_depth": 8},
    ))
    clf_candidates.append((
        "HistGradientBoosting",
        HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, random_state=42),
        {"max_iter": 300, "learning_rate": 0.05},
    ))

    # Count valid experiments upfront
    valid_combos = [
        (ds_name, fs_name)
        for ds_name, ds_df in datasets.items()
        for fs_name in feature_sets
        if all(len(s) >= MIN_ROWS for s in chrono_split(ds_df))
    ]
    total = len(valid_combos) * len(clf_candidates)
    print("Running classification experiments: " + str(total))

    # --- Experiment loop -----------------------------------------------------
    exp_rows          = []
    best_val_log_loss = float("inf")
    best_val_accuracy = 0.0
    best_clf_pipeline = None
    best_clf_cols     = None
    best_result       = None

    for ds_name, ds_df in datasets.items():
        tr_d, va_d, te_d = chrono_split(ds_df)
        if any(len(s) < MIN_ROWS for s in (tr_d, va_d, te_d)):
            continue

        for fs_name, feature_cols in feature_sets.items():
            X_tr = tr_d[feature_cols]
            y_tr = tr_d["home_win"]
            X_va = va_d[feature_cols]
            y_va = va_d["home_win"]
            X_te = te_d[feature_cols]
            y_te = te_d["home_win"]

            for model_name, base_clf, hp in clf_candidates:
                pipeline = make_clf_pipeline(clone(base_clf))
                pipeline.fit(X_tr, y_tr)

                train_acc = round(float(accuracy_score(y_tr, pipeline.predict(X_tr))), 4)
                val_m     = eval_clf(pipeline, X_va, y_va)
                test_m    = eval_clf(pipeline, X_te, y_te)

                exp_rows.append({
                    "dataset_filter":         ds_name,
                    "feature_set":            fs_name,
                    "model_type":             model_name,
                    "hyperparameters":        str(hp),
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
                    best_clf_pipeline  = pipeline
                    best_clf_cols      = feature_cols
                    best_result        = {
                        "dataset_filter":         ds_name,
                        "feature_set":            fs_name,
                        "model_type":             model_name,
                        "hyperparameters":        hp,
                        "train_accuracy":         train_acc,
                        "validation_accuracy":    val_m["accuracy"],
                        "validation_roc_auc":     val_m["roc_auc"],
                        "validation_log_loss":    val_m["log_loss"],
                        "validation_brier_score": val_m["brier_score"],
                        "test_accuracy":          test_m["accuracy"],
                        "test_roc_auc":           test_m["roc_auc"],
                        "test_log_loss":          test_m["log_loss"],
                        "test_brier_score":       test_m["brier_score"],
                    }

    # --- Classification summary ----------------------------------------------
    print("")
    print("Best classification model:  " + best_result["model_type"])
    print("Best dataset filter:        " + best_result["dataset_filter"])
    print("Best feature set:           " + best_result["feature_set"])
    print("Best hyperparameters:       " + str(best_result["hyperparameters"]))
    print("Validation accuracy:        " + str(best_result["validation_accuracy"]))
    print("Validation ROC-AUC:         " + str(best_result["validation_roc_auc"]))
    print("Validation log_loss:        " + str(best_result["validation_log_loss"]))
    print("Test accuracy:              " + str(best_result["test_accuracy"]))
    print("Test ROC-AUC:               " + str(best_result["test_roc_auc"]))
    print("Test log_loss:              " + str(best_result["test_log_loss"]))

    reached_80   = best_result["validation_accuracy"] >= 0.80
    accuracy_note = (
        "Reached 80%+ validation accuracy."
        if reached_80
        else "Did not reach 80% validation accuracy; saved the best honest model."
    )
    print("80% validation accuracy target: " + ("reached" if reached_80 else "not reached"))

    # --- Point-margin regression ---------------------------------------------
    print("\nRunning point-margin regression experiments...")
    reg_summary = {}

    if "home_point_margin" in df.columns:
        tr_all, va_all, te_all = chrono_split(df)
        X_tr_r = tr_all[best_clf_cols]
        y_tr_r = tr_all["home_point_margin"].dropna()
        X_tr_r = X_tr_r.loc[y_tr_r.index]
        X_va_r = va_all[best_clf_cols]
        y_va_r = va_all["home_point_margin"].dropna()
        X_va_r = X_va_r.loc[y_va_r.index]
        X_te_r = te_all[best_clf_cols]
        y_te_r = te_all["home_point_margin"].dropna()
        X_te_r = X_te_r.loc[y_te_r.index]

        reg_candidates = [
            ("Ridge",                         Ridge()),
            ("RandomForestRegressor",         RandomForestRegressor(n_estimators=300, max_depth=8, random_state=42, n_jobs=-1)),
            ("HistGradientBoostingRegressor",  HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=42)),
        ]

        best_val_mae      = float("inf")
        best_reg_pipeline = None
        best_reg_name     = None
        best_reg_metrics  = {}
        reg_results       = []

        for reg_name, base_reg in reg_candidates:
            pipeline = make_reg_pipeline(clone(base_reg))
            pipeline.fit(X_tr_r, y_tr_r)
            val_r  = eval_reg(pipeline, X_va_r, y_va_r)
            test_r = eval_reg(pipeline, X_te_r, y_te_r)
            reg_results.append({
                "model":           reg_name,
                "validation_mae":  val_r["mae"],
                "validation_rmse": val_r["rmse"],
                "validation_r2":   val_r["r2"],
                "test_mae":        test_r["mae"],
                "test_rmse":       test_r["rmse"],
                "test_r2":         test_r["r2"],
            })
            if val_r["mae"] < best_val_mae:
                best_val_mae      = val_r["mae"]
                best_reg_pipeline = pipeline
                best_reg_name     = reg_name
                best_reg_metrics  = {"validation": val_r, "test": test_r}

        print("Best regression model: " + best_reg_name)
        with open(EXP_DIR / "point_margin_model.pkl", "wb") as f:
            pickle.dump(best_reg_pipeline, f)

        reg_summary = {
            "feature_set_used":    best_result["feature_set"],
            "best_model":          best_reg_name,
            "best_validation_mae": best_val_mae,
            "all_models":          reg_results,
            "best_metrics":        best_reg_metrics,
        }
    else:
        print("Skipping regression: no score columns found.")
        reg_summary = {"note": "Skipped -- no homeScore/awayScore columns found."}
        with open(EXP_DIR / "point_margin_model.pkl", "wb") as f:
            pickle.dump(None, f)

    with open(EXP_DIR / "point_margin_metrics.json", "w") as f:
        json.dump(reg_summary, f, indent=2)

    # --- Save classification artifacts ---------------------------------------
    with open(EXP_DIR / "best_experiment_model.pkl", "wb") as f:
        pickle.dump(best_clf_pipeline, f)

    with open(EXP_DIR / "best_experiment_columns.json", "w") as f:
        json.dump(best_clf_cols, f, indent=2)

    pd.DataFrame(exp_rows)\
      .sort_values("validation_log_loss")\
      .to_csv(EXP_DIR / "experiment_results.csv", index=False)

    # Coefficients
    if best_result["model_type"] == "LogisticRegression":
        coef = best_clf_pipeline.named_steps["clf"].coef_[0]
        coef_df = pd.DataFrame({
            "feature":         best_clf_cols,
            "coefficient":     coef,
            "abs_coefficient": np.abs(coef),
            "direction":       ["helps_home_win" if c > 0 else "hurts_home_win" for c in coef],
        }).sort_values("abs_coefficient", ascending=False)
    else:
        coef_df = pd.DataFrame({
            "note": ["Coefficients unavailable for model type: " + best_result["model_type"]]
        })
    coef_df.to_csv(EXP_DIR / "feature_coefficients.csv", index=False)

    # Top prediction errors (from best model's dataset filter test set)
    best_ds_test = chrono_split(datasets[best_result["dataset_filter"]])[2]
    X_te_best   = best_ds_test[best_clf_cols]
    test_probas = best_clf_pipeline.predict_proba(X_te_best)[:, 1]
    test_preds  = (test_probas >= 0.5).astype(int)
    true_labels = best_ds_test["home_win"].values
    error_mask  = test_preds != true_labels

    errors = best_ds_test[error_mask].copy()
    errors["predicted_probability"] = test_probas[error_mask]
    errors["predicted_label"]       = test_preds[error_mask]
    errors["error_confidence"]      = np.abs(test_probas[error_mask] - true_labels[error_mask])

    err_cols = [c for c in ("game_id", "season", "game_date", "game_type",
                             "home_team_name", "away_team_name", "home_win",
                             "predicted_probability", "predicted_label", "error_confidence")
                if c in errors.columns]
    errors[err_cols]\
        .sort_values("error_confidence", ascending=False)\
        .head(100)\
        .to_csv(EXP_DIR / "top_prediction_errors.csv", index=False)

    # Experiment metrics JSON
    with open(EXP_DIR / "experiment_metrics.json", "w") as f:
        json.dump({
            "baseline_note":              "Trained on point-in-time (pre-game) features. Earlier results (0.7104 test accuracy) used full-season playoff stats that included the predicted game and are not comparable.",
            "best_model_name":            best_result["model_type"],
            "best_dataset_filter":        best_result["dataset_filter"],
            "best_feature_set":           best_result["feature_set"],
            "best_hyperparameters":       best_result["hyperparameters"],
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
            "accuracy_target_note":       accuracy_note,
            "classification_result_count": len(exp_rows),
            "regression_summary":         reg_summary,
        }, f, indent=2)

    print("")
    print("Saved: " + str(EXP_DIR / "best_experiment_model.pkl"))
    print("Saved: " + str(EXP_DIR / "best_experiment_columns.json"))
    print("Saved: " + str(EXP_DIR / "experiment_metrics.json"))
    print("Saved: " + str(EXP_DIR / "experiment_results.csv"))
    print("Saved: " + str(EXP_DIR / "feature_coefficients.csv"))
    print("Saved: " + str(EXP_DIR / "top_prediction_errors.csv"))
    print("Saved: " + str(EXP_DIR / "point_margin_model.pkl"))
    print("Saved: " + str(EXP_DIR / "point_margin_metrics.json"))


if __name__ == "__main__":
    main()
