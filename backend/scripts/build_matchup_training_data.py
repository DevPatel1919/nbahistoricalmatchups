"""
build_matchup_training_data.py

Builds a historical NBA matchup training dataset.
One row = one real historical game, with completed home/away team-season
profiles attached and difference features added.

Run from repo root:
    python backend/scripts/build_matchup_training_data.py
"""

import pandas as pd
from pathlib import Path

REPO_ROOT     = Path(__file__).resolve().parents[2]
GAMES_PATH    = REPO_ROOT / "data" / "raw" / "games.csv"
PROFILES_PATH = REPO_ROOT / "data" / "processed" / "team_season_profiles_extended.csv"
OUTPUT_PATH   = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"

MODERN_ERA_START = 1997

VALID_GAME_TYPES = {"Regular Season", "Play-In", "Play-in Tournament", "Playoffs", "Playoff"}

DIFF_STATS = [
    "regular_win_pct",
    "regular_offensive_rating",
    "regular_defensive_rating",
    "regular_net_rating",
    "regular_pace",
    "regular_points_per_game",
    "regular_opponent_points_per_game",
    "regular_point_diff_per_game",
    "regular_effective_field_goal_percentage",
    "regular_true_shooting_percentage",
    "regular_rebound_percentage",
    "regular_offensive_rebound_percentage",
    "regular_defensive_rebound_percentage",
    "regular_assist_percentage",
    "regular_assist_to_turnover_ratio",
    "regular_team_turnover_percentage",
    "regular_opponent_effective_field_goal_percentage",
    "regular_opponent_turnover_percentage",
]

META_COLS = [
    "game_id",
    "season",
    "game_date",
    "game_type",
    "game_subtype",
    "home_team_id",
    "away_team_id",
    "home_team_city",
    "home_team_name",
    "away_team_city",
    "away_team_name",
    "home_win",
]


def assign_season(dates: pd.Series) -> pd.Series:
    """Oct-Dec games belong to the next calendar year's season."""
    dt = pd.to_datetime(dates, utc=True)
    return dt.dt.year.where(dt.dt.month < 10, dt.dt.year + 1)


def main():
    # Load and clean games
    games = pd.read_csv(GAMES_PATH, low_memory=False)

    games = games.rename(columns={
        "gameId":       "game_id",
        "gameType":     "game_type",
        "gameSubtype":  "game_subtype",
        "gameDateTimeEst": "game_date",
        "hometeamId":   "home_team_id",
        "awayteamId":   "away_team_id",
        "hometeamCity": "home_team_city",
        "hometeamName": "home_team_name",
        "awayteamCity": "away_team_city",
        "awayteamName": "away_team_name",
    })

    games["home_team_id"] = pd.to_numeric(games["home_team_id"], errors="coerce")
    games["away_team_id"] = pd.to_numeric(games["away_team_id"], errors="coerce")
    games["homeScore"]    = pd.to_numeric(games["homeScore"],    errors="coerce")
    games["awayScore"]    = pd.to_numeric(games["awayScore"],    errors="coerce")

    # Drop rows with missing IDs or scores
    games = games.dropna(subset=["home_team_id", "away_team_id", "homeScore", "awayScore"])

    # Filter to valid game types
    games = games[games["game_type"].isin(VALID_GAME_TYPES)].copy()

    # Assign season and filter to modern era
    games["season"] = assign_season(games["game_date"])
    games = games[games["season"] > MODERN_ERA_START].copy()

    # Label
    games["home_win"] = (games["homeScore"] > games["awayScore"]).astype(int)

    # Load profiles 
    profiles = pd.read_csv(PROFILES_PATH, low_memory=False)
    profiles["team_id"] = pd.to_numeric(profiles["team_id"], errors="coerce")

    # Drop team_city / team_name from profiles before merge to avoid collision
    # (we already have them from games under home_team_city etc.)
    profile_cols = [c for c in profiles.columns if c not in ("team_city", "team_name")]
    profiles = profiles[profile_cols]

    stat_cols = [c for c in profiles.columns if c not in ("team_id", "season")]

    # Merge home team profile
    home_profiles = profiles.rename(
        columns={c: "home_" + c for c in stat_cols}
    ).rename(columns={"team_id": "home_team_id"})

    out = games.merge(home_profiles, on=["home_team_id", "season"], how="inner")

    # Merge away team profile
    away_profiles = profiles.rename(
        columns={c: "away_" + c for c in stat_cols}
    ).rename(columns={"team_id": "away_team_id"})

    out = out.merge(away_profiles, on=["away_team_id", "season"], how="inner")

    # Difference features 
    for stat in DIFF_STATS:
        home_col = "home_" + stat
        away_col = "away_" + stat
        if home_col in out.columns and away_col in out.columns:
            out[stat + "_diff"] = out[home_col] - out[away_col]

    # Column ordering 
    home_stat_cols = sorted([c for c in out.columns if c.startswith("home_") and c not in META_COLS])
    away_stat_cols = sorted([c for c in out.columns if c.startswith("away_") and c not in META_COLS])
    diff_cols      = sorted([c for c in out.columns if c.endswith("_diff")])

    # homeScore/awayScore/winner kept at end for debugging only
    debug_cols = [c for c in ("homeScore", "awayScore", "winner") if c in out.columns]

    out = out[META_COLS + home_stat_cols + away_stat_cols + diff_cols + debug_cols]

    # Sort 
    out = out.sort_values(["season", "game_date"]).reset_index(drop=True)

    # Validate 
    if out.empty:
        raise ValueError("Output is empty.")

    if out.duplicated(subset=["game_id"]).any():
        dupes = out[out.duplicated(subset=["game_id"], keep=False)][["game_id", "season"]]
        raise ValueError("Duplicate game_id rows found:\n" + str(dupes))

    if out.duplicated().any():
        raise ValueError("Duplicate full rows found -- bad merge.")

    for col in ("home_regular_games_played", "away_regular_games_played", "home_win",
                "home_team_id", "away_team_id", "season"):
        if out[col].isna().any():
            raise ValueError("Nulls in required column: " + col)

    # Save 
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT_PATH, index=False)

    print("Matchup training rows: " + str(len(out)))
    print("Seasons: " + str(out["season"].nunique())
          + "  (" + str(out["season"].min()) + "-" + str(out["season"].max()) + ")")
    print("Columns: " + str(len(out.columns)))
    print("home_win rate: " + str(round(out["home_win"].mean(), 4)))
    print("Written to: " + str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
