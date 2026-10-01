"""
test_pregame_leakage.py

Guards against look-ahead leakage in matchup_training_data.csv. For a random
sample of games (plus the latest playoff games) it recomputes features straight
from the raw per-game files using only games that tipped off earlier, and
fails if the built data disagrees.

It checks older_seasons_matchups.csv (1985-86 to 1996-97, written by
scripts/backtest_older_seasons.py) the same way when that file exists. Those
seasons have no TeamStatisticsExtended.csv rows, so their ratings are
recomputed from TeamStatistics.csv with the profile builder's box-score
formulas.

Run from repo root after rebuilding data:
    python src/models/test_pregame_leakage.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT   = Path(__file__).resolve().parents[2]
DATA_PATH   = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"
OLDER_PATH  = REPO_ROOT / "data" / "processed" / "older_seasons_matchups.csv"
STATS_PATH  = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
BACKEND_DIR = REPO_ROOT / "backend" / "scripts"

SAMPLE_GAMES  = 300
LATEST_PLAYOFF_GAMES = 50
TOLERANCE     = 1e-6
REST_CAP_DAYS = 7   # build_pregame_features.REST_CAP_DAYS

# Season-to-date means checked for every sampled game: matchup column -> raw column
PROFILE_MEANS = {
    "net_rating": "netRating",
}
# Extra means checked on older seasons, where the ratings come from box-score formulas
OLDER_PROFILE_MEANS = {
    "net_rating":               "netRating",
    "offensive_rating":         "offensiveRating",
    "defensive_rating":         "defensiveRating",
    "pace":                     "pace",
    "true_shooting_percentage": "trueShootingPercentage",
    "team_turnover_percentage": "teamTurnoverPercentage",
}


def close(a, b) -> bool:
    if pd.isna(a) and pd.isna(b):
        return True
    return not (pd.isna(a) or pd.isna(b)) and abs(float(a) - float(b)) < TOLERANCE


def prepare_stats(s: pd.DataFrame) -> pd.DataFrame:
    """Add the tip-off time t and season to raw per-team-game rows."""
    s = s.copy()
    s["t"]      = pd.to_datetime(s["gameDateTimeEst"], format="mixed")
    s["season"] = s["t"].dt.year.where(s["t"].dt.month < 10, s["t"].dt.year + 1)
    return s


def load_older_stats() -> pd.DataFrame:
    """1985-86 to 1996-97 per-team-game rows with box-score ratings, from the raw files."""
    sys.path.insert(0, str(BACKEND_DIR))
    from build_team_season_profiles_extended import (
        MODERN_ERA_START, OLDER_ERA_START, load_allowed_team_ids, load_team_games,
    )
    s = load_team_games(OLDER_ERA_START + 1, load_allowed_team_ids())
    s = s[s["season"] <= MODERN_ERA_START]
    return prepare_stats(s.drop(columns="season"))


def sample_rows(m: pd.DataFrame) -> list:
    rng  = np.random.default_rng(0)
    rows = list(rng.choice(len(m), min(SAMPLE_GAMES, len(m)), replace=False))
    rows += list(m.index[m["game_type"] == "Playoffs"][-LATEST_PLAYOFF_GAMES:])
    return rows


def check_rows(m: pd.DataFrame, s: pd.DataFrame, rows: list, means: dict = PROFILE_MEANS) -> list:
    """
    Recompute each sampled game's features from s (prepare_stats output) using
    only games that tipped off before it. Returns (game_id, column, built,
    expected) for every disagreement.
    """
    tip_off  = s.drop_duplicates("gameId").set_index("gameId")["t"]
    failures = []
    for i in rows:
        r = m.loc[i]
        t = tip_off.get(r["game_id"], pd.to_datetime(r["game_date"], format="mixed"))
        for side in ("home", "away"):
            team = s[(s["teamId"] == r[side + "_team_id"]) & (s["season"] == r["season"]) & (s["t"] < t)]

            # Season-to-date profiles
            for prefix, game_type in (("regular", "Regular Season"), ("playoff", "Playoffs")):
                prior = team[team["gameType"] == game_type]
                empty = 0 if prefix == "playoff" else np.nan
                checks = {
                    "games_played": len(prior),
                    "wins":         prior["win"].sum(),
                }
                for stat, raw_col in means.items():
                    checks[stat] = prior[raw_col].mean() if len(prior) else empty
                for stat, expected in checks.items():
                    col = side + "_" + prefix + "_" + stat
                    if not close(r[col], expected):
                        failures.append((r["game_id"], col, r[col], expected))

            # Recent form and rest: games of any tracked type this season.
            # form10_win_pct, rest_days, and back_to_back are shown to players
            # in F09 duel puzzles, so they are checked here too.
            if side + "_form10_net_rating" in m.columns:
                prior = team[team["gameType"].isin(["Regular Season", "Playoffs", "Play-in Tournament"])].sort_values("t")
                rest  = min((t - prior["t"].iloc[-1]).days, REST_CAP_DAYS) if len(prior) else np.nan
                checks = {
                    "form10_net_rating": prior["netRating"].tail(10).mean() if len(prior) >= 3 else np.nan,
                    "form10_win_pct":    prior["win"].tail(10).mean() if len(prior) >= 3 else np.nan,
                    "rest_days":         rest,
                    "back_to_back":      float(rest == 1) if len(prior) else 0.0,
                }
                for stat, expected in checks.items():
                    col = side + "_" + stat
                    # A team's first game may have no feature row at all; unknown is not leaky.
                    if stat == "back_to_back" and not len(prior) and pd.isna(r[col]):
                        continue
                    if not close(r[col], expected):
                        failures.append((r["game_id"], col, r[col], expected))
    return failures


def report(label: str, n_rows: int, failures: list) -> None:
    print(label + ": checked " + str(n_rows) + " games, " + str(len(failures)) + " mismatches.")
    for f in failures[:20]:
        print("  game " + str(f[0]) + "  " + f[1] + ": built=" + str(f[2]) + " expected=" + str(f[3]))


def main() -> int:
    m = pd.read_csv(DATA_PATH, low_memory=False)
    s = prepare_stats(pd.read_csv(STATS_PATH, low_memory=False,
                                  usecols=["gameId", "gameDateTimeEst", "gameType", "teamId", "win", "netRating"]))
    rows     = sample_rows(m)
    failures = check_rows(m, s, rows)
    report("matchup_training_data.csv", len(rows), failures)

    if OLDER_PATH.exists():
        older       = pd.read_csv(OLDER_PATH, low_memory=False)
        older_rows  = sample_rows(older)
        older_fails = check_rows(older, load_older_stats(), older_rows, OLDER_PROFILE_MEANS)
        report("older_seasons_matchups.csv", len(older_rows), older_fails)
        failures += older_fails
    else:
        print("older_seasons_matchups.csv not found; run scripts/backtest_older_seasons.py to build and check it.")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
