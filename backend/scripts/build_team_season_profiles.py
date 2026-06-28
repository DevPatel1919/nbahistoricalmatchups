"""
build_team_season_profiles.py

Aggregates per-game team stats into one row per team per season.
Only includes teams present in team_histories_cleaned.csv.
Only includes Regular Season games.

Run from repo root:
    python backend/scripts/build_team_season_profiles.py
"""

import pandas as pd
from pathlib import Path

REPO_ROOT         = Path(__file__).resolve().parents[2]
STATS_PATH        = REPO_ROOT / "data" / "raw" / "TeamStatistics.csv"
TEAM_HISTORY_PATH = REPO_ROOT / "data" / "processed" / "team_histories_cleaned.csv"
OUTPUT_PATH       = REPO_ROOT / "data" / "processed" / "team_season_profiles.csv"

MODERN_ERA_START  = 1997


def assign_season(dates: pd.Series) -> pd.Series:
    dt = pd.to_datetime(dates, utc=True)
    return dt.dt.year.where(dt.dt.month < 10, dt.dt.year + 1)


def main():
    #process and clean data and df is what stores all the data also assign certain columns to numerical so we can calculate our stats
    histories = pd.read_csv(TEAM_HISTORY_PATH)
    allowed_ids = set(pd.to_numeric(histories["team_id"], errors="coerce").dropna().astype(int))

    df = pd.read_csv(STATS_PATH, low_memory=False)
    df["teamId"] = pd.to_numeric(df["teamId"], errors="coerce")
    df = df[df["gameType"] == "Regular Season"].copy()
    df = df[df["teamId"].isin(allowed_ids)].copy()

    df["season"] = assign_season(df["gameDateTimeEst"])
    df = df[df["season"] > MODERN_ERA_START].copy()

    df["win"] = pd.to_numeric(df["win"], errors="coerce").fillna(0).astype(int)

    #define a function that can give a percentage on shots
    def safe_pct(made, attempted):
        return made.sum() / attempted.sum() if attempted.sum() > 0 else None
    
    # finding unique team + season combinations for each team and fill out each profile with given stats
    profiles = []
    for (team_id, season), g in df.groupby(["teamId", "season"]):
        games   = len(g)
        wins    = g["win"].sum()
        losses  = games - wins

        profiles.append({
            "season":                   season,
            "team_id":                  int(team_id),
            "team_city":                g["teamCity"].mode().iloc[0],
            "team_name":                g["teamName"].mode().iloc[0],
            "games_played":             games,
            "wins":                     wins,
            "losses":                   losses,
            "win_pct":                  round(wins / games, 4) if games > 0 else None,
            "points_per_game":          round(g["teamScore"].mean(), 2),
            "opponent_points_per_game": round(g["opponentScore"].mean(), 2),
            "point_diff_per_game":      round(g["plusMinusPoints"].mean(), 2),
            "fg_pct":                   round(safe_pct(g["fieldGoalsMade"], g["fieldGoalsAttempted"]), 4),
            "three_pt_pct":             round(safe_pct(g["threePointersMade"], g["threePointersAttempted"]), 4),
            "ft_pct":                   round(safe_pct(g["freeThrowsMade"], g["freeThrowsAttempted"]), 4),
            "rebounds_per_game":        round(g["reboundsTotal"].mean(), 2),
            "offensive_rebounds_per_game": round(g["reboundsOffensive"].mean(), 2),
            "defensive_rebounds_per_game": round(g["reboundsDefensive"].mean(), 2),
            "assists_per_game":         round(g["assists"].mean(), 2),
            "steals_per_game":          round(g["steals"].mean(), 2),
            "blocks_per_game":          round(g["blocks"].mean(), 2),
            "turnovers_per_game":       round(g["turnovers"].mean(), 2),
            "fouls_per_game":           round(g["foulsPersonal"].mean(), 2),
            "bench_points_per_game":    round(g["benchPoints"].mean(), 2),
            "fast_break_points_per_game":   round(g["pointsFastBreak"].mean(), 2),
            "points_in_paint_per_game":     round(g["pointsInThePaint"].mean(), 2),
            "points_off_turnovers_per_game": round(g["pointsFromTurnovers"].mean(), 2),
            "second_chance_points_per_game": round(g["pointsSecondChance"].mean(), 2),
        })

    out = pd.DataFrame(profiles)
    out = out.drop_duplicates(subset=["team_id", "season"])
    out = out.sort_values(["season", "team_name"]).reset_index(drop=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT_PATH, index=False)

    print(f"Team-season profiles: {len(out)}")
    print(f"Seasons:              {out['season'].nunique()}  ({out['season'].min()}–{out['season'].max()})")
    print(f"Teams:                {out['team_id'].nunique()}")
    print(f"Written to:           {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
