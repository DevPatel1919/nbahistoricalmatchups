"""
generate_duel_pool.py

Builds the F09 duel-mode puzzle pool (docs/product/features/F09-daily-duel.md,
Session 1). Each puzzle is a real, completed NBA game shown with only pre-tip
information. The answer, the pre-game model's probability, and the selection
metadata live in a separate private artifact that only the Worker may load.

Reads
  data/processed/matchup_training_data.csv   point-in-time features (the rows the
                                             pre-game model was trained and scored on)
  data/raw/Games.csv                         the actual winner (independent truth source)
  models/pregame/pregame_model.pkl           the shipped pre-game model
  models/pregame/pregame_columns.json

Writes (data/processed/duel_pool/, gitignored; never copy these into frontend/public)
  sim_public.json       display records for solo sim and bot duels
  sim_private.json      answers + model probability + selection metadata for sim
  ranked_public.json    display records for ranked duels
  ranked_private.json   answers + model probability + selection metadata for ranked
Writes (committed, aggregate only)
  reports/duel_pool_report.json   pool sizes, playoff share, model accuracy,
                                  searchability, and the archetype quality gates

The sim and ranked partitions are disjoint by construction: every candidate is
assigned to exactly one partition from a keyed hash of its game id, so no
answer served in sim play can ever appear in a ranked set.

Puzzle ids are HMAC-SHA256(DUEL_POOL_SALT, game id). Set DUEL_POOL_SALT in
.env (a long random secret for production; any value for local work). Changing
it renames every puzzle.

Run from repo root:
    python scripts/generate_duel_pool.py
"""

import hashlib
import hmac
import json
import os
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT    = Path(__file__).resolve().parents[1]
MATCHUP_PATH = REPO_ROOT / "data" / "processed" / "matchup_training_data.csv"
GAMES_PATH   = REPO_ROOT / "data" / "raw" / "Games.csv"
MODEL_PATH   = REPO_ROOT / "models" / "pregame" / "pregame_model.pkl"
COLUMNS_PATH = REPO_ROOT / "models" / "pregame" / "pregame_columns.json"
OUT_DIR      = REPO_ROOT / "data" / "processed" / "duel_pool"
REPORT_PATH  = REPO_ROOT / "reports" / "duel_pool_report.json"
ENV_PATH     = REPO_ROOT / ".env"

POOL_VERSION        = "duel-pool-v1"
GAME_TYPES          = ["Regular Season", "Playoffs"]
MODEL_TRAINED_UP_TO = 2021   # pregame_metrics.json: trained on seasons <= 2021
MIN_GAMES_ENTERING  = 10     # both teams need a readable season-to-date record

ERAS = [
    ("1998-2004", 1998, 2004),
    ("2005-2011", 2005, 2011),
    ("2012-2016", 2012, 2016),
    ("2017-2021", 2017, 2021),
    ("2022-2026", 2022, 2026),
]

# Confidence tiers and the Brier-skill points formula from the brief.
TIERS = {"lean": 0.55, "confident": 0.70, "lock": 0.90}

# Unranked composition: favourite-probability bands and slots per five-puzzle set.
BANDS = [
    ("lock",     0.80, 0.95, 1),
    ("favorite", 0.60, 0.80, 2),
    ("tossup",   0.50, 0.60, 2),
]

RANKED_MIN_EDGE      = 0.10   # |p - 0.5| >= 0.10
RANKED_SHARE         = 0.80   # share of ranked-eligible candidates held out for ranked
MIN_PER_BAND_PER_ERA = 50     # sim must be able to fill every band in every era
MIN_RANKED_PER_ERA   = 50

ARCHETYPE_SEED  = 20260923
DUEL_SIMULATIONS = 20000

# Fields a client may see before lock. Anything not listed here is withheld.
PUBLIC_PUZZLE_FIELDS = {"puzzleId", "era", "isPlayoffGame", "home", "away"}
PUBLIC_TEAM_FIELDS   = {
    "city", "name", "winsEntering", "lossesEntering", "restDays", "backToBack",
    "last10NetRating", "last10WinPct", "missingRotationStrength",
}
PRIVATE_FIELDS = {
    "puzzleId", "gameId", "season", "partition", "actualWinner",
    "modelHomeWinProbability", "modelInSample", "band", "homePick",
    "betterRecordPick", "heuristicDiverges", "rankedEligible", "searchK",
}


# ---------------------------------------------------------------------------
# Scoring (mirrors the brief; the TypeScript domain module is authoritative)
# ---------------------------------------------------------------------------

def points(p_assigned_to_actual_winner) -> np.ndarray:
    brier = (np.asarray(p_assigned_to_actual_winner, dtype=float) - 1.0) ** 2
    return np.round(100.0 * (1.0 - brier / 0.25))


def era_for_season(season: int) -> str:
    for key, lo, hi in ERAS:
        if lo <= season <= hi:
            return key
    raise ValueError("Season outside every era bucket: " + str(season))


def puzzle_id(salt: str, game_id) -> str:
    digest = hmac.new(salt.encode(), str(int(game_id)).encode(), hashlib.sha256).hexdigest()
    return "pz_" + digest[:16]


def partition_draw(salt: str, game_id) -> float:
    """Uniform [0, 1) from a keyed hash, independent of the puzzle id."""
    digest = hmac.new(salt.encode(), ("partition:" + str(int(game_id))).encode(), hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big") / 2 ** 64


def load_salt() -> str:
    salt = os.environ.get("DUEL_POOL_SALT")
    if not salt and ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if line.strip().startswith("DUEL_POOL_SALT="):
                salt = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not salt:
        raise ValueError("Set DUEL_POOL_SALT in the environment or .env (see the module docstring).")
    return salt


# ---------------------------------------------------------------------------
# Candidates
# ---------------------------------------------------------------------------

SNAPSHOT_SOURCE = {
    "restDays":                "rest_days",
    "backToBack":              "back_to_back",
    "last10NetRating":         "form10_net_rating",
    "last10WinPct":            "form10_win_pct",
    "missingRotationStrength": "missing_rotation_gmsc30",
}


def load_candidates(matchup: pd.DataFrame, games: pd.DataFrame) -> pd.DataFrame:
    """Completed regular-season and playoff games with every display field known pre-tip."""
    df = matchup[matchup["game_type"].isin(GAME_TYPES)].copy()
    if df.empty:
        raise ValueError("No regular-season or playoff rows in the matchup data.")
    if df["game_id"].duplicated().any():
        raise ValueError("Duplicate game_id in the matchup data.")

    required = ["home_win"]
    for side in ("home", "away"):
        required += [side + "_regular_wins", side + "_regular_losses", side + "_regular_games_played"]
        required += [side + "_" + col for col in SNAPSHOT_SOURCE.values()]
    df = df.dropna(subset=required)
    df = df[(df["home_regular_games_played"] >= MIN_GAMES_ENTERING)
            & (df["away_regular_games_played"] >= MIN_GAMES_ENTERING)]

    # Truth comes from Games.csv, and must agree with the training label.
    truth = games[["gameId", "hometeamId", "awayteamId", "winner"]].rename(
        columns={"gameId": "game_id", "winner": "truth_winner_id"})
    df = df.merge(truth, on="game_id", how="inner")
    if df.empty:
        raise ValueError("No candidate game matched Games.csv.")
    teams_ok = (df["hometeamId"] == df["home_team_id"]) & (df["awayteamId"] == df["away_team_id"])
    winner_home = df["truth_winner_id"] == df["home_team_id"]
    winner_away = df["truth_winner_id"] == df["away_team_id"]
    if (~teams_ok).any() or (~(winner_home | winner_away)).any():
        raise ValueError("Games.csv disagrees with the matchup data on teams or winner for "
                         + str(int((~teams_ok | ~(winner_home | winner_away)).sum())) + " games.")
    if (winner_home.astype(int) != df["home_win"].astype(int)).any():
        raise ValueError("Games.csv winner disagrees with home_win for "
                         + str(int((winner_home.astype(int) != df["home_win"].astype(int)).sum())) + " games.")
    df["actual_winner"] = np.where(winner_home, "home", "away")
    df["season"] = df["season"].astype(int)
    return df.reset_index(drop=True)


def attach_model(df: pd.DataFrame, model, columns: list) -> pd.DataFrame:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise ValueError("Matchup data lacks model columns: " + str(missing))
    df = df.copy()
    df["model_p_home"] = model.predict_proba(df[columns])[:, 1]
    df["model_in_sample"] = df["season"] <= MODEL_TRAINED_UP_TO
    return df


def attach_selection_metadata(df: pd.DataFrame) -> pd.DataFrame:
    """Pre-game facts both selection policies need. Never uses the result."""
    df = df.copy()
    fav = np.maximum(df["model_p_home"], 1 - df["model_p_home"])
    df["band"] = "extreme"
    for name, lo, hi, _ in reversed(BANDS):
        df.loc[(fav >= lo) & (fav < hi if hi < 0.95 else fav <= hi), "band"] = name

    model_pick = np.where(df["model_p_home"] >= 0.5, "home", "away")
    home_wp = df["home_regular_wins"] / df["home_regular_games_played"]
    away_wp = df["away_regular_wins"] / df["away_regular_games_played"]
    df["home_pick"] = "home"
    df["better_record_pick"] = np.where(home_wp > away_wp, "home", np.where(away_wp > home_wp, "away", "none"))
    rec = df["better_record_pick"]
    df["heuristic_diverges"] = (
        (model_pick != "home")
        | ((rec != "none") & (rec != model_pick))
        | ((rec != "none") & (rec != "home"))
    )
    df["ranked_eligible"] = (np.abs(df["model_p_home"] - 0.5) >= RANKED_MIN_EDGE) & df["heuristic_diverges"]
    return df


def attach_search_k(df: pd.DataFrame, all_games: pd.DataFrame) -> pd.DataFrame:
    """How many games in the whole dataset share this puzzle's era, type, and entering records.

    k = 1 means the entering-record pairing alone identifies the game to anyone
    holding the public dataset. Reported, not filtered on: see the handoff record.
    """
    keys = ["era", "is_playoff", "home_regular_wins", "home_regular_losses",
            "away_regular_wins", "away_regular_losses"]
    ref = all_games.copy()
    ref["era"] = ref["season"].astype(int).map(era_for_season)
    ref["is_playoff"] = ref["game_type"] == "Playoffs"
    counts = ref.groupby(keys).size().rename("search_k").reset_index()
    df = df.copy()
    df["era"] = df["season"].map(era_for_season)
    df["is_playoff"] = df["game_type"] == "Playoffs"
    return df.merge(counts, on=keys, how="left")


def assign_partitions(df: pd.DataFrame, salt: str) -> pd.DataFrame:
    df = df.copy()
    draw = df["game_id"].map(lambda g: partition_draw(salt, g))
    df["partition"] = np.where(df["ranked_eligible"] & (draw < RANKED_SHARE), "ranked", "sim")
    df["puzzle_id"] = df["game_id"].map(lambda g: puzzle_id(salt, g))
    if df["puzzle_id"].duplicated().any():
        raise ValueError("Puzzle id collision; lengthen the id.")
    return df


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------

def team_snapshot(row, side: str) -> dict:
    return {
        "city":                    str(row[side + "_team_city"]),
        "name":                    str(row[side + "_team_name"]),
        "winsEntering":            int(row[side + "_regular_wins"]),
        "lossesEntering":          int(row[side + "_regular_losses"]),
        "restDays":                int(row[side + "_rest_days"]),
        "backToBack":              bool(row[side + "_back_to_back"]),
        "last10NetRating":         round(float(row[side + "_form10_net_rating"]), 1),
        "last10WinPct":            round(float(row[side + "_form10_win_pct"]), 2),
        "missingRotationStrength": round(float(row[side + "_missing_rotation_gmsc30"]), 1),
    }


def public_record(row) -> dict:
    return {
        "puzzleId":      row["puzzle_id"],
        "era":           row["era"],
        "isPlayoffGame": bool(row["is_playoff"]),
        "home":          team_snapshot(row, "home"),
        "away":          team_snapshot(row, "away"),
    }


def private_record(row) -> dict:
    return {
        "puzzleId":                row["puzzle_id"],
        "gameId":                  int(row["game_id"]),
        "season":                  int(row["season"]),
        "partition":               row["partition"],
        "actualWinner":            row["actual_winner"],
        "modelHomeWinProbability": round(float(row["model_p_home"]), 6),
        "modelInSample":           bool(row["model_in_sample"]),
        "band":                    row["band"],
        "homePick":                row["home_pick"],
        "betterRecordPick":        row["better_record_pick"],
        "heuristicDiverges":       bool(row["heuristic_diverges"]),
        "rankedEligible":          bool(row["ranked_eligible"]),
        "searchK":                 int(row["search_k"]),
    }


def validate_records(public: list, private: list) -> None:
    for rec in public:
        if set(rec) != PUBLIC_PUZZLE_FIELDS:
            raise ValueError("Public record has unexpected fields: " + str(sorted(set(rec) ^ PUBLIC_PUZZLE_FIELDS)))
        for side in ("home", "away"):
            if set(rec[side]) != PUBLIC_TEAM_FIELDS:
                raise ValueError("Public team snapshot has unexpected fields: "
                                 + str(sorted(set(rec[side]) ^ PUBLIC_TEAM_FIELDS)))
    for rec in private:
        if set(rec) != PRIVATE_FIELDS:
            raise ValueError("Private record has unexpected fields: " + str(sorted(set(rec) ^ PRIVATE_FIELDS)))
    if [r["puzzleId"] for r in public] != [r["puzzleId"] for r in private]:
        raise ValueError("Public and private records are not aligned.")


# ---------------------------------------------------------------------------
# Archetype quality gates
# ---------------------------------------------------------------------------

def archetype_picks(df: pd.DataFrame, rng: np.random.Generator) -> dict:
    """Side each archetype picks ('home'/'away'). Model-follower also gets a tier."""
    home_wp = df["home_regular_wins"] / df["home_regular_games_played"]
    away_wp = df["away_regular_wins"] / df["away_regular_games_played"]
    return {
        "always-home":          np.full(len(df), "home"),
        "always-better-record": np.where(away_wp > home_wp, "away", "home"),
        "form-chaser":          np.where(df["away_form10_net_rating"] > df["home_form10_net_rating"], "away", "home"),
        "random":               rng.choice(["home", "away"], len(df)),
        "model-follower":       np.where(df["model_p_home"] >= 0.5, "home", "away"),
    }


def nearest_tier(fav_prob: np.ndarray) -> np.ndarray:
    names = np.array(list(TIERS))
    values = np.array(list(TIERS.values()))
    return values[np.abs(fav_prob[:, None] - values[None, :]).argmin(axis=1)], names


def archetype_points(df: pd.DataFrame, rng: np.random.Generator) -> dict:
    """Per-puzzle points for each archetype. Naive archetypes use their best fixed tier."""
    actual = df["actual_winner"].to_numpy()
    out = {}
    for name, side in archetype_picks(df, rng).items():
        correct = side == actual
        if name == "model-follower":
            fav = np.maximum(df["model_p_home"], 1 - df["model_p_home"]).to_numpy()
            tier_p, _ = nearest_tier(fav)
            out[name] = {"correct": correct, "points": points(np.where(correct, tier_p, 1 - tier_p)), "tier": "nearest"}
            continue
        best = None
        for tier, p in TIERS.items():
            pts = points(np.where(correct, p, 1 - p))
            if best is None or pts.mean() > best["points"].mean():
                best = {"correct": correct, "points": pts, "tier": tier}
        out[name] = best
    p_actual = np.where(actual == "home", df["model_p_home"], 1 - df["model_p_home"])
    model_side = np.where(df["model_p_home"] >= 0.5, "home", "away")
    out["model (continuous benchmark)"] = {"correct": model_side == actual, "points": points(p_actual), "tier": "continuous"}
    return out


def duel_win_rate(a_points: np.ndarray, b_points: np.ndarray, set_indices: np.ndarray) -> dict:
    """Both players answer the same sampled five-puzzle sets. Ties by total count as half."""
    a = a_points[set_indices].sum(axis=1)
    b = b_points[set_indices].sum(axis=1)
    return {"aWins": round(float((a > b).mean() + 0.5 * (a == b).mean()), 4)}


def composition_sets(df: pd.DataFrame, rng: np.random.Generator, n: int) -> np.ndarray:
    """Row indices of n five-puzzle sets drawn to the unranked composition profile."""
    cols = []
    for band, _, _, slots in BANDS:
        idx = np.flatnonzero(df["band"].to_numpy() == band)
        if len(idx) < slots:
            raise ValueError("Band " + band + " cannot fill a set.")
        for _ in range(slots):
            cols.append(rng.choice(idx, n))
    return np.stack(cols, axis=1)


def uniform_sets(df: pd.DataFrame, rng: np.random.Generator, n: int) -> np.ndarray:
    return rng.choice(len(df), (n, 5))


def gate_report(df: pd.DataFrame, sets: np.ndarray, rng: np.random.Generator) -> dict:
    arch = archetype_points(df, rng)
    flat = sets.reshape(-1)
    table = {}
    for name, a in arch.items():
        table[name] = {
            "tier":            a["tier"],
            "accuracy":        round(float(a["correct"][flat].mean()), 4),
            "meanPointsPerPuzzle": round(float(a["points"][flat].mean()), 2),
        }
    follower = arch["model-follower"]["points"]
    duels = {}
    for naive in ("always-home", "always-better-record", "form-chaser", "random"):
        duels["model-follower vs " + naive] = duel_win_rate(follower, arch[naive]["points"], sets)["aWins"]
    best_naive = max(("always-home", "always-better-record", "form-chaser"),
                     key=lambda n: table[n]["meanPointsPerPuzzle"])
    return {
        "puzzlesSampled": int(flat.size),
        "archetypes":     table,
        "modelFollowerDuelWinRate": duels,
        "bestNaive":      best_naive,
        "accuracyGapModelMinusBestNaive": round(table["model-follower"]["accuracy"] - table[best_naive]["accuracy"], 4),
        "pointsGapModelMinusBestNaive":   round(table["model-follower"]["meanPointsPerPuzzle"]
                                                - table[best_naive]["meanPointsPerPuzzle"], 2),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_pool(matchup: pd.DataFrame, games: pd.DataFrame, model, columns: list, salt: str) -> pd.DataFrame:
    df = load_candidates(matchup, games)
    df = attach_model(df, model, columns)
    df = attach_selection_metadata(df)
    df = attach_search_k(df, matchup[matchup["game_type"].isin(GAME_TYPES)])
    return assign_partitions(df, salt)


def pool_statistics(df: pd.DataFrame) -> dict:
    model_side = np.where(df["model_p_home"] >= 0.5, "home", "away")
    df = df.assign(model_correct=model_side == df["actual_winner"])
    per_era = {}
    for era, g in df.groupby("era"):
        per_era[era] = {
            "candidates":  int(len(g)),
            "sim":         int((g["partition"] == "sim").sum()),
            "ranked":      int((g["partition"] == "ranked").sum()),
            "playoffShare": round(float(g["is_playoff"].mean()), 4),
            "simByBand":   {b: int(((g["partition"] == "sim") & (g["band"] == b)).sum()) for b, *_ in BANDS},
            "modelAccuracy": round(float(g["model_correct"].mean()), 4),
        }
    sample = {
        "inSample (seasons <= " + str(MODEL_TRAINED_UP_TO) + ")": df[df["model_in_sample"]],
        "outOfSample (seasons > " + str(MODEL_TRAINED_UP_TO) + ")": df[~df["model_in_sample"]],
    }
    return {
        "candidates":   int(len(df)),
        "sim":          int((df["partition"] == "sim").sum()),
        "ranked":       int((df["partition"] == "ranked").sum()),
        "rankedDuelCapacity": int((df["partition"] == "ranked").sum() // 5),
        "playoffShare": round(float(df["is_playoff"].mean()), 4),
        "modelAccuracy": {k: {"games": int(len(g)), "accuracy": round(float(g["model_correct"].mean()), 4),
                              "brier": round(float(((np.where(g["actual_winner"] == "home", 1, 0)
                                                     - g["model_p_home"]) ** 2).mean()), 4)}
                          for k, g in sample.items()},
        "perEra":       per_era,
        "searchability": {
            "definition": "games in the full dataset sharing era, game type, and both entering records",
            "shareUniqueK1": round(float((df["search_k"] == 1).mean()), 4),
            "shareKAtLeast5": round(float((df["search_k"] >= 5).mean()), 4),
            "medianK": float(df["search_k"].median()),
        },
    }


def check_coverage(stats: dict) -> None:
    for era, s in stats["perEra"].items():
        for band, n in s["simByBand"].items():
            if n < MIN_PER_BAND_PER_ERA:
                raise ValueError("Sim pool for " + era + " has only " + str(n) + " " + band + " puzzles.")
        if s["ranked"] < MIN_RANKED_PER_ERA:
            raise ValueError("Ranked pool for " + era + " has only " + str(s["ranked"]) + " puzzles.")


def verdict(unranked: dict, ranked: dict) -> list:
    lines = []
    for label, r in (("unranked", unranked), ("ranked", ranked)):
        a = r["archetypes"]
        home_gap = round(a["model-follower"]["meanPointsPerPuzzle"] - a["always-home"]["meanPointsPerPuzzle"], 2)
        rec_gap  = round(a["model-follower"]["meanPointsPerPuzzle"] - a["always-better-record"]["meanPointsPerPuzzle"], 2)
        lines.append(label + ": model-follower beats always-home by " + str(home_gap)
                     + " pts/puzzle and always-better-record by " + str(rec_gap)
                     + " pts/puzzle; wins " + str(r["modelFollowerDuelWinRate"]["model-follower vs " + r["bestNaive"]])
                     + " of five-puzzle duels against the best naive archetype (" + r["bestNaive"] + ").")
    return lines


def main():
    for path in (MATCHUP_PATH, GAMES_PATH, MODEL_PATH, COLUMNS_PATH):
        if not path.exists():
            raise FileNotFoundError("Missing: " + str(path))
    salt = load_salt()

    matchup = pd.read_csv(MATCHUP_PATH, low_memory=False)
    games   = pd.read_csv(GAMES_PATH, low_memory=False,
                          usecols=["gameId", "hometeamId", "awayteamId", "winner"])
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)
    columns = json.loads(COLUMNS_PATH.read_text())

    df = build_pool(matchup, games, model, columns, salt)
    print("Candidates: " + str(len(df)))

    stats = pool_statistics(df)
    check_coverage(stats)

    rng = np.random.default_rng(ARCHETYPE_SEED)
    sim    = df[df["partition"] == "sim"].reset_index(drop=True)
    ranked = df[df["partition"] == "ranked"].reset_index(drop=True)
    unranked_gates = gate_report(sim, composition_sets(sim, rng, DUEL_SIMULATIONS), rng)
    ranked_gates   = gate_report(ranked, uniform_sets(ranked, rng, DUEL_SIMULATIONS), rng)
    uniform_gates  = gate_report(df, uniform_sets(df, rng, DUEL_SIMULATIONS), rng)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, part in (("sim", sim), ("ranked", ranked)):
        public  = [public_record(r) for _, r in part.iterrows()]
        private = [private_record(r) for _, r in part.iterrows()]
        validate_records(public, private)
        (OUT_DIR / (name + "_public.json")).write_text(json.dumps({"version": POOL_VERSION, "puzzles": public}))
        (OUT_DIR / (name + "_private.json")).write_text(json.dumps({"version": POOL_VERSION, "answers": private}))
        print("Saved: " + str(OUT_DIR / (name + "_public.json")) + " (" + str(len(public)) + " puzzles)")
        print("Saved: " + str(OUT_DIR / (name + "_private.json")))

    report = {
        "version":        POOL_VERSION,
        "pool":           stats,
        "gates": {
            "unrankedComposition": unranked_gates,
            "rankedSignalDivergence": ranked_gates,
            "uniformAllCandidates (reference)": uniform_gates,
        },
        "verdict":        verdict(unranked_gates, ranked_gates),
        "notes": [
            "Naive archetypes are scored at their best fixed tier (the most generous reading of each).",
            "Model probabilities for seasons <= " + str(MODEL_TRAINED_UP_TO)
            + " are in-sample: the shipped model was fit on those games.",
            "Duel win rate counts ties as half a win.",
        ],
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2))
    for line in report["verdict"]:
        print(line)
    print("Saved: " + str(REPORT_PATH))


if __name__ == "__main__":
    main()
