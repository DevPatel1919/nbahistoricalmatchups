"""
train_model_experiments.py

Runs classification and regression experiments for the Historical NBA Matchup Simulator.
Tests multiple feature engineering theories and model configurations.

Outputs saved to models/experiments/ (or --out).
Does NOT overwrite baseline files in models/.

Two modes, chosen by the training file:

  matchup_training_data.csv (the default) - raw profile stats; _z and
      _pctile features are built here against the previous season
      (_build_pool). This is the run hist-v1's era came from.

  historical_training_data.csv (hist-v2) - the file already carries _z
      columns from league_reference (build_historical_training_data.py), the
      same function predict_matchup and the static export use, so they are
      read as they are. Only era-safe feature sets are tried
      (is_era_safe_column), and every candidate is chosen on ONE shared
      validation set (VALIDATION_YARDSTICK), whatever rows it trained on.

Run from repo root:
    python src/models/train_model_experiments.py
    python src/models/train_model_experiments.py --data data/processed/historical_training_data.csv --out models/experiments/hist_v2
"""

import argparse
import json
import pickle
import sys
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

if str(REPO_ROOT / "backend" / "scripts") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))
from build_team_season_profiles_extended import (  # noqa: E402
    RELATIVE_STATS,
    RELATIVE_SUFFIX,
    is_era_safe_column,
)

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
# Era-relative run (hist-v2)
# ---------------------------------------------------------------------------

# Rows where a team has played fewer regular-season games than this carry a
# season-to-date profile (and z-score) built on a handful of games.
SETTLED_GAMES = 20

# The one validation set every hist-v2 candidate is chosen on: every
# 2019-2021 game (regular season, play-in and playoffs) in which both teams
# had played SETTLED_GAMES+ regular-season games. Served profiles are full
# seasons, so these rows resemble what is served.
VALIDATION_YARDSTICK = "2019-2021 games, both teams with " + str(SETTLED_GAMES) + "+ regular-season games"

MINIMAL_ERA_STATS = [
    "regular_net_rating",
    "regular_offensive_rating",
    "regular_defensive_rating",
    "regular_true_shooting_percentage",
    "regular_team_turnover_percentage",
    "regular_pace",
]

ERA_NEUTRAL_RECORD_STATS = ["regular_win_pct", "regular_net_rating", "regular_point_diff_per_game"]
ERA_NEUTRAL_PLAYOFF_STATS = ["made_playoffs", "made_play_in", "playoff_win_pct", "playoff_net_rating"]


def has_relative_columns(df: pd.DataFrame) -> bool:
    return all(f"home_{s}{RELATIVE_SUFFIX}" in df.columns for s in RELATIVE_STATS)


def build_era_safe_feature_sets(df: pd.DataFrame) -> dict:
    """Feature sets for hist-v2; every column passes is_era_safe_column."""
    def hd(stats, suffix=""):
        cols = []
        for s in stats:
            cols += [f"home_{s}{suffix}", f"away_{s}{suffix}", f"{s}{suffix}_diff"]
        return cols

    def diffs(stats, suffix=""):
        return [f"{s}{suffix}_diff" for s in stats]

    z_core   = hd(RELATIVE_STATS, RELATIVE_SUFFIX)
    z_diffs  = diffs(RELATIVE_STATS, RELATIVE_SUFFIX)
    playoff  = hd(ERA_NEUTRAL_PLAYOFF_STATS)

    sets = {
        "era_adjusted_core":                     z_core,
        "era_adjusted_diff_only":                z_diffs,
        "minimal_era_adjusted_diff":             diffs(MINIMAL_ERA_STATS, RELATIVE_SUFFIX),
        "era_adjusted_plus_playoff_context":     z_core + playoff,
        "era_adjusted_diff_plus_playoff_diff":   z_diffs + diffs(ERA_NEUTRAL_PLAYOFF_STATS),
        "era_neutral_record":                    hd(ERA_NEUTRAL_RECORD_STATS),
    }
    for name, cols in sets.items():
        missing = [c for c in cols if c not in df.columns]
        unsafe  = [c for c in cols if not is_era_safe_column(c)]
        if missing or unsafe:
            raise ValueError("Feature set " + name + ": missing " + str(missing) + ", not era-safe " + str(unsafe))
    return sets


def classifier_candidates() -> list:
    out = []
    for C in [0.001, 0.01, 0.1, 1, 10, 100]:
        for cw in [None, "balanced"]:
            out.append(("LogisticRegression",
                        LogisticRegression(penalty="l2", C=C, solver="lbfgs", class_weight=cw, max_iter=3000, random_state=42),
                        {"penalty": "l2", "C": C, "solver": "lbfgs", "class_weight": str(cw)}))
    for C in [0.001, 0.01, 0.1, 1, 10]:
        for cw in [None, "balanced"]:
            out.append(("LogisticRegression",
                        LogisticRegression(penalty="l1", C=C, solver="liblinear", class_weight=cw, max_iter=3000, random_state=42),
                        {"penalty": "l1", "C": C, "solver": "liblinear", "class_weight": str(cw)}))
    out.append(("RandomForest", RandomForestClassifier(n_estimators=300, max_depth=8, random_state=42, n_jobs=-1),
                {"n_estimators": 300, "max_depth": 8}))
    out.append(("HistGradientBoosting", HistGradientBoostingClassifier(max_iter=300, learning_rate=0.05, random_state=42),
                {"max_iter": 300, "learning_rate": 0.05}))
    return out


def settled(df: pd.DataFrame) -> pd.Series:
    return (df["home_regular_games_played"] >= SETTLED_GAMES) & (df["away_regular_games_played"] >= SETTLED_GAMES)


def era_relative_filters(df: pd.DataFrame) -> dict:
    """Training-row filters; each is scored on the same VALIDATION_YARDSTICK."""
    return {
        "all_games":            df,
        "both_teams_20_games":  df[settled(df)],
        "regular_season_only":  df[df["game_type"] == "Regular Season"],
        "playoffs_only":        df[df["game_type"] == "Playoffs"],
    }


def split_metrics(pipeline, rows: pd.DataFrame, cols: list) -> dict:
    out = {"all": dict(eval_clf(pipeline, rows[cols], rows["home_win"]), n=len(rows))}
    for label, gtype in (("regular_season", "Regular Season"), ("playoffs", "Playoffs")):
        sub = rows[rows["game_type"] == gtype]
        if len(sub) >= MIN_ROWS:
            out[label] = dict(eval_clf(pipeline, sub[cols], sub["home_win"]), n=len(sub))
    return out


def run_era_relative(df: pd.DataFrame, exp_dir: Path, data_path: Path) -> None:
    df = df.copy()
    df["home_point_margin"] = df["homeScore"] - df["awayScore"]

    # A row needs at least one earlier regular-season game per team to have a profile
    df = df[(df["home_regular_games_played"] >= 1) & (df["away_regular_games_played"] >= 1)]
    tr_all, va_all, te_all = chrono_split(df)
    yard_va = va_all[settled(va_all)]
    yard_te = te_all[settled(te_all)]
    print("Train seasons:   " + str(tr_all["season"].min()) + "-" + str(tr_all["season"].max()) + "  rows " + str(len(tr_all)))
    print("Validation rows: " + str(len(va_all)) + "  (yardstick: " + str(len(yard_va)) + ")")
    print("Test rows:       " + str(len(te_all)) + "  (2022: " + str(int((te_all["season"] == 2022).sum())) + ")")

    feature_sets = build_era_safe_feature_sets(df)
    filters      = era_relative_filters(df)
    candidates   = classifier_candidates()
    print("Running classification experiments: " + str(len(feature_sets) * len(filters) * len(candidates)))

    exp_rows = []
    best = None
    for ds_name, ds_df in filters.items():
        tr_d = chrono_split(ds_df)[0]
        for fs_name, cols in feature_sets.items():
            for model_name, base_clf, hp in candidates:
                pipeline = make_clf_pipeline(clone(base_clf))
                pipeline.fit(tr_d[cols], tr_d["home_win"])
                val_m = eval_clf(pipeline, yard_va[cols], yard_va["home_win"])
                row = {
                    "dataset_filter":         ds_name,
                    "feature_set":            fs_name,
                    "model_type":             model_name,
                    "hyperparameters":        str(hp),
                    "feature_count":          len(cols),
                    "train_rows":             len(tr_d),
                    "train_accuracy":         round(float(accuracy_score(tr_d["home_win"], pipeline.predict(tr_d[cols]))), 4),
                    "validation_accuracy":    val_m["accuracy"],
                    "validation_roc_auc":     val_m["roc_auc"],
                    "validation_log_loss":    val_m["log_loss"],
                    "validation_brier_score": val_m["brier_score"],
                }
                exp_rows.append(row)
                key = (val_m["log_loss"], -val_m["accuracy"])
                if best is None or key < best["key"]:
                    best = {"key": key, "pipeline": pipeline, "cols": cols, "row": row, "hp": hp}
        print("  done: " + ds_name)

    pipeline, cols, row = best["pipeline"], best["cols"], best["row"]

    # Test is scored once, for the chosen candidate only.
    test_yard = split_metrics(pipeline, yard_te, cols)
    test_all  = split_metrics(pipeline, te_all, cols)
    val_all   = split_metrics(pipeline, va_all, cols)

    print("")
    print("Best classification model:  " + row["model_type"] + " " + str(best["hp"]))
    print("Best dataset filter:        " + row["dataset_filter"])
    print("Best feature set:           " + row["feature_set"] + " (" + str(len(cols)) + " columns)")
    print("Validation (yardstick):     acc " + str(row["validation_accuracy"]) + "  log loss " + str(row["validation_log_loss"]))
    print("Test (yardstick):           acc " + str(test_yard["all"]["accuracy"]) + "  log loss " + str(test_yard["all"]["log_loss"]))
    print("Test (all games):           acc " + str(test_all["all"]["accuracy"]) + "  log loss " + str(test_all["all"]["log_loss"]))

    # --- Point-margin regression: same training rows and columns -------------
    print("\nRunning point-margin regression experiments...")
    tr_r = chrono_split(filters[row["dataset_filter"]])[0]
    reg_candidates = [
        ("Ridge",                         Ridge()),
        ("RandomForestRegressor",         RandomForestRegressor(n_estimators=300, max_depth=8, random_state=42, n_jobs=-1)),
        ("HistGradientBoostingRegressor", HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, random_state=42)),
    ]
    reg_results, best_reg = [], None
    for reg_name, base_reg in reg_candidates:
        reg = make_reg_pipeline(clone(base_reg))
        reg.fit(tr_r[cols], tr_r["home_point_margin"])
        val_r = eval_reg(reg, yard_va[cols], yard_va["home_point_margin"])
        reg_results.append({"model": reg_name, "validation_mae": val_r["mae"], "validation_rmse": val_r["rmse"],
                            "validation_r2": val_r["r2"]})
        if best_reg is None or val_r["mae"] < best_reg[2]["mae"]:
            best_reg = (reg_name, reg, val_r)
    reg_name, reg, reg_val = best_reg
    reg_test_yard = eval_reg(reg, yard_te[cols], yard_te["home_point_margin"])
    reg_test_all  = eval_reg(reg, te_all[cols], te_all["home_point_margin"])
    print("Best regression model: " + reg_name + "  validation MAE " + str(reg_val["mae"])
          + "  test MAE " + str(reg_test_yard["mae"]) + " (all test games " + str(reg_test_all["mae"]) + ")")

    reg_summary = {
        "feature_set_used":    row["feature_set"],
        "dataset_filter_used": row["dataset_filter"],
        "best_model":          reg_name,
        "best_validation_mae": reg_val["mae"],
        "all_models":          reg_results,
        "best_metrics":        {"validation": reg_val, "test": reg_test_yard, "test_all_games": reg_test_all},
    }

    # --- Save -----------------------------------------------------------------
    with open(exp_dir / "best_experiment_model.pkl", "wb") as f:
        pickle.dump(pipeline, f)
    with open(exp_dir / "point_margin_model.pkl", "wb") as f:
        pickle.dump(reg, f)
    with open(exp_dir / "best_experiment_columns.json", "w") as f:
        json.dump(cols, f, indent=2)
    with open(exp_dir / "point_margin_metrics.json", "w") as f:
        json.dump(reg_summary, f, indent=2)
    pd.DataFrame(exp_rows).sort_values("validation_log_loss").to_csv(exp_dir / "experiment_results.csv", index=False)

    final = pipeline.named_steps["clf"]
    if hasattr(final, "coef_"):
        coef = final.coef_[0]
        coef_df = pd.DataFrame({
            "feature":         cols,
            "coefficient":     coef,
            "abs_coefficient": np.abs(coef),
            "direction":       ["helps_home_win" if c > 0 else "hurts_home_win" for c in coef],
        }).sort_values("abs_coefficient", ascending=False)
    else:
        coef_df = pd.DataFrame({"note": ["Coefficients unavailable for model type: " + row["model_type"]]})
    coef_df.to_csv(exp_dir / "feature_coefficients.csv", index=False)

    with open(exp_dir / "experiment_metrics.json", "w") as f:
        json.dump({
            "training_file":          str(data_path.relative_to(REPO_ROOT)) if data_path.is_absolute() else str(data_path),
            "mode":                   "era_relative",
            "split":                  {"train": [int(tr_all["season"].min()), TRAIN_MAX], "validation": [VAL_MIN, VAL_MAX],
                                       "test": [TEST_MIN, int(te_all["season"].max())]},
            "selection":              "lowest log loss on one shared validation set: " + VALIDATION_YARDSTICK
                                      + ". Test scored once, for the chosen candidate only.",
            "rows_note":              "Rows need both teams to have played 1+ regular-season game that season.",
            "best_model_name":        row["model_type"],
            "best_dataset_filter":    row["dataset_filter"],
            "best_feature_set":       row["feature_set"],
            "best_hyperparameters":   best["hp"],
            "best_train_rows":        row["train_rows"],
            "best_validation_metrics": {
                "accuracy":    row["validation_accuracy"],
                "roc_auc":     row["validation_roc_auc"],
                "log_loss":    row["validation_log_loss"],
                "brier_score": row["validation_brier_score"],
            },
            "validation_all_games":   val_all,
            "test_yardstick":         test_yard,
            "test_all_games":         test_all,
            "classification_result_count": len(exp_rows),
            "regression_summary":     reg_summary,
        }, f, indent=2)

    for name in ("best_experiment_model.pkl", "best_experiment_columns.json", "experiment_metrics.json",
                 "experiment_results.csv", "feature_coefficients.csv", "point_margin_model.pkl", "point_margin_metrics.json"):
        print("Saved: " + str(exp_dir / name))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train historical-simulator candidates and save the best.")
    parser.add_argument("--data", type=Path, default=DATA_PATH, help="training file (default matchup_training_data.csv)")
    parser.add_argument("--out",  type=Path, default=EXP_DIR,   help="artifact folder (default models/experiments)")
    return parser.parse_args(argv)


def main(argv=None):
    args    = parse_args(argv)
    EXP_DIR = args.out

    # --- Load and validate ---------------------------------------------------
    if not args.data.exists():
        raise FileNotFoundError("Missing: " + str(args.data))

    df = pd.read_csv(args.data, low_memory=False)
    if df.empty:
        raise ValueError(args.data.name + " is empty.")
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

    if has_relative_columns(df):
        print("Training file carries league_reference _z columns: era-relative (hist-v2) run.")
        run_era_relative(df, EXP_DIR, args.data)
        return

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
