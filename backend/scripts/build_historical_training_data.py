"""
build_historical_training_data.py

Builds hist-v2's training data: one row per real game from 1986-87 to
2025-26, with both teams' point-in-time profiles and their era-relative
(_z) versions. Written to data/processed/historical_training_data.csv.

It reuses the duel builder's point-in-time logic unchanged
(build_matchup_training_data.load_games and attach_point_in_time_profiles),
on hist-v2's per-game rows:
  - load_team_games(..., fill_game_types=True): 2000-01 and 2021-22 game types
    filled from Games.csv, and playoff games labelled with the calendar year
    they were played in (the 2020 bubble Finals stay in 2020);
  - load_games(..., playoffs_by_year=True): the same season rule for games.

Each RELATIVE_STATS profile stat gets home_<stat>_z and away_<stat>_z,
measured against the PREVIOUS season's league (league_reference over
full-season profiles): a game only ever sees a season that had finished.
1985-86 has no previous season, so its games are left out; it is only the
reference for 1986-87. The Elo/form/rest merge of matchup_training_data.csv is
skipped: the historical simulator does not read it.

matchup_training_data.csv (duel mode, pre-game model) is not read or written.

Run from repo root (after clean_team_histories.py):
    python backend/scripts/build_historical_training_data.py
"""

import pandas as pd
from pathlib import Path

from build_matchup_training_data import (
    DIFF_STATS,
    META_COLS,
    attach_point_in_time_profiles,
    load_games,
)
from build_team_season_profiles_extended import (
    OLDER_ERA_START,
    RELATIVE_STATS,
    RELATIVE_SUFFIX,
    add_relative_columns,
    build_season_profiles,
    league_reference,
    load_allowed_team_ids,
    load_team_games,
)

REPO_ROOT   = Path(__file__).resolve().parents[2]
OUTPUT_PATH = REPO_ROOT / "data" / "processed" / "historical_training_data.csv"

FIRST_PROFILE_SEASON = OLDER_ERA_START + 1        # 1986: a reference only
FIRST_GAME_SEASON    = FIRST_PROFILE_SEASON + 1   # 1987: the first with a previous season

# A previous season is only a usable reference with a full league of
# full-length seasons (1998-99, the shortest, had 50 games).
MIN_REFERENCE_TEAMS = 20
MIN_REFERENCE_GAMES = 45

# Raw differences train_model_experiments.add_derived_features adds
# (its PLAYOFF_CONTEXT_STATS), on top of DIFF_STATS.
PLAYOFF_CONTEXT_DIFF_STATS = [
    "made_playoffs",
    "made_play_in",
    "playoff_win_pct",
    "playoff_net_rating",
    "playoff_offensive_rating",
    "playoff_defensive_rating",
    "playoff_true_shooting_percentage",
]


def check_reference(profiles: pd.DataFrame, seasons) -> None:
    """Raise if any season a game is measured against is not a full league."""
    size = profiles.groupby("season").agg(teams=("team_id", "size"), games=("regular_games_played", "mean"))
    for season in sorted(set(seasons)):
        if season not in size.index:
            raise ValueError("No full-season profiles for reference season " + str(season) + ".")
        teams, games = int(size.loc[season, "teams"]), float(size.loc[season, "games"])
        if teams < MIN_REFERENCE_TEAMS or games < MIN_REFERENCE_GAMES:
            raise ValueError("Reference season " + str(season) + " has " + str(teams) + " team-seasons averaging "
                             + str(round(games, 1)) + " regular-season games; it cannot stand for its league.")


def build_historical_training_data() -> pd.DataFrame:
    allowed_ids = load_allowed_team_ids()
    stats    = load_team_games(FIRST_PROFILE_SEASON, allowed_ids, fill_game_types=True)
    profiles = build_season_profiles(stats)
    games    = load_games(FIRST_GAME_SEASON, allowed_ids, playoffs_by_year=True)

    out = attach_point_in_time_profiles(games, stats)

    # Era-relative inputs against the previous, finished season
    ref_seasons = out["season"] - 1
    check_reference(profiles, ref_seasons)
    reference = league_reference(profiles)
    for side in ("home", "away"):
        out = add_relative_columns(out, ref_seasons, reference, prefix=side + "_")

    # Difference features
    diffs = {}
    for stat in DIFF_STATS + PLAYOFF_CONTEXT_DIFF_STATS + [s + RELATIVE_SUFFIX for s in RELATIVE_STATS]:
        if "home_" + stat in out.columns and "away_" + stat in out.columns:
            diffs[stat + "_diff"] = out["home_" + stat] - out["away_" + stat]
    out = pd.concat([out, pd.DataFrame(diffs, index=out.index)], axis=1)

    # Column ordering
    home_stat_cols = sorted([c for c in out.columns if c.startswith("home_") and c not in META_COLS])
    away_stat_cols = sorted([c for c in out.columns if c.startswith("away_") and c not in META_COLS])
    diff_cols      = sorted([c for c in out.columns if c.endswith("_diff")])
    debug_cols     = [c for c in ("homeScore", "awayScore", "winner") if c in out.columns]
    out = out[META_COLS + home_stat_cols + away_stat_cols + diff_cols + debug_cols]
    out = out.sort_values(["season", "game_date"]).reset_index(drop=True)

    # Validate
    if out.empty:
        raise ValueError("Output is empty.")
    if out["game_id"].duplicated().any():
        raise ValueError("Duplicate game_id rows found.")
    for col in ("home_regular_games_played", "away_regular_games_played", "home_win",
                "home_team_id", "away_team_id", "season", "homeScore", "awayScore"):
        if out[col].isna().any():
            raise ValueError("Nulls in required column: " + col)
    if out["season"].min() < FIRST_GAME_SEASON:
        raise ValueError("Rows before " + str(FIRST_GAME_SEASON) + " have no previous-season reference.")

    return out


def main():
    out = build_historical_training_data()

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT_PATH, index=False)

    per_season = out.groupby("season").size()
    print("Historical training rows: " + str(len(out)))
    print("Seasons: " + str(out["season"].nunique())
          + "  (" + str(out["season"].min()) + "-" + str(out["season"].max()) + ")")
    print("Fewest games in a season: " + str(int(per_season.min())) + " (" + str(int(per_season.idxmin())) + ")")
    print("2022 games: " + str(int(per_season.get(2022, 0))))
    print("Columns: " + str(len(out.columns)))
    print("home_win rate: " + str(round(out["home_win"].mean(), 4)))
    print("Written to: " + str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
