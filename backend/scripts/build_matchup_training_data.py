"""
build_matchup_training_data.py

Builds a historical NBA matchup training dataset.
One row = one real historical game, with home/away team profiles attached and
difference features added.

Profiles are point-in-time: each team's regular_*, play_in_* and playoff_*
stats are aggregated only from that team's games in the same season that
tipped off BEFORE the game being described. A game never sees its own result
or any later result. (The season-level profiles in
team_season_profiles_extended.csv include every game of the season and are
only safe as prediction inputs, not as training features.)

Run from repo root (after build_team_season_profiles_extended.py and
build_pregame_features.py):
    python backend/scripts/build_matchup_training_data.py
"""

import pandas as pd
from pathlib import Path

from build_team_season_profiles_extended import (
    GAME_TYPE_PLAY_IN,
    GAME_TYPE_PLAYOFF,
    GAME_TYPE_REGULAR,
    MEAN_STATS,
    PCT_STATS,
)

REPO_ROOT         = Path(__file__).resolve().parents[2]
GAMES_PATH        = REPO_ROOT / "data" / "raw" / "games.csv"
STATS_PATH        = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
TEAM_HISTORY_PATH = REPO_ROOT / "data" / "processed" / "team_histories_cleaned.csv"
PREGAME_PATH      = REPO_ROOT / "data" / "processed" / "pregame_team_features.csv"
OUTPUT_PATH       = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"

PROFILE_BLOCKS = [
    ("regular", GAME_TYPE_REGULAR),
    ("play_in", GAME_TYPE_PLAY_IN),
    ("playoff", GAME_TYPE_PLAYOFF),
]

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


def parse_game_time(dates: pd.Series) -> pd.Series:
    """Naive EST timestamps; some rows omit the leading zero on the hour."""
    return pd.to_datetime(dates, format="mixed")


def cumulative_profiles(stats: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """
    Running per-(team, season) profile for one game type.

    Each row holds the profile AFTER that game (the game itself included), so
    callers must attach it strictly before the game they describe.
    """
    stats = stats.sort_values(["teamId", "game_time"]).reset_index(drop=True)
    grp   = stats.groupby(["teamId", "season"])

    out = stats[["teamId", "season", "game_time"]].copy()
    games = grp.cumcount() + 1
    wins  = grp["win"].cumsum()
    out[prefix + "_games_played"] = games
    out[prefix + "_wins"]         = wins
    out[prefix + "_losses"]       = games - wins
    out[prefix + "_win_pct"]      = wins / games

    def running_sum(col):
        return stats[col].fillna(0).groupby([stats["teamId"], stats["season"]]).cumsum()

    for name, (made, att) in PCT_STATS.items():
        total_att = running_sum(att)
        out[prefix + "_" + name] = (running_sum(made) / total_att).where(total_att > 0)

    for name, (col, _digits) in MEAN_STATS.items():
        count = stats[col].notna().astype(int).groupby([stats["teamId"], stats["season"]]).cumsum()
        out[prefix + "_" + name] = (running_sum(col) / count).where(count > 0)

    return out


def attach_pregame_profile(games: pd.DataFrame, profile: pd.DataFrame, side: str) -> pd.DataFrame:
    """Attach the latest profile row strictly before each game for home or away team."""
    id_col = side + "_team_id"
    right  = profile.rename(columns={"teamId": id_col, "game_time": "_profile_time"})
    right  = right.rename(columns={
        c: side + "_" + c for c in right.columns if c not in (id_col, "season", "_profile_time")
    })
    merged = pd.merge_asof(
        games.sort_values("game_time"),
        right.sort_values("_profile_time"),
        left_on="game_time",
        right_on="_profile_time",
        by=[id_col, "season"],
        allow_exact_matches=False,   # never include the game itself
        direction="backward",
    )
    return merged.drop(columns="_profile_time")


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

    # Load per-team-game stats used to build point-in-time profiles
    histories   = pd.read_csv(TEAM_HISTORY_PATH)
    allowed_ids = set(pd.to_numeric(histories["team_id"], errors="coerce").dropna().astype(int))

    stats = pd.read_csv(STATS_PATH, low_memory=False)
    stats["teamId"]    = pd.to_numeric(stats["teamId"], errors="coerce")
    stats["win"]       = pd.to_numeric(stats["win"],    errors="coerce").fillna(0).astype(int)
    stats              = stats[stats["teamId"].isin(allowed_ids)].copy()
    stats["season"]    = assign_season(stats["gameDateTimeEst"])
    stats              = stats[stats["season"] > MODERN_ERA_START].copy()
    stats["game_time"] = parse_game_time(stats["gameDateTimeEst"])

    # Use the stats file's timestamp for each game so a game's own stat row can
    # never sort before it (games.csv and the stats file disagree on a few dates).
    stats_time = stats.drop_duplicates("gameId").set_index("gameId")["game_time"]
    games = games[games["home_team_id"].isin(allowed_ids) & games["away_team_id"].isin(allowed_ids)].copy()
    games["game_time"] = games["game_id"].map(stats_time).fillna(parse_game_time(games["game_date"]))

    out = games
    for prefix, game_type in PROFILE_BLOCKS:
        profile = cumulative_profiles(stats[stats["gameType"] == game_type], prefix)
        for side in ("home", "away"):
            out = attach_pregame_profile(out, profile, side)
    out = out.copy()  # defragment after the many asof merges

    flags = {}
    for side in ("home", "away"):
        # No prior games of a type -> zero counts; play-in/playoff stats also 0,
        # matching team_season_profiles_extended.csv for non-participants.
        for prefix, _ in PROFILE_BLOCKS:
            for c in ("_games_played", "_wins", "_losses"):
                out[side + "_" + prefix + c] = out[side + "_" + prefix + c].fillna(0).astype(int)
        for prefix in ("play_in", "playoff"):
            cols = [c for c in out.columns if c.startswith(side + "_" + prefix + "_")]
            out[cols] = out[cols].fillna(0)

        # Participation flags as known at tip-off
        flags[side + "_made_play_in"] = (
            out["game_type"].isin({"Play-In", "Play-in Tournament"})
            | (out[side + "_play_in_games_played"] > 0)
        ).astype(int)
        flags[side + "_made_playoffs"] = (
            out["game_type"].isin({"Playoffs", "Playoff"})
            | (out[side + "_playoff_games_played"] > 0)
        ).astype(int)
    out = pd.concat([out, pd.DataFrame(flags, index=out.index)], axis=1)

    # Teams with no regular-season stats that season (old inner-join behavior)
    for side in ("home", "away"):
        has_season = stats[stats["gameType"] == GAME_TYPE_REGULAR][["teamId", "season"]].drop_duplicates()
        has_season = has_season.rename(columns={"teamId": side + "_team_id"})
        out = out.merge(has_season, on=[side + "_team_id", "season"], how="inner")

    # Elo / form / rest / lineup features (from build_pregame_features.py)
    pregame = pd.read_csv(PREGAME_PATH)
    pregame_cols = [c for c in pregame.columns if c not in ("game_id", "team_id")]
    for side in ("home", "away"):
        out = out.merge(
            pregame.rename(columns={"team_id": side + "_team_id", **{c: side + "_" + c for c in pregame_cols}}),
            on=["game_id", side + "_team_id"], how="left",
        )

    # Difference features 
    for stat in DIFF_STATS + pregame_cols:
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
