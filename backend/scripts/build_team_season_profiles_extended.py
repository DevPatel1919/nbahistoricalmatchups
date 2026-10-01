"""
build_team_season_profiles_extended.py

Aggregates per-game team stats into one ML-ready row per team per season.

Per-game source (load_team_games):
  1996-97 onward      - TeamStatisticsExtended.csv, with the NBA's own advanced
                        values (offensiveRating, pace, trueShootingPercentage, ...)
  1985-86 to 1995-96  - TeamStatistics.csv. The Extended file does not cover
                        these seasons, so each advanced stat is computed from
                        the basic box score with BOX_SCORE_FORMULAS. Situational
                        scoring (bench, fast-break, paint, second-chance and
                        off-turnover points) was not recorded then, and the
                        NBA's rebound percentages cannot be reproduced from the
                        box score (UNMATCHED_FORMULA_COLS); both are left blank.

Each row contains three prefixed stat blocks:
  regular_*  - Regular Season
  play_in_*  - Play-In Tournament
  playoff_*  - Playoffs

Plus binary flags: made_play_in, made_playoffs.

Only teams present in team_histories_cleaned.csv are included.
By default only seasons after 1997 are written (the seasons served today).
--since accepts any season from 1986 (1985-86) on.

Run from repo root:
    python backend/scripts/build_team_season_profiles_extended.py
    python backend/scripts/build_team_season_profiles_extended.py --since 1986 --output <csv>
"""

import argparse

import numpy as np
import pandas as pd
from pathlib import Path

REPO_ROOT         = Path(__file__).resolve().parents[2]
STATS_PATH        = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
BASIC_STATS_PATH  = REPO_ROOT / "data" / "raw" / "TeamStatistics.csv"
GAMES_TABLE_PATH  = REPO_ROOT / "data" / "raw" / "Games.csv"
TEAM_HISTORY_PATH = REPO_ROOT / "data" / "processed" / "team_histories_cleaned.csv"
OUTPUT_PATH       = REPO_ROOT / "data" / "processed" / "team_season_profiles_extended.csv"

MODERN_ERA_START     = 1997   # default output: seasons after this (1997-98 on)
OLDER_ERA_START      = 1985   # earliest supported: seasons after this (1985-86 on)
EXTENDED_STATS_START = 1996   # TeamStatisticsExtended.csv covers seasons after this

GAME_TYPE_REGULAR = "Regular Season"
GAME_TYPE_PLAY_IN = "Play-in Tournament"
GAME_TYPE_PLAYOFF = "Playoffs"


def assign_season(dates: pd.Series) -> pd.Series:
    """Oct-Dec games belong to the next calendar year's season."""
    dt = pd.to_datetime(dates, utc=True)
    return dt.dt.year.where(dt.dt.month < 10, dt.dt.year + 1)


# Game types whose season is the calendar year they were played in. Playoffs
# never cross into a new season, but the 2020 bubble Finals ran into October
# 2020, which assign_season labels 2021. hist-v2 data only (fill_game_types);
# the duel and pre-game scripts keep assign_season as it is.
CALENDAR_SEASON_GAME_TYPES = {"Playoffs", "Playoff", "Play-in Tournament", "Play-In"}


def assign_season_playoffs_by_year(dates: pd.Series, game_types: pd.Series) -> pd.Series:
    """assign_season, except playoff and play-in games take the calendar year they were played in."""
    dt = pd.to_datetime(dates, utc=True)
    return assign_season(dates).where(~game_types.isin(CALENDAR_SEASON_GAME_TYPES), dt.dt.year)


# Per-game stats averaged across games: output name -> (source column, rounding digits)
MEAN_STATS = {
    # Scoring
    "points_per_game":          ("teamScore",       2),
    "opponent_points_per_game": ("opponentScore",   2),
    "point_diff_per_game":      ("plusMinusPoints", 2),

    # Rebounds
    "rebounds_per_game":           ("reboundsTotal",     2),
    "offensive_rebounds_per_game": ("reboundsOffensive", 2),
    "defensive_rebounds_per_game": ("reboundsDefensive", 2),

    # Other box-score
    "assists_per_game":   ("assists",       2),
    "steals_per_game":    ("steals",        2),
    "blocks_per_game":    ("blocks",        2),
    "turnovers_per_game": ("turnovers",     2),
    "fouls_per_game":     ("foulsPersonal", 2),

    # Situational scoring
    "bench_points_per_game":         ("benchPoints",         2),
    "fast_break_points_per_game":    ("pointsFastBreak",     2),
    "points_in_paint_per_game":      ("pointsInThePaint",    2),
    "points_off_turnovers_per_game": ("pointsFromTurnovers", 2),
    "second_chance_points_per_game": ("pointsSecondChance",  2),

    # Extended / advanced (already rate-based per game)
    "offensive_rating":                         ("offensiveRating",                      2),
    "defensive_rating":                         ("defensiveRating",                      2),
    "net_rating":                               ("netRating",                            2),
    "pace":                                     ("pace",                                 2),
    "possessions_per_game":                     ("possessions",                          2),
    "assist_percentage":                        ("assistPercentage",                     4),
    "assist_to_turnover_ratio":                 ("assistToTurnoverRatio",                4),
    "assist_ratio":                             ("assistRatio",                          4),
    "offensive_rebound_percentage":             ("offensiveReboundPercentage",           4),
    "defensive_rebound_percentage":             ("defensiveReboundPercentage",           4),
    "rebound_percentage":                       ("reboundPercentage",                    4),
    "team_turnover_percentage":                 ("teamTurnoverPercentage",               4),
    "effective_field_goal_percentage":          ("effectiveFieldGoalPercentage",         4),
    "true_shooting_percentage":                 ("trueShootingPercentage",               4),
    "opponent_effective_field_goal_percentage": ("opponentEffectiveFieldGoalPercentage", 4),
    "opponent_free_throw_attempt_rate":         ("opponentFreeThrowAttemptRate",         4),
    "opponent_turnover_percentage":             ("opponentTurnoverPercentage",           4),
    "opponent_offensive_rebound_percentage":    ("opponentOffensiveReboundPercentage",   4),
}

# Shooting percentages derived from summed made/attempted totals
PCT_STATS = {
    "fg_pct":       ("fieldGoalsMade",    "fieldGoalsAttempted"),
    "three_pt_pct": ("threePointersMade", "threePointersAttempted"),
    "ft_pct":       ("freeThrowsMade",    "freeThrowsAttempted"),
}


# ---------------------------------------------------------------------------
# Compared with its own league (hist-v2's era-relative inputs)
# ---------------------------------------------------------------------------

# Regular-season profile stats that hist-v2 reads as z-scores against a
# season's league: (value - league mean) / league standard deviation, over
# that season's full-season team profiles. The rebound percentages are left
# out: they are blank before 1996-97 (UNMATCHED_FORMULA_COLS).
RELATIVE_STATS = [
    "regular_win_pct",
    "regular_offensive_rating",
    "regular_defensive_rating",
    "regular_net_rating",
    "regular_pace",
    "regular_true_shooting_percentage",
    "regular_effective_field_goal_percentage",
    "regular_three_pt_pct",
    "regular_ft_pct",
    "regular_assist_percentage",
    "regular_assist_to_turnover_ratio",
    "regular_team_turnover_percentage",
    "regular_opponent_effective_field_goal_percentage",
    "regular_opponent_turnover_percentage",
]
RELATIVE_SUFFIX = "_z"

# Stats whose league average does not move between eras, so hist-v2 may read
# them raw: win %, net rating, point differential, playoff win % and net
# rating, and the participation flags. Everything else drifts with the era
# (ratings, pace, shooting, turnovers, assists) and is only read as _z.
ERA_NEUTRAL_STATS = [
    "regular_win_pct",
    "regular_net_rating",
    "regular_point_diff_per_game",
    "playoff_win_pct",
    "playoff_net_rating",
    "made_playoffs",
    "made_play_in",
]


def is_era_safe_column(col: str) -> bool:
    """
    True if a model column (home_<stat>, away_<stat> or <stat>_diff) reads a
    _z stat built from RELATIVE_STATS or an ERA_NEUTRAL_STATS stat, so it means
    the same thing in 1987 as in 2026.
    """
    if col.startswith("home_") or col.startswith("away_"):
        base = col[5:]
    elif col.endswith("_diff"):
        base = col[:-5]
    else:
        return False
    if base.endswith(RELATIVE_SUFFIX):
        return base[:-len(RELATIVE_SUFFIX)] in RELATIVE_STATS
    return base in ERA_NEUTRAL_STATS


def league_reference(profiles: pd.DataFrame) -> pd.DataFrame:
    """
    Per season, the mean and standard deviation (ddof 1) of each RELATIVE_STATS
    column over that season's team-seasons. profiles are full-season profiles
    (build_season_profiles output, or the served profile CSV). Columns are a
    (stat, "mean"|"std") MultiIndex; the index is the season.
    """
    missing = [s for s in RELATIVE_STATS if s not in profiles.columns]
    if missing:
        raise ValueError("Profiles lack relative stats: " + str(missing))
    if profiles.duplicated(subset=["team_id", "season"]).any():
        raise ValueError("league_reference needs one row per team-season.")
    return profiles.groupby("season")[RELATIVE_STATS].agg(["mean", "std"])


def add_relative_columns(frame: pd.DataFrame, seasons: pd.Series, reference: pd.DataFrame,
                         prefix: str = "") -> pd.DataFrame:
    """
    Return frame with <prefix><stat>_z = (value - mean) / std for every
    RELATIVE_STATS stat, each row measured against reference (league_reference
    output) at its entry in seasons. A season missing from the reference, or
    a std <= 0, gives NaN.

    Training rows pass seasons = season - 1 (the previous, finished season:
    the point-in-time rule). Served full-season profiles pass their own season.
    """
    seasons = pd.Series(np.asarray(seasons), index=frame.index)
    new = {}
    for stat in RELATIVE_STATS:
        mean = seasons.map(reference[(stat, "mean")])
        std  = seasons.map(reference[(stat, "std")])
        std  = std.where(std > 0)
        new[prefix + stat + RELATIVE_SUFFIX] = (frame[prefix + stat] - mean) / std
    return pd.concat([frame.drop(columns=[c for c in new if c in frame.columns]),
                      pd.DataFrame(new, index=frame.index)], axis=1)


def add_own_season_relative_columns(profiles: pd.DataFrame) -> pd.DataFrame:
    """Served profiles: each completed season measured against its own league."""
    return add_relative_columns(profiles, profiles["season"], league_reference(profiles))

# Situational scoring the box score before 1996-97 does not record
# (TeamStatistics.csv stores 0, not blank, for these). Left NaN for older games.
SITUATIONAL_SOURCE_COLS = [
    "benchPoints", "pointsFastBreak", "pointsInThePaint",
    "pointsFromTurnovers", "pointsSecondChance",
]


# ---------------------------------------------------------------------------
# Advanced stats from the basic box score (seasons before 1996-97)
# ---------------------------------------------------------------------------

# Possessions per team-game:
#   POSSESSION_SCALE * mean over both teams of (FGA + 0.44 * FTA - OREB + TOV)
# This is the standard estimate, averaged over the two teams. The NBA's own
# possession counts (TeamStatisticsExtended.csv, 1996-97 on) run about 1.5%
# below it, so POSSESSION_SCALE was fit once on 1996-97 to 2009-10 games and
# checked on 2010-11 onward (reports/older_seasons_backtest.md).
POSSESSION_FT_WEIGHT = 0.44
POSSESSION_SCALE     = 0.985

# Basic box-score columns the formulas read from the opponent's row.
OPPONENT_BOX_COLS = [
    "fieldGoalsMade", "fieldGoalsAttempted", "threePointersMade", "freeThrowsAttempted",
    "reboundsOffensive", "reboundsDefensive", "reboundsTotal", "turnovers",
]


def estimate_possessions(g: pd.DataFrame, scale: float = POSSESSION_SCALE) -> pd.Series:
    def chances(side):
        return (g[side + "fieldGoalsAttempted"] + POSSESSION_FT_WEIGHT * g[side + "freeThrowsAttempted"]
                - g[side + "reboundsOffensive"] + g[side + "turnovers"])
    return scale * (chances("") + chances("opp_")) / 2


def _ratio(num: pd.Series, den: pd.Series) -> pd.Series:
    return (num / den).where(den > 0)


def _plays(g: pd.DataFrame) -> pd.Series:
    """Shots, free-throw trips and turnovers: the assist-ratio denominator, less assists."""
    return g["fieldGoalsAttempted"] + 0.44 * g["freeThrowsAttempted"] + g["turnovers"]


# Keyed by the TeamStatisticsExtended.csv column each one stands in for, so
# MEAN_STATS reads both sources the same way. g is a team's row plus its
# opponent's row as opp_* columns (with_opponent_box). The agreement of each
# formula with the NBA's values is in reports/older_seasons_backtest.md.
BOX_SCORE_FORMULAS = {
    "plusMinusPoints":   lambda g: g["teamScore"] - g["opponentScore"],
    "possessions":       lambda g: estimate_possessions(g),
    "pace":              lambda g: _ratio(240 * estimate_possessions(g), g["numMinutes"]),
    "offensiveRating":   lambda g: 100 * _ratio(g["teamScore"], estimate_possessions(g)),
    "defensiveRating":   lambda g: 100 * _ratio(g["opponentScore"], estimate_possessions(g)),
    "netRating":         lambda g: 100 * _ratio(g["teamScore"] - g["opponentScore"], estimate_possessions(g)),
    "assistPercentage":      lambda g: _ratio(g["assists"], g["fieldGoalsMade"]),
    "assistToTurnoverRatio": lambda g: _ratio(g["assists"], g["turnovers"]),
    "assistRatio":           lambda g: 100 * _ratio(g["assists"], _plays(g) + g["assists"]),
    "offensiveReboundPercentage": lambda g: _ratio(g["reboundsOffensive"], g["reboundsOffensive"] + g["opp_reboundsDefensive"]),
    "defensiveReboundPercentage": lambda g: _ratio(g["reboundsDefensive"], g["reboundsDefensive"] + g["opp_reboundsOffensive"]),
    "reboundPercentage":          lambda g: _ratio(g["reboundsTotal"], g["reboundsTotal"] + g["opp_reboundsTotal"]),
    "teamTurnoverPercentage":       lambda g: _ratio(g["turnovers"], estimate_possessions(g)),
    "effectiveFieldGoalPercentage": lambda g: _ratio(g["fieldGoalsMade"] + 0.5 * g["threePointersMade"], g["fieldGoalsAttempted"]),
    "trueShootingPercentage":       lambda g: _ratio(g["teamScore"], 2 * (g["fieldGoalsAttempted"] + 0.44 * g["freeThrowsAttempted"])),
    "opponentEffectiveFieldGoalPercentage": lambda g: _ratio(g["opp_fieldGoalsMade"] + 0.5 * g["opp_threePointersMade"], g["opp_fieldGoalsAttempted"]),
    "opponentFreeThrowAttemptRate":         lambda g: _ratio(g["opp_freeThrowsAttempted"], g["opp_fieldGoalsAttempted"]),
    "opponentTurnoverPercentage":           lambda g: _ratio(g["opp_turnovers"], estimate_possessions(g)),
    "opponentOffensiveReboundPercentage":   lambda g: _ratio(g["opp_reboundsOffensive"], g["opp_reboundsOffensive"] + g["reboundsDefensive"]),
}


# Formulas that do not reproduce the NBA's own values closely enough to stand in
# for them (validation in reports/older_seasons_backtest.md). The NBA's team
# rebound percentages are not a fixed function of the box score: the plain
# formula runs 0.028 low in 1996-97 and 0.045 low by 2025-26. These stay NaN
# for seasons before 1996-97, so no model reads a value on a different scale.
UNMATCHED_FORMULA_COLS = [
    "offensiveReboundPercentage", "defensiveReboundPercentage",
    "reboundPercentage", "opponentOffensiveReboundPercentage",
]


def with_opponent_box(df: pd.DataFrame) -> pd.DataFrame:
    """Attach each row's opponent box score (same gameId) as opp_* columns."""
    opp = df[["gameId", "teamId"] + OPPONENT_BOX_COLS].rename(
        columns={"teamId": "opponentTeamId", **{c: "opp_" + c for c in OPPONENT_BOX_COLS}}
    )
    if opp.duplicated(subset=["gameId", "opponentTeamId"]).any():
        raise ValueError("Duplicate gameId + teamId rows in the box-score file.")
    out = df.merge(opp, on=["gameId", "opponentTeamId"], how="left")
    missing = out["opp_fieldGoalsAttempted"].isna()
    if missing.any():
        raise ValueError(str(int(missing.sum())) + " team-game rows have no opponent row, e.g. game "
                         + str(out.loc[missing, "gameId"].head().tolist()))
    return out


def compute_box_score_advanced(df: pd.DataFrame) -> pd.DataFrame:
    """Return df with every BOX_SCORE_FORMULAS column replaced by its box-score estimate."""
    g = with_opponent_box(df)
    for col, formula in BOX_SCORE_FORMULAS.items():
        g[col] = formula(g)
    return g.drop(columns=["opp_" + c for c in OPPONENT_BOX_COLS])


# ---------------------------------------------------------------------------
# Per-game rows
# ---------------------------------------------------------------------------

def load_allowed_team_ids() -> set:
    histories = pd.read_csv(TEAM_HISTORY_PATH)
    return set(pd.to_numeric(histories["team_id"], errors="coerce").dropna().astype(int))


def _read_team_games(path: Path, fill_game_types: bool = False) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    df["teamId"] = pd.to_numeric(df["teamId"], errors="coerce")
    df["win"]    = pd.to_numeric(df["win"],    errors="coerce").fillna(0).astype(int)
    if fill_game_types:
        df = fill_missing_game_types(df)
        df["season"] = assign_season_playoffs_by_year(df["gameDateTimeEst"], df["gameType"])
    else:
        df["season"] = assign_season(df["gameDateTimeEst"])
    return df


# The NBA's game id starts with its game type: 1 preseason, 2 regular season,
# 4 playoffs, 5 play-in, 6 NBA Cup final. Only these types are counted.
GAME_ID_PREFIX_TYPES = {
    "2": GAME_TYPE_REGULAR,
    "4": GAME_TYPE_PLAYOFF,
    "5": GAME_TYPE_PLAY_IN,
}


def game_id_prefix(game_ids: pd.Series) -> pd.Series:
    return pd.to_numeric(game_ids, errors="coerce").astype("Int64").astype(str).str[0]


def fill_missing_game_types(df: pd.DataFrame, games_path: Path = GAMES_TABLE_PATH) -> pd.DataFrame:
    """
    Fill a blank gameType from Games.csv by gameId, for games of a counted
    type (GAME_ID_PREFIX_TYPES). Both raw team-game files leave gameType blank
    on almost every 2021-22 row and on about half of 2000-01's; Games.csv has
    every one. Blank preseason and NBA Cup rows stay blank, so they stay out.

    Raises ValueError if a counted game is still blank, or if Games.csv gives
    it a type its game id disagrees with.
    """
    df = df.copy()
    blank = df["gameType"].isna() | (df["gameType"].astype(str).str.strip() == "")
    prefix = game_id_prefix(df["gameId"])
    counted = blank & prefix.isin(GAME_ID_PREFIX_TYPES)
    if not counted.any():
        return df

    games = pd.read_csv(games_path, usecols=["gameId", "gameType"], low_memory=False)
    games = games.dropna(subset=["gameType"]).drop_duplicates("gameId")
    filled = df.loc[counted, "gameId"].map(games.set_index("gameId")["gameType"])

    still_blank = filled.isna()
    if still_blank.any():
        raise ValueError(str(int(still_blank.sum())) + " team-game rows of a counted game type have no gameType "
                         "in either file, e.g. game " + str(df.loc[filled[still_blank].index, "gameId"].head().tolist()))
    expected = prefix[counted].map(GAME_ID_PREFIX_TYPES)
    wrong = filled != expected
    if wrong.any():
        raise ValueError("Games.csv game types disagree with their game ids, e.g. "
                         + str(df.loc[filled[wrong].index, "gameId"].head().tolist()))

    df["gameType"] = df["gameType"].astype(object)
    df.loc[counted, "gameType"] = filled
    return df


def load_team_games(since_season: int, allowed_ids: set, fill_game_types: bool = False) -> pd.DataFrame:
    """
    One row per team per game for every season >= since_season, carrying the
    TeamStatisticsExtended.csv columns that MEAN_STATS and PCT_STATS read.

    Seasons the Extended file covers come from it unchanged. Earlier seasons
    come from TeamStatistics.csv (which agrees with the Extended file on every
    overlapping row), with BOX_SCORE_FORMULAS filling the advanced columns and
    SITUATIONAL_SOURCE_COLS and UNMATCHED_FORMULA_COLS left NaN.

    fill_game_types=True is the hist-v2 path: blank game types are filled from
    Games.csv (fill_missing_game_types), and playoff and play-in games take the
    season of the calendar year they were played in
    (assign_season_playoffs_by_year). The default leaves both as they were, so
    matchup_training_data.csv (duel mode, pre-game model) does not change.
    """
    if since_season <= OLDER_ERA_START:
        raise ValueError("Seasons before " + str(OLDER_ERA_START + 1)
                         + " are not supported (requested " + str(since_season) + ").")

    ext = _read_team_games(STATS_PATH, fill_game_types)
    ext = ext[(ext["season"] >= since_season) & (ext["season"] > EXTENDED_STATS_START)]
    ext = ext[ext["teamId"].isin(allowed_ids)]
    if since_season > EXTENDED_STATS_START:
        return ext.copy()

    basic = _read_team_games(BASIC_STATS_PATH, fill_game_types)
    basic = basic[(basic["season"] >= since_season) & (basic["season"] <= EXTENDED_STATS_START)]
    basic = compute_box_score_advanced(basic)
    basic[SITUATIONAL_SOURCE_COLS + UNMATCHED_FORMULA_COLS] = np.nan
    basic = basic[basic["teamId"].isin(allowed_ids)]

    shared = [c for c in ext.columns if c in basic.columns]
    return pd.concat([basic[shared], ext], ignore_index=True)


# ---------------------------------------------------------------------------
# Season profiles
# ---------------------------------------------------------------------------

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
        }
        for name, (made, att) in PCT_STATS.items():
            rec[prefix + "_" + name] = safe_pct(g[made], g[att])
        for name, (col, digits) in MEAN_STATS.items():
            rec[prefix + "_" + name] = round(g[col].mean(), digits)

        records.append(rec)

    # Explicit columns so a game type with no games (play-in before 2020-21)
    # still yields its columns, filled for every team by build_season_profiles.
    columns = ["team_id", "season"] + [prefix + "_" + c for c in ("games_played", "wins", "losses", "win_pct")]
    columns += [prefix + "_" + name for name in list(PCT_STATS) + list(MEAN_STATS)]
    out = pd.DataFrame(records, columns=columns)
    return out if records else out.astype({c: "float64" for c in columns[2:]})


def build_season_profiles(df: pd.DataFrame) -> pd.DataFrame:
    """One validated profile row per team-season from load_team_games() rows."""
    # Split by game type
    regular_df = df[df["gameType"] == GAME_TYPE_REGULAR].copy()
    play_in_df = df[df["gameType"] == GAME_TYPE_PLAY_IN].copy()
    playoff_df = df[df["gameType"] == GAME_TYPE_PLAYOFF].copy()

    # Aggregate each separately
    regular_profiles = build_profiles(regular_df, "regular")
    play_in_profiles = build_profiles(play_in_df, "play_in")
    playoff_profiles = build_profiles(playoff_df, "playoff")

    # Attach team city/name from regular season (use last game of season for each team)
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

    # Merge: regular as base, left-join play-in and playoff
    out = regular_profiles.merge(
        play_in_profiles, on=["team_id", "season"], how="left"
    ).merge(
        playoff_profiles, on=["team_id", "season"], how="left"
    )

    # Fill play_in_* and playoff_* numeric columns with 0 for non-participants
    play_in_cols = [c for c in out.columns if c.startswith("play_in_")]
    playoff_cols = [c for c in out.columns if c.startswith("playoff_")]
    out[play_in_cols] = out[play_in_cols].fillna(0)
    out[playoff_cols] = out[playoff_cols].fillna(0)

    # Binary participation flags
    out["made_play_in"] = (out["play_in_games_played"] > 0).astype(int)
    out["made_playoffs"] = (out["playoff_games_played"] > 0).astype(int)

    # Column ordering: metadata, regular, play_in, playoff, flags
    meta_cols         = ["season", "team_id", "team_city", "team_name"]
    flag_cols         = ["made_play_in", "made_playoffs"]
    regular_cols      = sorted([c for c in out.columns if c.startswith("regular_")])
    play_in_stat_cols = sorted([c for c in out.columns if c.startswith("play_in_")])
    playoff_stat_cols = sorted([c for c in out.columns if c.startswith("playoff_")])

    out = out[meta_cols + regular_cols + play_in_stat_cols + playoff_stat_cols + flag_cols]

    # Sort
    out = out.sort_values(["season", "team_name"]).reset_index(drop=True)

    #bad data handling
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

    return out


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build one profile row per team-season.")
    parser.add_argument("--since", type=int, default=MODERN_ERA_START + 1,
                        help="first season (the year it ends) to include; default "
                             + str(MODERN_ERA_START + 1) + ", earliest " + str(OLDER_ERA_START + 1))
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    out  = build_season_profiles(load_team_games(args.since, load_allowed_team_ids()))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(args.output, index=False)

    print("Team-season profiles (extended): " + str(len(out)))
    print("Seasons:  " + str(out["season"].nunique())
          + "  (" + str(out["season"].min()) + "-" + str(out["season"].max()) + ")")
    print("Teams:    " + str(out["team_id"].nunique()))
    print("Columns:  " + str(len(out.columns)))
    print("Play-in participants:  " + str(out["made_play_in"].sum()) + " team-seasons")
    print("Playoff participants:  " + str(out["made_playoffs"].sum()) + " team-seasons")
    print("Written to: " + str(args.output))


if __name__ == "__main__":
    main()
