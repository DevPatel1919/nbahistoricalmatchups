"""
test_pregame_leakage.py

Guards against look-ahead leakage in matchup_training_data.csv. For a random
sample of games (plus the latest playoff games) it recomputes features straight
from the raw per-game files using only games that tipped off earlier, and
fails if the built data disagrees.

Run from repo root after rebuilding data:
    python src/models/test_pregame_leakage.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT  = Path(__file__).resolve().parents[2]
DATA_PATH  = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"
STATS_PATH = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"

SAMPLE_GAMES  = 300
LATEST_PLAYOFF_GAMES = 50
TOLERANCE     = 1e-6


def close(a, b) -> bool:
    if pd.isna(a) and pd.isna(b):
        return True
    return not (pd.isna(a) or pd.isna(b)) and abs(float(a) - float(b)) < TOLERANCE


def main() -> int:
    m = pd.read_csv(DATA_PATH, low_memory=False)
    s = pd.read_csv(STATS_PATH, low_memory=False,
                    usecols=["gameId", "gameDateTimeEst", "gameType", "teamId", "win", "netRating"])
    s["t"]      = pd.to_datetime(s["gameDateTimeEst"], format="mixed")
    s["season"] = s["t"].dt.year.where(s["t"].dt.month < 10, s["t"].dt.year + 1)
    tip_off     = s.drop_duplicates("gameId").set_index("gameId")["t"]

    rng  = np.random.default_rng(0)
    rows = list(rng.choice(len(m), SAMPLE_GAMES, replace=False))
    rows += list(m.index[m["game_type"] == "Playoffs"][-LATEST_PLAYOFF_GAMES:])

    failures = []
    for i in rows:
        r = m.loc[i]
        t = tip_off.get(r["game_id"], pd.to_datetime(r["game_date"], format="mixed"))
        for side in ("home", "away"):
            team = s[(s["teamId"] == r[side + "_team_id"]) & (s["season"] == r["season"]) & (s["t"] < t)]

            # Season-to-date profiles
            for prefix, game_type in (("regular", "Regular Season"), ("playoff", "Playoffs")):
                prior = team[team["gameType"] == game_type]
                checks = {
                    "games_played": len(prior),
                    "wins":         prior["win"].sum(),
                    "net_rating":   prior["netRating"].mean() if len(prior) else (0 if prefix == "playoff" else np.nan),
                }
                for stat, expected in checks.items():
                    col = side + "_" + prefix + "_" + stat
                    if not close(r[col], expected):
                        failures.append((r["game_id"], col, r[col], expected))

            # Recent form: last 10 games of any tracked type this season
            if side + "_form10_net_rating" in m.columns:
                prior = team[team["gameType"].isin(["Regular Season", "Playoffs", "Play-in Tournament"])].sort_values("t")
                expected = prior["netRating"].tail(10).mean() if len(prior) >= 3 else np.nan
                col = side + "_form10_net_rating"
                if not close(r[col], expected):
                    failures.append((r["game_id"], col, r[col], expected))

    print("Checked " + str(len(rows)) + " games, " + str(len(failures)) + " mismatches.")
    for f in failures[:20]:
        print("  game " + str(f[0]) + "  " + f[1] + ": built=" + str(f[2]) + " expected=" + str(f[3]))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
