"""
predict_matchup.py

Production prediction module for the Historical NBA Matchup Simulator.

Primary entry point:
    from src.models.predict_matchup import predict_matchup

    result = predict_matchup("Golden State Warriors", 2017, "Chicago Bulls", 1998)

Accepts team name (full, city-only, or team-name-only), case-insensitive.
Looks up profiles from team_season_profiles_extended.csv, builds the exact
feature row expected by the active model release, and returns a prediction dict.

All model artifacts come from one validated release bundle (src/models/release.py).
If the release is missing, partial, or inconsistent, the first call raises a
single ReleaseError before any inference runs.

This is a PRODUCTION module. Do not import train_model_experiments.py from here.
"""

import math
import warnings
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from src.models.model_config import PROFILES_PATH as _PROFILES_PATH
from src.models.release import (
    Release,
    ReleaseError,
    check_profiles,
    load_active_release,
    parse_base_stats,
)

# ---------------------------------------------------------------------------
# Lazy-loaded singletons
# ---------------------------------------------------------------------------

_release  = None   # Release
_clf      = None
_reg      = None
_cols     = None   # list[str]
_profiles = None   # pd.DataFrame


def _load() -> None:
    global _release, _clf, _reg, _cols, _profiles

    if _clf is not None:
        return

    release = load_active_release()

    if not _PROFILES_PATH.exists():
        raise FileNotFoundError(f"Required file not found: {_PROFILES_PATH}  (team profiles)")
    profiles = pd.read_csv(_PROFILES_PATH)
    check_profiles(release, profiles.columns)

    _release, _clf, _reg, _cols, _profiles = release, release.classifier, release.regressor, release.columns, profiles

    # Normalise text columns for matching
    _profiles["_team_full"]   = (_profiles["team_city"] + " " + _profiles["team_name"]).str.lower().str.strip()
    _profiles["_team_city_l"] = _profiles["team_city"].str.lower().str.strip()
    _profiles["_team_name_l"] = _profiles["team_name"].str.lower().str.strip()


def reload() -> None:
    """Force a reload of all model artifacts and the profiles CSV."""
    global _release, _clf, _reg, _cols, _profiles
    _release = _clf = _reg = _cols = _profiles = None
    _load()


def get_release() -> Release:
    """Return the validated release bundle that predictions are served from."""
    _load()
    return _release


# ---------------------------------------------------------------------------
# Team lookup
# ---------------------------------------------------------------------------

def find_team_profile(name: str, season: int) -> pd.Series:
    """
    Find a single team-season row in team_season_profiles_extended.csv.

    Matching is case-insensitive and accepts:
      - full name:  "Golden State Warriors"
      - city only:  "Golden State"
      - team name:  "Warriors"

    Raises ValueError if zero or more than one row matches.
    """
    _load()

    query = name.lower().strip()
    season = int(season)

    mask = (
        (_profiles["season"] == season)
        & (
            (_profiles["_team_full"]   == query)
            | (_profiles["_team_city_l"] == query)
            | (_profiles["_team_name_l"] == query)
            | (_profiles["_team_full"].str.contains(query, regex=False))
        )
    )
    matches = _profiles[mask]

    if len(matches) == 0:
        available = (
            _profiles[_profiles["season"] == season][["team_city", "team_name"]]
            .apply(lambda r: f"{r['team_city']} {r['team_name']}", axis=1)
            .sort_values()
            .tolist()
        )
        season_msg = f"  Available teams for {season}:\n    " + "\n    ".join(available) if available else f"  No data at all for season {season}."
        raise ValueError(
            f"No team found matching '{name}' in season {season}.\n{season_msg}"
        )

    if len(matches) > 1:
        found = matches.apply(lambda r: f"{r['team_city']} {r['team_name']}", axis=1).tolist()
        raise ValueError(
            f"Ambiguous team name '{name}' matched {len(matches)} rows in season {season}: "
            f"{found}. Use a more specific name."
        )

    return matches.iloc[0]


def list_available_teams(season: Optional[int] = None) -> pd.DataFrame:
    """Return DataFrame of all available team-seasons (optionally filtered by season)."""
    _load()
    df = _profiles[["season", "team_city", "team_name", "made_playoffs", "made_play_in"]].copy()
    if season is not None:
        df = df[df["season"] == season]
    return df.sort_values(["season", "team_city"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Feature row builder
# ---------------------------------------------------------------------------

# Base stat names needed by the model (stripped of home_/away_ prefix and _diff suffix).
_parse_base_stats = parse_base_stats


def build_model_input(team_a: pd.Series, team_b: pd.Series, model_cols: list[str]) -> pd.DataFrame:
    """
    Build a single-row DataFrame of exactly the columns in model_cols.

    team_a is treated as the home/Team A side.
    team_b is treated as the away/Team B side.

    Pass 1: fill home_ and away_ columns from source profiles.
    Pass 2: compute _diff columns as home_base - away_base.

    Returns a pd.DataFrame with shape (1, len(model_cols)).
    """
    a = team_a.to_dict() if hasattr(team_a, "to_dict") else dict(team_a)
    b = team_b.to_dict() if hasattr(team_b, "to_dict") else dict(team_b)

    row = {}

    # Pass 1: direct lookups
    for col in model_cols:
        if col.startswith("home_"):
            row[col] = a.get(col[5:], np.nan)
        elif col.startswith("away_"):
            row[col] = b.get(col[5:], np.nan)

    # Pass 2: diff columns
    for col in model_cols:
        if col.endswith("_diff"):
            base = col[:-5]
            h = row.get("home_" + base, np.nan)
            av = row.get("away_" + base, np.nan)
            try:
                row[col] = float(h) - float(av)
            except (TypeError, ValueError):
                row[col] = np.nan

    # Return in exact column order
    df = pd.DataFrame([row])[model_cols]
    return df


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_input(df: pd.DataFrame, model_cols: list[str]) -> list[str]:
    """
    Validate the model input DataFrame. Returns a list of warning strings.
    Raises ValueError for hard failures (wrong shape, object columns, infinities).
    """
    issues = []

    # Must have all columns
    missing = [c for c in model_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Model input is missing required columns: {missing}")

    # Must be ordered correctly
    if list(df.columns) != model_cols:
        raise ValueError("Model input columns are not in the expected order.")

    # No object/string columns
    object_cols = [c for c in model_cols if df[c].dtype == object]
    if object_cols:
        raise ValueError(f"Model columns contain non-numeric data: {object_cols}")

    # No infinities
    inf_cols = [c for c in model_cols if np.isinf(df[c]).any()]
    if inf_cols:
        raise ValueError(f"Model columns contain infinite values: {inf_cols}")

    # Warn on NaN (model may still run via imputer, but flag it)
    nan_cols = [c for c in model_cols if df[c].isna().any()]
    if nan_cols:
        issues.append(f"NaN values present in {len(nan_cols)} column(s): {nan_cols[:5]}{'...' if len(nan_cols) > 5 else ''}")

    return issues


# ---------------------------------------------------------------------------
# Prediction routing
# ---------------------------------------------------------------------------

def _prediction_mode(team_a: pd.Series, team_b: pd.Series) -> tuple[str, list[str]]:
    """
    Determine prediction_mode and any warnings based on playoff participation.

    Returns (mode_str, warnings_list).
    """
    a_playoffs = int(team_a.get("made_playoffs", 0)) == 1
    b_playoffs = int(team_b.get("made_playoffs", 0)) == 1

    if a_playoffs and b_playoffs:
        return "playoff_context_model", []

    warn = []
    if not a_playoffs and not b_playoffs:
        warn.append(
            "Neither team made the playoffs that season. "
            "The current model was trained on playoff games only (playoffs_only filter). "
            "Predictions for non-playoff teams are extrapolations and less reliable."
        )
    else:
        non_playoff_team = (
            f"{team_a.get('team_city', '')} {team_a.get('team_name', '')}"
            if not a_playoffs
            else f"{team_b.get('team_city', '')} {team_b.get('team_name', '')}"
        ).strip()
        warn.append(
            f"{non_playoff_team} did not make the playoffs that season. "
            "The current model was trained on playoff games only. "
            "Playoff context features for non-playoff teams are filled with 0, "
            "which may reduce prediction accuracy."
        )

    return "playoff_context_model_extrapolated", warn


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def predict_matchup(
    team_a_name: str,
    team_a_season: int,
    team_b_name: str,
    team_b_season: int,
) -> dict:
    """
    Predict the outcome of a historical NBA matchup between two completed team-seasons.

    Parameters
    ----------
    team_a_name   : Team A name — full ("Golden State Warriors"), city ("Golden State"),
                    or team name ("Warriors"). Case-insensitive.
    team_a_season : Four-digit season year (e.g. 2017 = 2016-17 season).
    team_b_name   : Team B name (same format).
    team_b_season : Four-digit season year.

    Returns
    -------
    dict with keys:
        team_a                  - "{season} {city} {name}"
        team_b                  - "{season} {city} {name}"
        prediction_mode         - "playoff_context_model" or "playoff_context_model_extrapolated"
        predicted_winner        - team_a or team_b label
        team_a_win_probability  - float [0, 1]
        team_b_win_probability  - float [0, 1]
        projected_margin_team_a - float, positive = team_a wins by N pts. A rough
                                  estimate, not a precise score line.
        classification_model    - final estimator of the release classifier
        regression_model        - final estimator of the release regressor
        model_feature_count     - column count pinned by the release manifest
        model_release           - active release version
        model_purpose           - release purpose, e.g. "historical_entertainment"
        warnings                - list of warning strings (empty = clean)
    """
    _load()

    # 1. Look up profiles
    profile_a = find_team_profile(team_a_name, team_a_season)
    profile_b = find_team_profile(team_b_name, team_b_season)

    label_a = f"{int(profile_a['season'])} {profile_a['team_city']} {profile_a['team_name']}"
    label_b = f"{int(profile_b['season'])} {profile_b['team_city']} {profile_b['team_name']}"

    # 2. Prediction mode + playoff warnings
    mode, warn = _prediction_mode(profile_a, profile_b)

    # 3. Build feature row
    X = build_model_input(profile_a, profile_b, _cols)

    # 4. Validate
    val_warnings = _validate_input(X, _cols)
    warn.extend(val_warnings)

    # 5. Classification
    probas       = _clf.predict_proba(X)[0]
    # class 1 = home/team_a wins (confirmed: model trained with home_win = 1)
    classes      = list(_clf.classes_)
    team_a_prob  = float(probas[classes.index(1)])
    team_b_prob  = float(probas[classes.index(0)])

    predicted_winner = label_a if team_a_prob >= team_b_prob else label_b
    win_pct          = team_a_prob if team_a_prob >= team_b_prob else team_b_prob

    # 6. Regression (positive = team_a (home) wins by margin)
    margin = float(_reg.predict(X)[0])

    # 7. Human-readable margin text
    abs_margin = abs(round(margin, 1))
    margin_leader = label_a if margin >= 0 else label_b
    projected_margin_winner_text = f"{margin_leader} by about {abs_margin} pts"

    return {
        "team_a":                        label_a,
        "team_b":                        label_b,
        "prediction_mode":               mode,
        "predicted_winner":              predicted_winner,
        "team_a_win_probability":        round(team_a_prob, 4),
        "team_b_win_probability":        round(team_b_prob, 4),
        "projected_margin_team_a":       round(margin, 1),
        "projected_margin_winner_text":  projected_margin_winner_text,
        "classification_model":          _release.classifier_name,
        "regression_model":              _release.regressor_name,
        "model_feature_count":           len(_cols),
        "model_release":                 _release.version,
        "model_purpose":                 _release.purpose,
        "warnings":                      warn,
    }


def get_model_columns() -> list[str]:
    """Return the exact list of feature columns the loaded model expects."""
    _load()
    return list(_cols)


# ---------------------------------------------------------------------------
# CLI smoke test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys

    _load()

    # Print a few valid team-season options from the loaded profiles
    sample_seasons = [1998, 2001, 2016, 2017, 2023]
    print("\n=== Sample available team-seasons ===")
    for s in sample_seasons:
        teams = list_available_teams(s)
        playoff_teams = teams[teams["made_playoffs"] == 1][["season", "team_city", "team_name"]].head(3)
        for _, row in playoff_teams.iterrows():
            print(f"  {int(row['season'])}  {row['team_city']} {row['team_name']}")

    # Define 3 sample matchups using teams that are highly likely to exist
    sample_matchups = [
        ("Golden State Warriors", 2017, "Cleveland Cavaliers", 2016),
        ("Chicago Bulls",         1998, "Utah Jazz",           1998),
        ("Los Angeles Lakers",    2001, "Philadelphia 76ers",  2001),
    ]

    print("\n=== Sample Predictions ===\n")
    for a_name, a_season, b_name, b_season in sample_matchups:
        try:
            result = predict_matchup(a_name, a_season, b_name, b_season)
            print(f"Matchup: {result['team_a']}  vs  {result['team_b']}")
            print(f"  Winner:         {result['predicted_winner']}")
            print(f"  Win prob (A):   {result['team_a_win_probability']:.1%}")
            print(f"  Win prob (B):   {result['team_b_win_probability']:.1%}")
            print(f"  Margin:         {result['projected_margin_winner_text']}")
            print(f"  Mode:           {result['prediction_mode']}")
            if result["warnings"]:
                for w in result["warnings"]:
                    print(f"  WARNING: {w}")
            print()
        except Exception as e:
            print(f"  ERROR for {a_name} {a_season} vs {b_name} {b_season}: {e}\n")
