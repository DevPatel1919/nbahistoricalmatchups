"""
export_static_site_data.py

Precomputes every neutral-site matchup between the 835 team-seasons in
team_season_profiles_extended.csv and writes the result as static JSON for
the "Court of All Time" frontend (see docs/frontend-handoff.md).

predict_matchup() treats its first team as the home team, so a single call
is not neutral-site. This script neutralises by scoring BOTH orderings of
every pair and averaging:

    p_ab = P(team A wins | A home, B away)
    p_ba = P(team B wins | B home, A away)
    neutral_p_a = (p_ab + (1 - p_ba)) / 2

    m_ab = projected margin for A when A is home
    m_ba = projected margin for B when B is home
    neutral_margin_a = (m_ab - m_ba) / 2

There are 835 * 834 = 696,390 ordered pairs. Calling predict_matchup() in a
per-pair loop builds a one-row DataFrame per call and takes hours, so this
script loads the classifier/regressor once, builds a vectorised feature
matrix for chunks of ~50k ordered pairs at a time, and calls predict_proba /
predict once per chunk. To match predict_matchup()'s output bit-for-bit,
each ordering's probability is rounded to 4 decimals and margin to 1
decimal BEFORE the two orderings are combined, exactly as predict_matchup()
would round each individual call.

The profile CSV labels every season with a franchise's CURRENT name (e.g.
the 2005 Sonics appear as the Thunder). This script derives era-correct
names/cities from TeamStatisticsExtended.csv, where teamCity/teamName are
as of that season, and uses those for team identity, keys and slugs.

Run from repo root (after predict_matchup() has been verified working):
    python scripts/export_static_site_data.py
"""

import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.models.model_config import (
    CLF_MODEL_PATH,
    REG_MODEL_PATH,
    MODEL_COLUMNS_PATH,
    PROFILES_PATH,
)
from src.models.predict_matchup import _parse_base_stats

REPO_ROOT   = Path(__file__).resolve().parent.parent
STATS_PATH  = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
OUTPUT_DIR  = REPO_ROOT / "frontend" / "public" / "data"
TEAMS_DIR   = OUTPUT_DIR / "teams"

CHUNK_SIZE = 50_000

# Winner-class label the classifier was trained with (see predict_matchup.py).
HOME_WIN_CLASS = 1


# ---------------------------------------------------------------------------
# Era-correct team identity
# ---------------------------------------------------------------------------

def load_era_correct_names() -> pd.DataFrame:
    """
    Derive each team's city/name AS OF each season from raw per-game rows,
    rather than the profile CSV's current-franchise-name labelling.

    Verified to yield 2005 Seattle SuperSonics, New Jersey Nets, Charlotte
    Bobcats and New Orleans Hornets.
    """
    s = pd.read_csv(STATS_PATH, usecols=["gameDateTimeEst", "teamId", "teamCity", "teamName"], low_memory=False)
    s = s.dropna(subset=["teamCity", "teamName"])
    t = pd.to_datetime(s["gameDateTimeEst"], format="mixed")
    s["season"] = t.dt.year.where(t.dt.month < 10, t.dt.year + 1)
    names = s.groupby(["teamId", "season"]).agg(
        era_city=("teamCity", lambda x: x.mode().iat[0]),
        era_name=("teamName", lambda x: x.mode().iat[0]),
    ).reset_index()
    return names


def slugify(name: str) -> str:
    return name.lower().strip().replace(" ", "-")


def load_profiles_with_identity() -> pd.DataFrame:
    """Load team_season_profiles_extended.csv with era-correct identity + key/slug attached."""
    profiles = pd.read_csv(PROFILES_PATH)
    names = load_era_correct_names()

    merged = profiles.merge(
        names, left_on=["team_id", "season"], right_on=["teamId", "season"], how="left"
    )

    missing = merged[merged["era_city"].isna()]
    if len(missing) > 0:
        raise ValueError(
            "No era-correct name found for " + str(len(missing)) + " team-season(s): "
            + str(missing[["season", "team_id", "team_city", "team_name"]].to_dict("records"))
        )

    merged["slug"] = merged["era_name"].map(slugify)
    merged["key"]  = merged["season"].astype(str) + "-" + merged["slug"]

    if merged["key"].duplicated().any():
        dupes = merged[merged["key"].duplicated(keep=False)][["season", "key", "era_city", "era_name"]]
        raise ValueError("Duplicate team-season keys found:\n" + str(dupes))

    return merged.reset_index(drop=True)


# ---------------------------------------------------------------------------
# Vectorised feature matrix + batched prediction
# ---------------------------------------------------------------------------

def build_base_stat_arrays(profiles: pd.DataFrame, base_stats: list[str]) -> dict[str, np.ndarray]:
    """One float64 numpy array per base stat, aligned to profiles' row order."""
    arrays = {}
    for stat in base_stats:
        if stat not in profiles.columns:
            raise ValueError("Model expects base stat '" + stat + "' not found in profiles CSV.")
        arrays[stat] = profiles[stat].to_numpy(dtype=np.float64)
    return arrays


def build_feature_chunk(i_idx: np.ndarray, j_idx: np.ndarray, base_arrays: dict, model_cols: list[str]) -> pd.DataFrame:
    """
    Build the feature matrix for a chunk of ordered pairs (i home, j away),
    matching predict_matchup.build_model_input()'s column semantics exactly.
    """
    data = {}
    for col in model_cols:
        if col.startswith("home_"):
            data[col] = base_arrays[col[5:]][i_idx]
        elif col.startswith("away_"):
            data[col] = base_arrays[col[5:]][j_idx]
        elif col.endswith("_diff"):
            base = col[:-5]
            data[col] = base_arrays[base][i_idx] - base_arrays[base][j_idx]
        else:
            raise ValueError("Unrecognized model column pattern: " + col)
    return pd.DataFrame(data, columns=model_cols)


def score_all_ordered_pairs(profiles: pd.DataFrame, clf, reg, model_cols: list[str]) -> tuple[np.ndarray, np.ndarray]:
    """
    Score every ordered pair (i home, j away), i != j, in chunks.

    Returns (P, M), each an (n, n) float64 array:
        P[i, j] = rounded probability that team i wins, with i at home
        M[i, j] = rounded projected margin for team i, with i at home
    """
    n = len(profiles)
    base_stats = _parse_base_stats(model_cols)
    base_arrays = build_base_stat_arrays(profiles, base_stats)

    classes = list(clf.classes_)
    home_win_idx = classes.index(HOME_WIN_CLASS)

    ii, jj = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    ii, jj = ii.ravel(), jj.ravel()
    keep = ii != jj
    ii, jj = ii[keep], jj[keep]

    total = len(ii)
    P = np.full((n, n), np.nan, dtype=np.float64)
    M = np.full((n, n), np.nan, dtype=np.float64)

    n_chunks = (total + CHUNK_SIZE - 1) // CHUNK_SIZE
    for c in range(n_chunks):
        start = c * CHUNK_SIZE
        end   = min(start + CHUNK_SIZE, total)
        i_chunk = ii[start:end]
        j_chunk = jj[start:end]

        X = build_feature_chunk(i_chunk, j_chunk, base_arrays, model_cols)

        probas = clf.predict_proba(X)
        p_home = np.round(probas[:, home_win_idx], 4)

        margin = np.round(reg.predict(X), 1)

        P[i_chunk, j_chunk] = p_home
        M[i_chunk, j_chunk] = margin

        print("Scored chunk " + str(c + 1) + "/" + str(n_chunks)
              + "  (" + str(end) + "/" + str(total) + " ordered pairs)")

    if np.isnan(P).sum() != n:  # only the n diagonal self-pairs should remain NaN
        raise ValueError("Unexpected NaNs in probability matrix after scoring all ordered pairs.")

    return P, M


# ---------------------------------------------------------------------------
# Output assembly
# ---------------------------------------------------------------------------

def build_index_entry(row: pd.Series) -> dict:
    return {
        "key":          row["key"],
        "season":       int(row["season"]),
        "city":         row["era_city"],
        "name":         row["era_name"],
        "franchiseId":  int(row["team_id"]),
        "madePlayoffs": bool(int(row["made_playoffs"])),
        "wins":         int(row["regular_wins"]),
        "losses":       int(row["regular_losses"]),
        "netRating":    round(float(row["regular_net_rating"]), 2),
        "offRating":    round(float(row["regular_offensive_rating"]), 1),
        "defRating":    round(float(row["regular_defensive_rating"]), 1),
        "pace":         round(float(row["regular_pace"]), 1),
        "trueShooting": round(float(row["regular_true_shooting_percentage"]), 4),
    }


def main():
    print("Loading profiles with era-correct identity...")
    profiles = load_profiles_with_identity()
    n = len(profiles)
    print("Team-seasons: " + str(n))

    print("Loading model artifacts...")
    import pickle
    with open(CLF_MODEL_PATH, "rb") as f:
        clf = pickle.load(f)
    with open(REG_MODEL_PATH, "rb") as f:
        reg = pickle.load(f)
    with open(MODEL_COLUMNS_PATH) as f:
        model_cols = json.load(f)
    print("Model columns: " + str(len(model_cols)))

    print("Scoring all " + str(n * (n - 1)) + " ordered pairs in chunks of " + str(CHUNK_SIZE) + "...")
    P, M = score_all_ordered_pairs(profiles, clf, reg, model_cols)

    keys = profiles["key"].tolist()

    print("Building per-team opponent files...")
    TEAMS_DIR.mkdir(parents=True, exist_ok=True)

    # Neutralise every ordered pair directly from P/M: team i's neutral win
    # probability against j is (P[i,j] + (1 - P[j,i])) / 2, its neutral margin
    # (M[i,j] - M[j,i]) / 2. This formula is applied identically regardless of
    # i/j order, so each unordered pair's two perspectives are derived
    # independently but from the same underlying numbers (exactly complementary).
    opponents_by_team: list[dict] = [dict() for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            neutral_p_i = (P[i, j] + (1 - P[j, i])) / 2
            neutral_m_i = (M[i, j] - M[j, i]) / 2
            opponents_by_team[i][keys[j]] = {
                "p": round(float(neutral_p_i), 4),
                "m": round(float(neutral_m_i), 1),
            }

    for i in range(n):
        if len(opponents_by_team[i]) != n - 1:
            raise ValueError("Team " + keys[i] + " has " + str(len(opponents_by_team[i])) + " opponents, expected " + str(n - 1))
        payload = {"key": keys[i], "opponents": opponents_by_team[i]}
        with open(TEAMS_DIR / (keys[i] + ".json"), "w") as f:
            json.dump(payload, f, separators=(",", ":"))

    print("Wrote " + str(n) + " team files to " + str(TEAMS_DIR))

    print("Building index.json...")
    index_payload = {
        "generated": date.today().isoformat(),
        "teams": [build_index_entry(profiles.iloc[i]) for i in range(n)],
    }
    if len({t["key"] for t in index_payload["teams"]}) != n:
        raise ValueError("index.json has duplicate or missing keys.")

    with open(OUTPUT_DIR / "index.json", "w") as f:
        json.dump(index_payload, f, separators=(",", ":"))

    total_bytes = sum(p.stat().st_size for p in TEAMS_DIR.glob("*.json")) + (OUTPUT_DIR / "index.json").stat().st_size
    print("Index written to: " + str(OUTPUT_DIR / "index.json"))
    print("Total exported data size: " + str(round(total_bytes / (1024 * 1024), 1)) + " MB")


if __name__ == "__main__":
    main()
