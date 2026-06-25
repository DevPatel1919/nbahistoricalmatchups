"""
clean_team_histories.py

Filters raw team histories to only NBA teams active from 1997 onward,
excluding All-Star and exhibition entries.

Run from repo root:
    python backend/scripts/clean_team_histories.py
"""

import sys
import pandas as pd
from pathlib import Path

REPO_ROOT   = Path(__file__).resolve().parents[2]
INPUT_PATH  = REPO_ROOT / "data" / "raw" / "TeamHistories.csv"
OUTPUT_PATH = REPO_ROOT / "data" / "processed" / "team_histories_cleaned.csv"

#all star games are not needed 
ALL_STAR_PATTERNS = ["all-star", "all star", "all-stars", "all stars", "nba all",
                     "team lebron", "team durant", "team giannis", "team stephen", "team curry"]

MODERN_ERA_START = 1997


def main():
    df = pd.read_csv(INPUT_PATH)
    df.columns = df.columns.str.strip()
    df = df.apply(lambda col: col.str.strip() if col.dtype == "object" else col)

    print(f"Input rows: {len(df)}")

    is_nba = df["league"] == "NBA"
    is_modern = pd.to_numeric(df["seasonActiveTill"], errors="coerce") > MODERN_ERA_START

    city_lower = df["teamCity"].fillna("").str.lower()
    name_lower = df["teamName"].fillna("").str.lower()
    is_all_star = pd.Series(False, index=df.index)
    for pattern in ALL_STAR_PATTERNS:
        is_all_star |= city_lower.str.contains(pattern, regex=False)
        is_all_star |= name_lower.str.contains(pattern, regex=False)

    df = df[is_nba & is_modern & ~is_all_star].copy()

    df = df.rename(columns={
        "teamId":           "team_id",
        "teamCity":         "team_city",
        "teamName":         "team_name",
        "teamAbbrev":       "team_abbrev",
        "seasonFounded":    "season_founded",
        "seasonActiveTill": "season_active_till",
    })

    df = df[["team_id", "team_city", "team_name", "team_abbrev",
             "season_founded", "season_active_till", "league"]]

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_PATH, index=False)

    print(f"Output rows: {len(df)}")
    print(f"Written to: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
