"""
build_team_season_profiles.py

Reads raw game-level team data from data/raw/TeamStatisticsExtended.csv
and produces one aggregated row per team per season per game_type, saved to
data/processed/team_season_profiles.csv.

Run from project root:
    python backend/scripts/build_team_season_profiles.py
"""

import sys
import numpy as np
import pandas as pd
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).resolve().parents[2]
INPUT_PATH  = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
OUTPUT_DIR  = REPO_ROOT / "data" / "processed"
OUTPUT_PATH = OUTPUT_DIR / "team_season_profiles.csv"

# ── Required input columns ────────────────────────────────────────────────────
REQUIRED_COLUMNS = [
    "gameId", "gameDateTimeEst", "gameType", "teamId", "teamCity", "teamName",
    "win", "teamScore", "opponentScore", "assists", "steals", "blocks",
    "blocksAgainst", "fieldGoalsMade", "fieldGoalsAttempted",
    "threePointersMade", "threePointersAttempted", "freeThrowsMade",
    "freeThrowsAttempted", "reboundsOffensive", "reboundsDefensive",
    "reboundsTotal", "foulsPersonal", "personalFoulsDrawn", "turnovers",
    "plusMinusPoints", "benchPoints", "pointsFastBreak", "pointsFromTurnovers",
    "pointsInThePaint", "pointsSecondChance", "offensiveRating",
    "defensiveRating", "netRating", "assistPercentage", "assistToTurnoverRatio",
    "assistRatio", "offensiveReboundPercentage", "defensiveReboundPercentage",
    "reboundPercentage", "teamTurnoverPercentage", "effectiveFieldGoalPercentage",
    "trueShootingPercentage", "pace", "possessions",
    "opponentPointsOffTurnovers", "opponentPointsSecondChance",
    "opponentPointsFastBreak", "opponentPointsInPaint",
    "percentFieldGoalAttempts2Point", "percentFieldGoalAttempts3Point",
    "percentPoints2Point", "percentPoints3Point", "percentPointsFastBreak",
    "percentPointsFreeThrow", "percentPointsOffTurnovers", "percentPointsInPaint",
    "freeThrowAttemptRate", "opponentEffectiveFieldGoalPercentage",
    "opponentFreeThrowAttemptRate", "opponentTurnoverPercentage",
    "opponentOffensiveReboundPercentage",
]


# ── Season calculation ─────────────────────────────────────────────────────────
def assign_season(dates: pd.Series) -> pd.Series:
    """
    NBA seasons are stored as the ending (spring) year.
    Games in Oct, Nov, Dec belong to the season ending the following calendar year.
    Games in Jan-Sep belong to the season ending in the same calendar year.

    Examples:
        2025-10-20  ->  2026
        2026-01-15  ->  2026
        2026-06-10  ->  2026
    """
    dt    = pd.to_datetime(dates, utc=True)
    year  = dt.dt.year
    month = dt.dt.month
    # Months 10-12 are the start of a new season; bump year by 1
    return year.where(month < 10, year + 1)


# ── Possession-weighted average ───────────────────────────────────────────────
def weighted_mean(group: pd.DataFrame, col: str, weight_col: str = "possessions") -> float:
    """
    Returns the possession-weighted average of col within a group.
    Falls back to a simple mean if weights are missing or all zero.
    """
    vals    = group[col]
    weights = group[weight_col]

    valid = weights.notna() & (weights > 0) & vals.notna()
    if valid.sum() == 0:
        return vals.mean()

    return np.average(vals[valid], weights=weights[valid])


# ── Safe division ─────────────────────────────────────────────────────────────
def safe_div(numerator, denominator):
    """Returns NaN when denominator is zero or NaN."""
    if denominator == 0 or pd.isna(denominator):
        return np.nan
    return numerator / denominator


# ── Load & validate raw data ──────────────────────────────────────────────────
def load_raw(path: Path) -> pd.DataFrame:
    print(f"Loading raw data from: {path}")
    df = pd.read_csv(path, low_memory=False)
    print(f"  Raw rows loaded: {len(df):,}")

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        print(f"\nERROR: Missing required columns:\n  {missing}", file=sys.stderr)
        sys.exit(1)

    return df


# ── Clean & prepare ───────────────────────────────────────────────────────────
def clean(df: pd.DataFrame) -> pd.DataFrame:
    # Drop rows with no teamId or no date
    df = df.dropna(subset=["teamId", "gameDateTimeEst"]).copy()

    # Assign season based on game date
    df["season"] = assign_season(df["gameDateTimeEst"])

    # Normalise gameType: blank/null -> "Unknown"
    df["gameType"] = (
        df["gameType"]
        .fillna("Unknown")
        .astype(str)
        .str.strip()
        .replace("", "Unknown")
    )

    # Ensure win is numeric 0/1
    df["win"] = pd.to_numeric(df["win"], errors="coerce").fillna(0).astype(int)

    print(f"  Rows after cleaning: {len(df):,}")
    print(f"  Seasons found: {sorted(df['season'].unique().tolist())}")
    print(f"  Game types found: {sorted(df['gameType'].unique().tolist())}")

    return df


# ── Aggregate one group -> one row ────────────────────────────────────────────
def aggregate_group(group: pd.DataFrame) -> pd.Series:
    g = group  # alias for brevity

    # ── Identity ──────────────────────────────────────────────────────────────
    team_city = g["teamCity"].mode().iloc[0] if g["teamCity"].notna().any() else np.nan
    team_name = g["teamName"].mode().iloc[0] if g["teamName"].notna().any() else np.nan

    # ── Record ────────────────────────────────────────────────────────────────
    games_played = len(g)
    wins         = int(g["win"].sum())
    losses       = games_played - wins
    win_pct      = safe_div(wins, games_played)

    # ── Raw shooting totals (summed before recalculating percentages) ─────────
    fgm = g["fieldGoalsMade"].sum()
    fga = g["fieldGoalsAttempted"].sum()
    tpm = g["threePointersMade"].sum()
    tpa = g["threePointersAttempted"].sum()
    ftm = g["freeThrowsMade"].sum()
    fta = g["freeThrowsAttempted"].sum()
    pts = g["teamScore"].sum()

    # ── Per-game averages ─────────────────────────────────────────────────────
    def avg(col): return g[col].mean()

    # ── Advanced stats: possession-weighted averages ──────────────────────────
    adv_cols = [
        "offensiveRating", "defensiveRating", "netRating", "pace",
        "assistPercentage", "assistToTurnoverRatio", "assistRatio",
        "offensiveReboundPercentage", "defensiveReboundPercentage",
        "reboundPercentage", "teamTurnoverPercentage",
        "opponentEffectiveFieldGoalPercentage", "opponentFreeThrowAttemptRate",
        "opponentTurnoverPercentage", "opponentOffensiveReboundPercentage",
        "percentFieldGoalAttempts2Point", "percentFieldGoalAttempts3Point",
        "percentPoints2Point", "percentPoints3Point",
        "percentPointsFastBreak", "percentPointsFreeThrow",
        "percentPointsOffTurnovers", "percentPointsInPaint",
    ]
    adv = {col: weighted_mean(g, col) for col in adv_cols}

    return pd.Series({
        # Identity
        "team_id":   g["teamId"].iloc[0],
        "team_city": team_city,
        "team_name": team_name,
        "season":    g["season"].iloc[0],
        "game_type": g["gameType"].iloc[0],

        # Record
        "games_played":   games_played,
        "wins":           wins,
        "losses":         losses,
        "win_percentage": win_pct,

        # Per-game averages
        "points_per_game":                        avg("teamScore"),
        "opponent_points_per_game":               avg("opponentScore"),
        "point_diff_per_game":                    avg("plusMinusPoints"),
        "assists_per_game":                       avg("assists"),
        "steals_per_game":                        avg("steals"),
        "blocks_per_game":                        avg("blocks"),
        "blocks_against_per_game":                avg("blocksAgainst"),
        "offensive_rebounds_per_game":            avg("reboundsOffensive"),
        "defensive_rebounds_per_game":            avg("reboundsDefensive"),
        "rebounds_per_game":                      avg("reboundsTotal"),
        "personal_fouls_per_game":                avg("foulsPersonal"),
        "personal_fouls_drawn_per_game":          avg("personalFoulsDrawn"),
        "turnovers_per_game":                     avg("turnovers"),
        "bench_points_per_game":                  avg("benchPoints"),
        "fast_break_points_per_game":             avg("pointsFastBreak"),
        "points_from_turnovers_per_game":         avg("pointsFromTurnovers"),
        "points_in_paint_per_game":               avg("pointsInThePaint"),
        "second_chance_points_per_game":          avg("pointsSecondChance"),
        "opponent_points_off_turnovers_per_game": avg("opponentPointsOffTurnovers"),
        "opponent_second_chance_points_per_game": avg("opponentPointsSecondChance"),
        "opponent_fast_break_points_per_game":    avg("opponentPointsFastBreak"),
        "opponent_points_in_paint_per_game":      avg("opponentPointsInPaint"),
        "possessions_per_game":                   avg("possessions"),

        # Recalculated shooting percentages from summed totals
        "field_goal_percentage":           safe_div(fgm, fga),
        "three_point_percentage":          safe_div(tpm, tpa),
        "free_throw_percentage":           safe_div(ftm, fta),
        "effective_field_goal_percentage": safe_div(fgm + 0.5 * tpm, fga),
        "true_shooting_percentage":        safe_div(pts, 2 * (fga + 0.44 * fta)),
        "three_point_attempt_rate":        safe_div(tpa, fga),
        "free_throw_attempt_rate":         safe_div(fta, fga),

        # Possession-weighted advanced stats
        "offensive_rating":                        adv["offensiveRating"],
        "defensive_rating":                        adv["defensiveRating"],
        "net_rating":                              adv["netRating"],
        "pace":                                    adv["pace"],
        "assist_percentage":                       adv["assistPercentage"],
        "assist_to_turnover_ratio":                adv["assistToTurnoverRatio"],
        "assist_ratio":                            adv["assistRatio"],
        "offensive_rebound_percentage":            adv["offensiveReboundPercentage"],
        "defensive_rebound_percentage":            adv["defensiveReboundPercentage"],
        "rebound_percentage":                      adv["reboundPercentage"],
        "team_turnover_percentage":                adv["teamTurnoverPercentage"],
        "opponent_effective_field_goal_percentage":adv["opponentEffectiveFieldGoalPercentage"],
        "opponent_free_throw_attempt_rate":        adv["opponentFreeThrowAttemptRate"],
        "opponent_turnover_percentage":            adv["opponentTurnoverPercentage"],
        "opponent_offensive_rebound_percentage":   adv["opponentOffensiveReboundPercentage"],
        "percent_field_goal_attempts_2pt":         adv["percentFieldGoalAttempts2Point"],
        "percent_field_goal_attempts_3pt":         adv["percentFieldGoalAttempts3Point"],
        "percent_points_2pt":                      adv["percentPoints2Point"],
        "percent_points_3pt":                      adv["percentPoints3Point"],
        "percent_points_fast_break":               adv["percentPointsFastBreak"],
        "percent_points_free_throw":               adv["percentPointsFreeThrow"],
        "percent_points_off_turnovers":            adv["percentPointsOffTurnovers"],
        "percent_points_in_paint":                 adv["percentPointsInPaint"],
    })


# ── Validate output ───────────────────────────────────────────────────────────
def validate(df: pd.DataFrame):
    errors = []

    if df.empty:
        errors.append("Output dataframe is empty.")

    dupes = df.duplicated(subset=["team_id", "season", "game_type"])
    if dupes.any():
        errors.append(f"{dupes.sum()} duplicate (team_id, season, game_type) rows found.")

    if (df["games_played"] <= 0).any():
        errors.append("Some rows have games_played <= 0.")

    if df["win_percentage"].notna().any():
        out_of_range = df["win_percentage"].dropna()
        if ((out_of_range < 0) | (out_of_range > 1)).any():
            errors.append("win_percentage has values outside [0, 1].")

    pct_cols = [
        "field_goal_percentage", "three_point_percentage", "free_throw_percentage",
        "effective_field_goal_percentage", "true_shooting_percentage",
        "three_point_attempt_rate",
    ]
    for col in pct_cols:
        if col in df.columns:
            vals = df[col].dropna()
            if ((vals < 0) | (vals > 1)).any():
                errors.append(f"{col} has values outside [0, 1].")

    if errors:
        print("\nVALIDATION WARNINGS:")
        for e in errors:
            print(f"  ⚠  {e}")
    else:
        print("  Validation passed.")


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    df_raw = load_raw(INPUT_PATH)
    df     = clean(df_raw)

    print("\nAggregating to team-season-game_type profiles ...")
    profiles = (
        df.groupby(["teamId", "season", "gameType"], sort=True)
          .apply(aggregate_group)
          .reset_index(drop=True)
    )

    print(f"  Output rows: {len(profiles):,}")

    print("\nRunning validation ...")
    validate(profiles)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    profiles.to_csv(OUTPUT_PATH, index=False)
    print(f"\nSaved to: {OUTPUT_PATH}")

    print("\nSample output (first 5 rows):")
    preview_cols = [
        "team_id", "team_city", "team_name", "season", "game_type",
        "games_played", "wins", "losses", "win_percentage",
        "points_per_game", "offensive_rating", "defensive_rating", "net_rating",
    ]
    print(profiles[preview_cols].head().to_string(index=False))


if __name__ == "__main__":
    main()
