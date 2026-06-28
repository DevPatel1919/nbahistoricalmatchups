"""
build_team_season_profiles_extended.py

Aggregates per-game team stats from TeamStatisticsExtended.csv into one
ML-ready row per team per season.

Each row contains three prefixed stat blocks:
  regular_*  - Regular Season
  play_in_*  - Play-In Tournament
  playoff_*  - Playoffs

Plus binary flags: made_play_in, made_playoffs.

Only teams present in team_histories_cleaned.csv are included.
Only seasons after 1997 are included.

Run from repo root:
    python backend/scripts/build_team_season_profiles_extended.py
"""

import pandas as pd
from pathlib import Path

REPO_ROOT         = Path(__file__).resolve().parents[2]
STATS_PATH        = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
TEAM_HISTORY_PATH = REPO_ROOT / "data" / "processed" / "team_histories_cleaned.csv"
OUTPUT_PATH       = REPO_ROOT / "data" / "processed" / "team_season_profiles_extended.csv"

MODERN_ERA_START  = 1997

GAME_TYPE_REGULAR = "Regular Season"
GAME_TYPE_PLAY_IN = "Play-in Tournament"
GAME_TYPE_PLAYOFF = "Playoffs"


def assign_season(dates: pd.Series) -> pd.Series:
    """Oct-Dec games belong to the next calendar year's season."""
    dt = pd.to_datetime(dates, utc=True)
    return dt.dt.year.where(dt.dt.month < 10, dt.dt.year + 1)


def safe_pct(made: pd.Series, attempted: pd.Series):
    total_att = attempted.sum()
    return round(float(made.sum()) / float(total_att), 4) if total_att > 0 else None


def build_profiles(df: pd.DataFrame, prefix: str) -> pd.DataFrame:
    """
    Aggregate per-game rows into one row per (teamId, season).

    Shooting percentages are derived from summed made/attempted totals.
    Extended rating/pace stats are averaged across games.

    Returns a DataFrame with columns renamed to {prefix}_{stat}.
    """
    records = []

    for (team_id, season), g in df.groupby(["teamId", "season"]):
        games  = len(g)
        wins   = int(g["win"].sum())
        losses = games - wins

        rec = {
            "team_id": int(team_id),
            "season":  season,

            # Core counts
            prefix + "_games_played": games,
            prefix + "_wins":         wins,
            prefix + "_losses":       losses,
            prefix + "_win_pct":      round(wins / games, 4) if games > 0 else None,

            # Scoring
            prefix + "_points_per_game":          round(g["teamScore"].mean(), 2),
            prefix + "_opponent_points_per_game": round(g["opponentScore"].mean(), 2),
            prefix + "_point_diff_per_game":      round(g["plusMinusPoints"].mean(), 2),

            # Shooting (from summed made/attempted)
            prefix + "_fg_pct":       safe_pct(g["fieldGoalsMade"],    g["fieldGoalsAttempted"]),
            prefix + "_three_pt_pct": safe_pct(g["threePointersMade"], g["threePointersAttempted"]),
            prefix + "_ft_pct":       safe_pct(g["freeThrowsMade"],    g["freeThrowsAttempted"]),

            # Rebounds
            prefix + "_rebounds_per_game":           round(g["reboundsTotal"].mean(), 2),
            prefix + "_offensive_rebounds_per_game": round(g["reboundsOffensive"].mean(), 2),
            prefix + "_defensive_rebounds_per_game": round(g["reboundsDefensive"].mean(), 2),

            # Other box-score
            prefix + "_assists_per_game":   round(g["assists"].mean(), 2),
            prefix + "_steals_per_game":    round(g["steals"].mean(), 2),
            prefix + "_blocks_per_game":    round(g["blocks"].mean(), 2),
            prefix + "_turnovers_per_game": round(g["turnovers"].mean(), 2),
            prefix + "_fouls_per_game":     round(g["foulsPersonal"].mean(), 2),

            # Situational scoring
            prefix + "_bench_points_per_game":         round(g["benchPoints"].mean(), 2),
            prefix + "_fast_break_points_per_game":    round(g["pointsFastBreak"].mean(), 2),
            prefix + "_points_in_paint_per_game":      round(g["pointsInThePaint"].mean(), 2),
            prefix + "_points_off_turnovers_per_game": round(g["pointsFromTurnovers"].mean(), 2),
            prefix + "_second_chance_points_per_game": round(g["pointsSecondChance"].mean(), 2),

            # Extended / advanced (averaged; already rate-based per game)
            prefix + "_offensive_rating":                       round(g["offensiveRating"].mean(), 2),
            prefix + "_defensive_rating":                       round(g["defensiveRating"].mean(), 2),
            prefix + "_net_rating":                             round(g["netRating"].mean(), 2),
            prefix + "_pace":                                   round(g["pace"].mean(), 2),
            prefix + "_possessions_per_game":                   round(g["possessions"].mean(), 2),
            prefix + "_assist_percentage":                      round(g["assistPercentage"].mean(), 4),
            prefix + "_assist_to_turnover_ratio":               round(g["assistToTurnoverRatio"].mean(), 4),
            prefix + "_assist_ratio":                           round(g["assistRatio"].mean(), 4),
            prefix + "_offensive_rebound_percentage":           round(g["offensiveReboundPercentage"].mean(), 4),
            prefix + "_defensive_rebound_percentage":           round(g["defensiveReboundPercentage"].mean(), 4),
            prefix + "_rebound_percentage":                     round(g["reboundPercentage"].mean(), 4),
            prefix + "_team_turnover_percentage":               round(g["teamTurnoverPercentage"].mean(), 4),
            prefix + "_effective_field_goal_percentage":        round(g["effectiveFieldGoalPercentage"].mean(), 4),
            prefix + "_true_shooting_percentage":               round(g["trueShootingPercentage"].mean(), 4),
            prefix + "_opponent_effective_field_goal_percentage": round(g["opponentEffectiveFieldGoalPercentage"].mean(), 4),
            prefix + "_opponent_free_throw_attempt_rate":       round(g["opponentFreeThrowAttemptRate"].mean(), 4),
            prefix + "_opponent_turnover_percentage":           round(g["opponentTurnoverPercentage"].mean(), 4),
            prefix + "_opponent_offensive_rebound_percentage":  round(g["opponentOffensiveReboundPercentage"].mean(), 4),
        }

        records.append(rec)

    return pd.DataFrame(records)


def main():
    # 1. Load allowed team IDs from cleaned histories
    histories   = pd.read_csv(TEAM_HISTORY_PATH)
    allowed_ids = set(
        pd.to_numeric(histories["team_id"], errors="coerce").dropna().astype(int)
    )

    # 2. Load extended stats
    df = pd.read_csv(STATS_PATH, low_memory=False)

    # 3. Convert key columns to numeric
    df["teamId"] = pd.to_numeric(df["teamId"], errors="coerce")
    df["win"]    = pd.to_numeric(df["win"],    errors="coerce").fillna(0).astype(int)

    # 4. Filter to allowed teams
    df = df[df["teamId"].isin(allowed_ids)].copy()

    # 5. Assign NBA season
    df["season"] = assign_season(df["gameDateTimeEst"])

    # 6. Keep only modern era
    df = df[df["season"] > MODERN_ERA_START].copy()

    # 7. Split by game type
    regular_df = df[df["gameType"] == GAME_TYPE_REGULAR].copy()
    play_in_df = df[df["gameType"] == GAME_TYPE_PLAY_IN].copy()
    playoff_df = df[df["gameType"] == GAME_TYPE_PLAYOFF].copy()

    # 8. Aggregate each separately
    regular_profiles = build_profiles(regular_df, "regular")
    play_in_profiles = build_profiles(play_in_df, "play_in")
    playoff_profiles = build_profiles(playoff_df, "playoff")

    # 9. Attach team city/name from regular season (use last game of season for each team)
    team_meta = (
        regular_df.sort_values("gameDateTimeEst")
        .groupby("teamId")[["teamCity", "teamName"]]
        .last()
        .reset_index()
        .rename(columns={
            "teamId":   "team_id",
            "teamCity": "team_city",
            "teamName": "team_name",
        })
    )
    regular_profiles = regular_profiles.merge(team_meta, on="team_id", how="left")

    # 10. Merge: regular as base, left-join play-in and playoff
    out = regular_profiles.merge(
        play_in_profiles, on=["team_id", "season"], how="left"
    ).merge(
        playoff_profiles, on=["team_id", "season"], how="left"
    )

    # 11. Fill play_in_* and playoff_* numeric columns with 0 for non-participants
    play_in_cols = [c for c in out.columns if c.startswith("play_in_")]
    playoff_cols = [c for c in out.columns if c.startswith("playoff_")]
    out[play_in_cols] = out[play_in_cols].fillna(0)
    out[playoff_cols] = out[playoff_cols].fillna(0)

    # 12. Binary participation flags
    out["made_play_in"] = (out["play_in_games_played"] > 0).astype(int)
    out["made_playoffs"] = (out["playoff_games_played"] > 0).astype(int)

    # 13. Column ordering: metadata, regular, play_in, playoff, flags
    meta_cols         = ["season", "team_id", "team_city", "team_name"]
    flag_cols         = ["made_play_in", "made_playoffs"]
    regular_cols      = sorted([c for c in out.columns if c.startswith("regular_")])
    play_in_stat_cols = sorted([c for c in out.columns if c.startswith("play_in_")])
    playoff_stat_cols = sorted([c for c in out.columns if c.startswith("playoff_")])

    out = out[meta_cols + regular_cols + play_in_stat_cols + playoff_stat_cols + flag_cols]

    # 14. Sort
    out = out.sort_values(["season", "team_name"]).reset_index(drop=True)

    # 15. Validation
    if out.empty:
        raise ValueError("Output is empty -- check input paths and filters.")

    dupes = out.duplicated(subset=["team_id", "season"])
    if dupes.any():
        raise ValueError(
            "Duplicate team_id + season rows found:\n"
            + str(out[dupes][["team_id", "season"]])
        )

    bad_rows = out[out["regular_games_played"] <= 0]
    if not bad_rows.empty:
        raise ValueError(
            str(len(bad_rows)) + " rows have regular_games_played <= 0."
        )

    # 16. Save
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT_PATH, index=False)

    print("Team-season profiles (extended): " + str(len(out)))
    print("Seasons:  " + str(out["season"].nunique())
          + "  (" + str(out["season"].min()) + "-" + str(out["season"].max()) + ")")
    print("Teams:    " + str(out["team_id"].nunique()))
    print("Columns:  " + str(len(out.columns)))
    print("Play-in participants:  " + str(out["made_play_in"].sum()) + " team-seasons")
    print("Playoff participants:  " + str(out["made_playoffs"].sum()) + " team-seasons")
    print("Written to: " + str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
