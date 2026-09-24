"""
test_duel_pool.py

F09 Session 1 acceptance tests for scripts/generate_duel_pool.py.

The unit tests run on a small synthetic frame. The artifact tests read the
generated pool in data/processed/duel_pool/ and are skipped when that
gitignored folder has not been built.

Run from repo root:
    python scripts/generate_duel_pool.py
    python -m pytest tests/test_duel_pool.py -v
"""

import json
import pickle

import numpy as np
import pandas as pd
import pytest

from scripts import generate_duel_pool as gen

ARTIFACTS = {name: gen.OUT_DIR / (name + ".json")
             for name in ("sim_public", "sim_private", "ranked_public", "ranked_private")}
needs_pool = pytest.mark.skipif(not all(p.exists() for p in ARTIFACTS.values()) or not gen.MATCHUP_PATH.exists(),
                                reason="duel pool not generated")

# Names of source columns that describe the game itself rather than pre-tip state.
WITHHELD_WORDS = ("date", "score", "attendance", "arena", "official", "round", "series",
                  "label", "subtype", "gameid", "season", "winner", "probability", "model")


# ---------------------------------------------------------------------------
# Synthetic fixture
# ---------------------------------------------------------------------------

def synthetic_matchup(n: int = 400, seed: int = 0) -> tuple:
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        season = int(rng.choice([2001, 2008, 2014, 2019, 2024]))
        home_gp, away_gp = int(rng.integers(10, 80)), int(rng.integers(10, 80))
        home_w, away_w = int(rng.integers(0, home_gp + 1)), int(rng.integers(0, away_gp + 1))
        row = {
            "game_id": 20000000 + i, "season": season, "game_date": "2019-01-01",
            "game_type": "Playoffs" if i % 13 == 0 else "Regular Season",
            "home_team_id": 1, "away_team_id": 2,
            "home_team_city": "Home City", "home_team_name": "Homers",
            "away_team_city": "Away City", "away_team_name": "Visitors",
            "home_win": int(rng.random() < 0.6),
        }
        for side, gp, w in (("home", home_gp, home_w), ("away", away_gp, away_w)):
            row.update({
                side + "_regular_games_played": gp, side + "_regular_wins": w, side + "_regular_losses": gp - w,
                side + "_rest_days": int(rng.integers(1, 5)), side + "_back_to_back": 0,
                side + "_form10_net_rating": float(rng.normal(0, 6)), side + "_form10_win_pct": 0.5,
                side + "_missing_rotation_gmsc30": float(rng.uniform(0, 20)),
            })
        row["x"] = float(rng.normal())
        rows.append(row)
    matchup = pd.DataFrame(rows)
    games = pd.DataFrame({
        "gameId": matchup["game_id"], "hometeamId": 1, "awayteamId": 2,
        "winner": np.where(matchup["home_win"] == 1, 1, 2),
    })
    # Every game is a day after the previous one, so each team has one day of rest.
    times = pd.Timestamp("2019-01-01 19:00") + pd.to_timedelta(np.arange(n) + 1, unit="D")
    stats = pd.concat([
        pd.DataFrame({"gameId": matchup["game_id"], "teamId": team, "gameType": matchup["game_type"],
                      "gameDateTimeEst": times.strftime("%Y-%m-%d %H:%M:%S")})
        for team in (1, 2)
    ])
    return matchup, games, stats


class SigmoidModel:
    """Stand-in for the pickled pipeline: p(home) = sigmoid(2x + 0.3)."""
    def predict_proba(self, X):
        p = 1 / (1 + np.exp(-(2 * X["x"].to_numpy() + 0.3)))
        return np.column_stack([1 - p, p])


@pytest.fixture(scope="module")
def pool():
    matchup, games, stats = synthetic_matchup()
    return gen.build_pool(matchup, games, stats, SigmoidModel(), ["x"], "test-salt")


# ---------------------------------------------------------------------------
# Unit tests
# ---------------------------------------------------------------------------

def test_points_match_published_table():
    for tier, (right, wrong) in {"lean": (19, -21), "confident": (64, -96), "lock": (96, -224)}.items():
        p = gen.TIERS[tier]
        assert gen.points(p) == right
        assert gen.points(1 - p) == wrong


def test_era_buckets_cover_every_season():
    assert gen.era_for_season(1998) == "1998-2004"
    assert gen.era_for_season(2011) == "2005-2011"
    assert gen.era_for_season(2022) == "2022-2026"
    with pytest.raises(ValueError):
        gen.era_for_season(1997)


def test_puzzle_id_is_keyed_and_opaque():
    a = gen.puzzle_id("salt-a", 22100001)
    assert a == gen.puzzle_id("salt-a", 22100001)
    assert a != gen.puzzle_id("salt-b", 22100001)
    assert "22100001" not in a


def test_winner_disagreement_is_rejected():
    matchup, games, _ = synthetic_matchup(50)
    games.loc[3, "winner"] = 1 if games.loc[3, "winner"] == 2 else 2
    with pytest.raises(ValueError, match="winner"):
        gen.load_candidates(matchup, games)


def test_early_season_games_are_excluded():
    matchup, games, _ = synthetic_matchup(50)
    matchup.loc[0, "home_regular_games_played"] = gen.MIN_GAMES_ENTERING - 1
    assert 20000000 not in set(gen.load_candidates(matchup, games)["game_id"])


def test_rest_counts_calendar_days_not_elapsed_hours():
    stats = pd.DataFrame({
        "gameId": [1, 2, 3, 4], "teamId": 7, "gameType": "Regular Season",
        # 22.5 hours apart but on consecutive days, then two clear days, then 9 days.
        "gameDateTimeEst": ["2019-01-01 21:30:00", "2019-01-02 20:00:00", "2019-01-04 13:00:00",
                            "2019-01-13 19:00:00"],
    })
    rest = gen.calendar_rest(stats).set_index("game_id")["rest_calendar"]
    assert pd.isna(rest[1])
    assert rest[2] == 1
    assert rest[3] == 2
    assert rest[4] == gen.REST_CAP_DAYS


def test_bands_follow_favourite_probability(pool):
    fav = np.maximum(pool["model_p_home"], 1 - pool["model_p_home"])
    assert (fav[pool["band"] == "tossup"] < 0.60).all()
    assert ((fav[pool["band"] == "favorite"] >= 0.60) & (fav[pool["band"] == "favorite"] < 0.80)).all()
    assert ((fav[pool["band"] == "lock"] >= 0.80) & (fav[pool["band"] == "lock"] <= 0.95)).all()
    assert (fav[pool["band"] == "extreme"] > 0.95).all()


def test_selection_metadata_ignores_the_result(pool):
    flipped = pool.assign(actual_winner=np.where(pool["actual_winner"] == "home", "away", "home"),
                          home_win=1 - pool["home_win"])
    again = gen.attach_selection_metadata(flipped)
    for col in ("band", "better_record_pick", "heuristic_diverges", "ranked_eligible"):
        assert (again[col].to_numpy() == pool[col].to_numpy()).all(), col


def test_ranked_partition_is_signal_divergent_and_disjoint(pool):
    ranked = pool[pool["partition"] == "ranked"]
    assert len(ranked) > 0
    assert (np.abs(ranked["model_p_home"] - 0.5) >= gen.RANKED_MIN_EDGE).all()
    assert ranked["heuristic_diverges"].all()
    sim = pool[pool["partition"] == "sim"]
    assert not set(sim["puzzle_id"]) & set(ranked["puzzle_id"])
    assert not set(sim["game_id"]) & set(ranked["game_id"])
    assert len(sim) + len(ranked) == len(pool)


def test_public_record_carries_only_whitelisted_fields(pool):
    rec = gen.public_record(pool.iloc[0])
    gen.validate_records([rec], [gen.private_record(pool.iloc[0])])
    text = json.dumps(rec).lower()
    for word in ("actualwinner", "model", "gameid", "season", "band", "partition"):
        assert word not in text
    with pytest.raises(ValueError):
        gen.validate_records([{**rec, "gameDate": "2019-01-01"}], [gen.private_record(pool.iloc[0])])


def test_public_fields_name_nothing_withheld():
    for field in gen.PUBLIC_PUZZLE_FIELDS | gen.PUBLIC_TEAM_FIELDS:
        assert not any(w in field.lower() for w in WITHHELD_WORDS), field


# ---------------------------------------------------------------------------
# Generated artifacts
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def artifacts():
    return {name: json.loads(path.read_text()) for name, path in ARTIFACTS.items()}


@needs_pool
def test_artifacts_are_valid_and_aligned(artifacts):
    for part in ("sim", "ranked"):
        public, private = artifacts[part + "_public"]["puzzles"], artifacts[part + "_private"]["answers"]
        gen.validate_records(public, private)
        assert all(r["partition"] == part for r in private)


@needs_pool
def test_public_artifacts_hold_no_answer_or_model_value(artifacts):
    for part in ("sim", "ranked"):
        text = json.dumps(artifacts[part + "_public"]).lower()
        for word in ("actualwinner", "modelhome", "gameid", "season", "heuristic", "rankedeligible", "searchk"):
            assert word not in text, (part, word)


@needs_pool
def test_partitions_are_disjoint(artifacts):
    sim, ranked = artifacts["sim_private"]["answers"], artifacts["ranked_private"]["answers"]
    assert not {r["puzzleId"] for r in sim} & {r["puzzleId"] for r in ranked}
    assert not {r["gameId"] for r in sim} & {r["gameId"] for r in ranked}


@needs_pool
def test_both_policies_can_be_satisfied_in_every_era(artifacts):
    sim, ranked = artifacts["sim_private"]["answers"], artifacts["ranked_private"]["answers"]
    eras = {p["puzzleId"]: p["era"] for part in ("sim", "ranked") for p in artifacts[part + "_public"]["puzzles"]}
    for era, *_ in gen.ERAS:
        for band, _, _, slots in gen.BANDS:
            assert sum(1 for r in sim if eras[r["puzzleId"]] == era and r["band"] == band) >= slots * 10
        assert sum(1 for r in ranked if eras[r["puzzleId"]] == era) >= 5 * 10
    assert all(r["rankedEligible"] for r in ranked)


@needs_pool
def test_displayed_rest_uses_only_earlier_games(artifacts):
    """Point-in-time check for the one display field not taken from the matchup data."""
    s = pd.read_csv(gen.STATS_PATH, low_memory=False, usecols=["gameId", "teamId", "gameDateTimeEst", "gameType"])
    s = s[s["gameType"].isin(gen.REST_GAME_TYPES)].copy()
    s["t"] = pd.to_datetime(s["gameDateTimeEst"], format="mixed")
    s["season"] = s["t"].dt.year.where(s["t"].dt.month < 10, s["t"].dt.year + 1)
    teams = pd.read_csv(gen.MATCHUP_PATH, low_memory=False, usecols=["game_id", "home_team_id", "away_team_id"])
    teams = teams.set_index("game_id")
    views = {p["puzzleId"]: p for part in ("sim", "ranked") for p in artifacts[part + "_public"]["puzzles"]}
    answers = artifacts["sim_private"]["answers"] + artifacts["ranked_private"]["answers"]
    for i in np.random.default_rng(2).choice(len(answers), 150, replace=False):
        a = answers[i]
        game = s[s["gameId"] == a["gameId"]].iloc[0]
        for side in ("home", "away"):
            team = teams.loc[a["gameId"], side + "_team_id"]
            prior = s[(s["teamId"] == team) & (s["season"] == game["season"]) & (s["t"] < game["t"])]
            expected = min((game["t"].normalize() - prior["t"].max().normalize()).days, gen.REST_CAP_DAYS)
            assert views[a["puzzleId"]][side]["restDays"] == expected
            assert views[a["puzzleId"]][side]["backToBack"] == (expected == 1)


@needs_pool
def test_model_probability_matches_a_live_model_call(artifacts):
    with open(gen.MODEL_PATH, "rb") as f:
        model = pickle.load(f)
    columns = json.loads(gen.COLUMNS_PATH.read_text())
    answers = artifacts["sim_private"]["answers"] + artifacts["ranked_private"]["answers"]
    sample = [answers[i] for i in np.random.default_rng(1).choice(len(answers), 200, replace=False)]
    matchup = pd.read_csv(gen.MATCHUP_PATH, low_memory=False, usecols=["game_id"] + columns)
    rows = matchup.set_index("game_id").loc[[r["gameId"] for r in sample], columns]
    live = model.predict_proba(rows)[:, 1]
    stored = np.array([r["modelHomeWinProbability"] for r in sample])
    assert np.abs(live - stored).max() < 1e-5
