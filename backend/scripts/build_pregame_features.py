"""
build_pregame_features.py

Builds point-in-time team features for every team in every game: one row per
(game_id, team_id). Every value is computed only from games that tipped off
BEFORE the game it describes, so the table is safe for training a betting model.

Features
  pre_elo                      Elo rating going into the game (margin-of-victory
                               Elo, 25% regression to 1500 between seasons)
  form10_net_rating            mean net rating over the team's last 10 games this season
  form10_win_pct               win % over the team's last 10 games this season
  rest_days                    days since the team's previous game (capped at 7)
  back_to_back                 1 if the team played the previous day
  prev_season_net_rating       previous regular season mean net rating
  prev_season_win_pct          previous regular season win %
  lineup_top8_gmsc30           sum of the top-8 prior-30-game Game Score averages
                               among players who appeared in this game
  lineup_total_gmsc30          same, summed over every player who appeared
  lineup_top8_gmsc10           top-8 sum using a 10-game window
  lineup_top8_gmsc82           top-8 sum using an 82-game window
  lineup_plus_minus            expected on-court +/- of players who appeared
  missing_rotation_gmsc30      rating of rotation players (20+ min avg) seen in
                               the team's previous 5 games who did not appear

Lineup features use who actually appeared in the game. Before tip-off this is
approximated by the injury report and inactive list, so live predictions must
supply the expected active roster.

Run from repo root (after build_team_season_profiles_extended.py):
    python backend/scripts/build_pregame_features.py
"""

import numpy as np
import pandas as pd
from pathlib import Path

REPO_ROOT         = Path(__file__).resolve().parents[2]
GAMES_PATH        = REPO_ROOT / "data" / "raw" / "games.csv"
STATS_PATH        = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
PLAYER_STATS_PATH = REPO_ROOT / "data" / "raw" / "PlayerStatistics.csv"
TEAM_HISTORY_PATH = REPO_ROOT / "data" / "processed" / "team_histories_cleaned.csv"
OUTPUT_PATH       = REPO_ROOT / "data" / "processed" / "pregame_team_features.csv"

MODERN_ERA_START = 1997
GAME_TYPES       = {"Regular Season", "Playoffs", "Play-in Tournament"}

ELO_START           = 1500.0
ELO_K               = 20.0
ELO_HOME_ADVANTAGE  = 70.0
ELO_SEASON_CARRY    = 0.75   # keep 75% of distance from the mean between seasons

FORM_WINDOW          = 10
REST_CAP_DAYS        = 7
ROTATION_MINUTES     = 20    # prior avg minutes to count as a rotation player
ROTATION_LOOKBACK    = 5     # team games checked for missing rotation players
ROTATION_MAX_GAP     = 30    # days; stops the lookback crossing an off-season
PLUS_MINUS_PRIOR_MIN = 500   # shrinks small-sample +/- toward 0

PLAYER_COLS = [
    "personId", "gameId", "gameDateTimeEst", "gameType", "playerteamId", "numMinutes",
    "points", "fieldGoalsMade", "fieldGoalsAttempted", "freeThrowsMade", "freeThrowsAttempted",
    "reboundsOffensive", "reboundsDefensive", "steals", "assists", "blocks",
    "foulsPersonal", "turnovers", "plusMinusPoints",
]

FEATURE_COLS = [
    "pre_elo",
    "form10_net_rating",
    "form10_win_pct",
    "rest_days",
    "back_to_back",
    "prev_season_net_rating",
    "prev_season_win_pct",
    "lineup_top8_gmsc30",
    "lineup_total_gmsc30",
    "lineup_top8_gmsc10",
    "lineup_top8_gmsc82",
    "lineup_plus_minus",
    "missing_rotation_gmsc30",
]


def assign_season(times: pd.Series) -> pd.Series:
    """Oct-Dec games belong to the next calendar year's season."""
    return times.dt.year.where(times.dt.month < 10, times.dt.year + 1)


def parse_game_time(dates: pd.Series) -> pd.Series:
    """Naive EST timestamps; some rows omit the leading zero on the hour."""
    return pd.to_datetime(dates, format="mixed")


def prior_rolling_mean(values: pd.Series, keys: list, window: int, min_periods: int) -> pd.Series:
    """Rolling mean over the previous `window` rows per group, excluding the current row."""
    return values.groupby(keys).transform(
        lambda x: x.shift().rolling(window, min_periods=min_periods).mean()
    )


# ---------------------------------------------------------------------------
# Team-level features
# ---------------------------------------------------------------------------

def team_form_features(stats: pd.DataFrame) -> pd.DataFrame:
    stats = stats.sort_values(["teamId", "game_time"]).reset_index(drop=True)
    keys  = [stats["teamId"], stats["season"]]

    out = stats[["gameId", "teamId"]].copy()
    out["form10_net_rating"] = prior_rolling_mean(stats["netRating"], keys, FORM_WINDOW, 3)
    out["form10_win_pct"]    = prior_rolling_mean(stats["win"], keys, FORM_WINDOW, 3)
    out["rest_days"]         = stats.groupby(["teamId", "season"])["game_time"].diff().dt.days.clip(upper=REST_CAP_DAYS)
    out["back_to_back"]      = (out["rest_days"] == 1).astype(int)

    prev = (
        stats[stats["gameType"] == "Regular Season"]
        .groupby(["teamId", "season"])
        .agg(prev_season_net_rating=("netRating", "mean"), prev_season_win_pct=("win", "mean"))
        .reset_index()
    )
    prev["season"] += 1
    out["season"] = stats["season"]
    out = out.merge(prev, on=["teamId", "season"], how="left")
    return out.drop(columns="season")


def elo_features(games: pd.DataFrame) -> pd.DataFrame:
    """Pre-game Elo for both teams of every game, walked in time order."""
    ratings, rating_season, rows = {}, {}, []

    for g in games.sort_values("game_time").itertuples():
        for team in (g.home_team_id, g.away_team_id):
            rating = ratings.get(team, ELO_START)
            if rating_season.get(team, g.season) != g.season:
                rating = ELO_START + ELO_SEASON_CARRY * (rating - ELO_START)
            ratings[team], rating_season[team] = rating, g.season

        home, away = ratings[g.home_team_id], ratings[g.away_team_id]
        rows.append((g.game_id, g.home_team_id, home))
        rows.append((g.game_id, g.away_team_id, away))

        home_won   = g.homeScore > g.awayScore
        expected   = 1.0 / (1.0 + 10 ** ((away - home - ELO_HOME_ADVANTAGE) / 400.0))
        winner_gap = (home - away) if home_won else (away - home)
        mov_mult   = np.log(abs(g.homeScore - g.awayScore) + 1) * 2.2 / (winner_gap * 0.001 + 2.2)
        delta      = ELO_K * mov_mult * (float(home_won) - expected)
        ratings[g.home_team_id] += delta
        ratings[g.away_team_id] -= delta

    return pd.DataFrame(rows, columns=["gameId", "teamId", "pre_elo"])


# ---------------------------------------------------------------------------
# Lineup features
# ---------------------------------------------------------------------------

def game_score(p: pd.DataFrame) -> pd.Series:
    """John Hollinger's Game Score from a player box score."""
    return (
        p["points"] + 0.4 * p["fieldGoalsMade"] - 0.7 * p["fieldGoalsAttempted"]
        - 0.4 * (p["freeThrowsAttempted"] - p["freeThrowsMade"])
        + 0.7 * p["reboundsOffensive"] + 0.3 * p["reboundsDefensive"]
        + p["steals"] + 0.7 * p["assists"] + 0.7 * p["blocks"]
        - 0.4 * p["foulsPersonal"] - p["turnovers"]
    )


def load_player_games(allowed_ids: set) -> pd.DataFrame:
    p = pd.read_csv(PLAYER_STATS_PATH, usecols=PLAYER_COLS, low_memory=False)
    p = p[p["gameType"].isin(GAME_TYPES)].copy()
    p["playerteamId"] = pd.to_numeric(p["playerteamId"], errors="coerce")
    p = p[p["playerteamId"].isin(allowed_ids)].copy()
    p["game_time"] = parse_game_time(p["gameDateTimeEst"])

    for col in PLAYER_COLS[5:]:
        p[col] = pd.to_numeric(p[col], errors="coerce").fillna(0)
    p = p[p["numMinutes"] > 0].copy()   # appeared in the game

    # Ratings use games from any team or season (players carry over), prior games only
    p = p.sort_values(["personId", "game_time"]).reset_index(drop=True)
    p["gmsc"] = game_score(p)
    by_player = p.groupby("personId")
    for window, min_periods in ((10, 3), (30, 5), (82, 3)):
        p["gmsc" + str(window)] = by_player["gmsc"].transform(
            lambda x: x.shift().rolling(window, min_periods=min_periods).mean()
        ).fillna(0)   # rookies / too few games -> replacement level
    p["prior_minutes"] = by_player["numMinutes"].transform(
        lambda x: x.shift().rolling(30, min_periods=5).mean()
    )

    pm_sum  = by_player["plusMinusPoints"].transform(lambda x: x.shift().rolling(82, min_periods=1).sum()).fillna(0)
    min_sum = by_player["numMinutes"].transform(lambda x: x.shift().rolling(82, min_periods=1).sum()).fillna(0)
    recent_minutes = by_player["numMinutes"].transform(lambda x: x.shift().rolling(10, min_periods=1).mean()).fillna(0)
    p["plus_minus_contrib"] = (pm_sum / (min_sum + PLUS_MINUS_PRIOR_MIN)) * recent_minutes

    return p


def lineup_features(p: pd.DataFrame) -> pd.DataFrame:
    top8 = lambda x: x.nlargest(8).sum()
    out = p.groupby(["gameId", "playerteamId"]).agg(
        lineup_top8_gmsc30=("gmsc30", top8),
        lineup_total_gmsc30=("gmsc30", "sum"),
        lineup_top8_gmsc10=("gmsc10", top8),
        lineup_top8_gmsc82=("gmsc82", top8),
        lineup_plus_minus=("plus_minus_contrib", "sum"),
    ).reset_index()

    # Rotation players seen recently who did not appear today
    rotation = p[p["prior_minutes"] >= ROTATION_MINUTES]
    rotation_by_game = {
        key: dict(zip(g["personId"], g["gmsc30"]))
        for key, g in rotation.groupby(["gameId", "playerteamId"])
    }
    appeared = p.groupby(["gameId", "playerteamId"])["personId"].agg(set).to_dict()

    team_games = (
        p[["gameId", "playerteamId", "game_time"]]
        .drop_duplicates(["gameId", "playerteamId"])
        .sort_values(["playerteamId", "game_time"])
    )
    missing = []
    for team_id, g in team_games.groupby("playerteamId"):
        ids, times = g["gameId"].tolist(), g["game_time"].tolist()
        for i, game_id in enumerate(ids):
            recent = {}
            for j in range(max(0, i - ROTATION_LOOKBACK), i):
                if (times[i] - times[j]).days <= ROTATION_MAX_GAP:
                    recent.update(rotation_by_game.get((ids[j], team_id), {}))
            today = appeared.get((game_id, team_id), set())
            missing.append((game_id, team_id, sum(v for pid, v in recent.items() if pid not in today)))

    missing = pd.DataFrame(missing, columns=["gameId", "playerteamId", "missing_rotation_gmsc30"])
    out = out.merge(missing, on=["gameId", "playerteamId"], how="left")
    return out.rename(columns={"playerteamId": "teamId"})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    histories   = pd.read_csv(TEAM_HISTORY_PATH)
    allowed_ids = set(pd.to_numeric(histories["team_id"], errors="coerce").dropna().astype(int))

    # Team game rows
    stats = pd.read_csv(
        STATS_PATH, low_memory=False,
        usecols=["gameId", "gameDateTimeEst", "gameType", "teamId", "win", "netRating"],
    )
    stats["teamId"] = pd.to_numeric(stats["teamId"], errors="coerce")
    stats["win"]    = pd.to_numeric(stats["win"], errors="coerce").fillna(0).astype(int)
    stats = stats[stats["teamId"].isin(allowed_ids) & stats["gameType"].isin(GAME_TYPES)].copy()
    stats["game_time"] = parse_game_time(stats["gameDateTimeEst"])
    stats["season"]    = assign_season(stats["game_time"])

    # Game results for Elo (games.csv also has game types the stats file is missing)
    games = pd.read_csv(GAMES_PATH, low_memory=False).rename(columns={
        "gameId": "game_id", "hometeamId": "home_team_id", "awayteamId": "away_team_id",
    })
    for col in ("home_team_id", "away_team_id", "homeScore", "awayScore"):
        games[col] = pd.to_numeric(games[col], errors="coerce")
    games = games.dropna(subset=["home_team_id", "away_team_id", "homeScore", "awayScore"])
    games = games[games["gameType"].isin(GAME_TYPES | {"Play-In", "Playoff"})].copy()
    games = games[games["home_team_id"].isin(allowed_ids) & games["away_team_id"].isin(allowed_ids)]
    games["game_time"] = parse_game_time(games["gameDateTimeEst"])
    games["season"]    = assign_season(games["game_time"])
    games = games[games["season"] > MODERN_ERA_START].copy()

    print("Computing Elo over " + str(len(games)) + " games...")
    elo = elo_features(games)

    print("Computing team form and rest...")
    form = team_form_features(stats)

    print("Computing lineup strength from player box scores (slow)...")
    lineup = lineup_features(load_player_games(allowed_ids))

    # Elo rows define the output: one per team per modern-era game
    out = elo.merge(form, on=["gameId", "teamId"], how="left")
    out = out.merge(lineup, on=["gameId", "teamId"], how="left")
    out = out.rename(columns={"gameId": "game_id", "teamId": "team_id"})
    out["team_id"] = out["team_id"].astype("int64")
    out = out[["game_id", "team_id"] + FEATURE_COLS].sort_values(["game_id", "team_id"])

    if out.duplicated(subset=["game_id", "team_id"]).any():
        raise ValueError("Duplicate game_id + team_id rows found.")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUTPUT_PATH, index=False)

    print("Pregame team-game rows: " + str(len(out)))
    for col in FEATURE_COLS:
        print("  " + col.ljust(26) + " coverage " + str(round(out[col].notna().mean(), 3)))
    print("Written to: " + str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
