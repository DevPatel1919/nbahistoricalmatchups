"""
test_older_seasons.py

F11 Session 1 tests for the 1985-86 to 1996-97 seasons.

The formula tests run on a hand-made game. The identity and leakage tests
read the gitignored raw files in data/raw/ and are skipped when they are
absent.

Run from repo root:
    python -m pytest tests/test_older_seasons.py -v
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend" / "scripts"))

import build_matchup_training_data as matchup                  # noqa: E402
import build_team_season_profiles_extended as prof            # noqa: E402
from src.models import test_pregame_leakage as guard           # noqa: E402

INDEX_PATH = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
needs_raw = pytest.mark.skipif(
    not (prof.STATS_PATH.exists() and prof.BASIC_STATS_PATH.exists() and prof.TEAM_HISTORY_PATH.exists()
         and matchup.GAMES_PATH.exists()),
    reason="raw data not imported",
)


# ---------------------------------------------------------------------------
# Box-score formulas
# ---------------------------------------------------------------------------

def one_game() -> pd.DataFrame:
    """Team 1 beats team 2, 110-100, with round numbers."""
    base = {"gameId": 1, "numMinutes": 240.0}
    a = {"teamId": 1, "opponentTeamId": 2, "teamScore": 110, "opponentScore": 100,
         "fieldGoalsMade": 40, "fieldGoalsAttempted": 85, "threePointersMade": 6,
         "freeThrowsAttempted": 25, "reboundsOffensive": 15, "reboundsDefensive": 30,
         "reboundsTotal": 45, "turnovers": 14, "assists": 24}
    b = {"teamId": 2, "opponentTeamId": 1, "teamScore": 100, "opponentScore": 110,
         "fieldGoalsMade": 38, "fieldGoalsAttempted": 88, "threePointersMade": 4,
         "freeThrowsAttempted": 20, "reboundsOffensive": 10, "reboundsDefensive": 28,
         "reboundsTotal": 38, "turnovers": 16, "assists": 20}
    return pd.DataFrame([{**base, **a}, {**base, **b}])


def test_possessions_average_both_teams_and_apply_the_scale():
    out = prof.compute_box_score_advanced(one_game())
    own = 85 + 0.44 * 25 - 15 + 14       # 95.0
    opp = 88 + 0.44 * 20 - 10 + 16       # 102.8
    expected = prof.POSSESSION_SCALE * (own + opp) / 2
    assert out["possessions"].tolist() == pytest.approx([expected, expected])
    assert out.loc[0, "offensiveRating"] == pytest.approx(100 * 110 / expected)
    assert out.loc[0, "netRating"] == pytest.approx(-out.loc[1, "netRating"])
    assert out.loc[0, "pace"] == pytest.approx(expected)          # 240 minutes


def test_shooting_and_rate_formulas():
    out = prof.compute_box_score_advanced(one_game()).iloc[0]
    assert out["plusMinusPoints"] == 10
    assert out["effectiveFieldGoalPercentage"] == pytest.approx((40 + 3) / 85)
    assert out["trueShootingPercentage"] == pytest.approx(110 / (2 * (85 + 0.44 * 25)))
    assert out["opponentEffectiveFieldGoalPercentage"] == pytest.approx((38 + 2) / 88)
    assert out["opponentFreeThrowAttemptRate"] == pytest.approx(20 / 88)
    assert out["assistPercentage"] == pytest.approx(24 / 40)
    assert out["teamTurnoverPercentage"] == pytest.approx(14 / out["possessions"])
    assert out["opponentTurnoverPercentage"] == pytest.approx(16 / out["possessions"])
    assert out["offensiveReboundPercentage"] == pytest.approx(15 / (15 + 28))


def test_every_formula_targets_a_profile_column():
    sources = {col for col, _digits in prof.MEAN_STATS.values()}
    assert set(prof.BOX_SCORE_FORMULAS) <= sources
    assert set(prof.UNMATCHED_FORMULA_COLS) <= set(prof.BOX_SCORE_FORMULAS)


def test_missing_opponent_row_is_an_error():
    with pytest.raises(ValueError, match="no opponent row"):
        prof.compute_box_score_advanced(one_game().iloc[:1])


def test_seasons_before_1986_are_refused():
    with pytest.raises(ValueError, match="not supported"):
        prof.load_team_games(prof.OLDER_ERA_START, set())


# ---------------------------------------------------------------------------
# Older seasons from the raw files
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def older_games():
    """1985-86 to 1996-97 per-team-game rows, as the profile builder loads them."""
    stats = prof.load_team_games(prof.OLDER_ERA_START + 1, prof.load_allowed_team_ids())
    return stats[stats["season"] <= prof.MODERN_ERA_START]


@needs_raw
def test_older_rows_leave_unrecorded_stats_blank(older_games):
    older = older_games[older_games["season"] <= prof.EXTENDED_STATS_START]
    blank = prof.SITUATIONAL_SOURCE_COLS + prof.UNMATCHED_FORMULA_COLS
    assert older[blank].isna().all().all()
    assert older["plusMinusPoints"].abs().sum() > 0     # the raw file stores 0 here
    assert older["offensiveRating"].notna().all()


@needs_raw
def test_older_profiles_have_unique_era_correct_keys(older_games):
    from scripts.export_static_site_data import attach_identity
    keyed = attach_identity(prof.build_season_profiles(older_games))
    assert len(keyed) == 314
    assert keyed["key"].is_unique
    for key in ("1986-celtics", "1989-pistons", "1990-bullets", "1996-bulls",
                "1996-supersonics", "1997-grizzlies", "1987-lakers"):
        assert key in set(keyed["key"]), key


@needs_raw
@pytest.mark.skipif(not INDEX_PATH.exists(), reason="static export not built")
def test_existing_keys_and_names_do_not_change():
    from scripts.export_static_site_data import attach_identity
    served = {t["key"]: (t["city"], t["name"]) for t in json.loads(INDEX_PATH.read_text())["teams"]}
    current = attach_identity(prof.build_season_profiles(
        prof.load_team_games(prof.MODERN_ERA_START + 1, prof.load_allowed_team_ids())))
    assert dict(zip(current["key"], zip(current["era_city"], current["era_name"]))) == served


# ---------------------------------------------------------------------------
# Leakage guard on older seasons
# ---------------------------------------------------------------------------

SEASON = 1990


@pytest.fixture(scope="module")
def season_rows(older_games):
    """Point-in-time matchup rows for one older season, and the guard's view of the raw rows."""
    stats = older_games[older_games["season"] == SEASON]
    games = matchup.load_games(SEASON, prof.load_allowed_team_ids())
    games = games[games["season"] == SEASON]
    m = matchup.attach_point_in_time_profiles(games, stats).reset_index(drop=True)
    return m, stats, guard.prepare_stats(stats.drop(columns="season"))


@needs_raw
def test_guard_passes_point_in_time_rows(season_rows):
    m, _stats, raw = season_rows
    assert guard.check_rows(m, raw, guard.sample_rows(m), guard.OLDER_PROFILE_MEANS) == []


@needs_raw
def test_guard_fails_on_full_season_profiles(season_rows):
    m, stats, raw = season_rows
    full = prof.build_season_profiles(stats).set_index("team_id")
    leaked = m.copy()
    leaked["home_regular_net_rating"] = leaked["home_team_id"].map(full["regular_net_rating"])
    assert len(guard.check_rows(leaked, raw, guard.sample_rows(leaked), guard.OLDER_PROFILE_MEANS)) > 100


@needs_raw
def test_guard_fails_when_a_game_sees_its_own_result(season_rows):
    m, stats, raw = season_rows
    stats = stats.copy()
    stats["game_time"] = matchup.parse_game_time(stats["gameDateTimeEst"])
    profile = matchup.cumulative_profiles(stats[stats["gameType"] == prof.GAME_TYPE_REGULAR], "regular")
    right = profile.rename(columns={"teamId": "home_team_id", "game_time": "_t",
                                    "regular_offensive_rating": "leaked"})
    games = m[["game_id", "home_team_id", "season"]].copy()
    games["_t"] = games["game_id"].map(stats.drop_duplicates("gameId").set_index("gameId")["game_time"])
    with_own = pd.merge_asof(games.sort_values("_t"), right[["home_team_id", "season", "_t", "leaked"]].sort_values("_t"),
                             on="_t", by=["home_team_id", "season"], allow_exact_matches=True)
    leaked = m.copy()
    leaked["home_regular_offensive_rating"] = leaked["game_id"].map(with_own.set_index("game_id")["leaked"])
    failures = guard.check_rows(leaked, raw, guard.sample_rows(leaked), guard.OLDER_PROFILE_MEANS)
    assert any(f[1] == "home_regular_offensive_rating" for f in failures)
    assert np.isfinite([f[2] for f in failures if f[1] == "home_regular_offensive_rating"]).all()
