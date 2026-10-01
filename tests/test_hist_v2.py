"""
test_hist_v2.py

F11 Phase A tests for hist-v2's data, its era-relative inputs, its leakage
guard, its release, and serving it.

The unit tests run on hand-made rows. Tests that read data/raw/ or the
hist-v2 release are skipped when those are absent.

Run from repo root:
    python -m pytest tests/test_hist_v2.py -v
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
from src.models import predict_matchup as pm                   # noqa: E402
from src.models import release as rel                          # noqa: E402
from src.models import test_pregame_leakage as guard           # noqa: E402

HIST_V2 = rel.RELEASES_DIR / "hist-v2"

needs_raw = pytest.mark.skipif(
    not (prof.STATS_PATH.exists() and prof.BASIC_STATS_PATH.exists() and prof.GAMES_TABLE_PATH.exists()
         and prof.TEAM_HISTORY_PATH.exists()),
    reason="raw data not imported",
)
needs_hist_v2 = pytest.mark.skipif(not (HIST_V2 / rel.MANIFEST_NAME).exists(), reason="hist-v2 not built")

# Raw drifting stats that must never reach a hist-v2 model column
DRIFTING = ["offensive_rating", "defensive_rating", "pace", "true_shooting", "effective_field_goal",
            "three_pt_pct", "ft_pct", "turnover_percentage", "assist"]


# ---------------------------------------------------------------------------
# A1: blank game types
# ---------------------------------------------------------------------------

def games_table(tmp_path: Path, rows: list) -> Path:
    path = tmp_path / "Games.csv"
    pd.DataFrame(rows, columns=["gameId", "gameType"]).to_csv(path, index=False)
    return path


def team_rows(*game_ids, game_type=np.nan) -> pd.DataFrame:
    return pd.DataFrame({"gameId": list(game_ids), "gameType": [game_type] * len(game_ids)})


def test_blank_counted_games_are_filled_and_preseason_stays_out(tmp_path):
    path = games_table(tmp_path, [(22100001, "Regular Season"), (42100101, "Playoffs"),
                                  (52100101, "Play-in Tournament"), (12100001, "Preseason")])
    out = prof.fill_missing_game_types(team_rows(22100001, 42100101, 52100101, 12100001), path)
    assert out["gameType"].tolist()[:3] == ["Regular Season", "Playoffs", "Play-in Tournament"]
    assert pd.isna(out["gameType"].iloc[3])


def test_counted_game_missing_from_games_table_is_an_error(tmp_path):
    path = games_table(tmp_path, [(22100001, "Regular Season")])
    with pytest.raises(ValueError, match="no gameType"):
        prof.fill_missing_game_types(team_rows(22100001, 22100002), path)


def test_games_table_type_must_match_the_game_id(tmp_path):
    path = games_table(tmp_path, [(22100001, "Playoffs")])
    with pytest.raises(ValueError, match="disagree"):
        prof.fill_missing_game_types(team_rows(22100001), path)


def test_filled_rows_keep_existing_types(tmp_path):
    path = games_table(tmp_path, [(22100001, "Regular Season")])
    rows = pd.concat([team_rows(22100001), team_rows(42100101, game_type="Playoffs")], ignore_index=True)
    assert prof.fill_missing_game_types(rows, path)["gameType"].tolist() == ["Regular Season", "Playoffs"]


# ---------------------------------------------------------------------------
# A2: the October 2020 Finals
# ---------------------------------------------------------------------------

def test_playoff_games_take_their_calendar_year():
    dates = pd.Series(["2020-10-11 19:30:00", "2020-10-11 19:30:00", "2020-12-22 19:00:00", "2021-06-01 20:00:00"])
    types = pd.Series(["Playoffs", "Regular Season", "Regular Season", "Playoffs"])
    assert prof.assign_season_playoffs_by_year(dates, types).tolist() == [2020, 2021, 2021, 2021]
    assert prof.assign_season(dates).tolist() == [2021, 2021, 2021, 2021]   # duel path unchanged


# ---------------------------------------------------------------------------
# A3: one definition of "compared with its own league"
# ---------------------------------------------------------------------------

def league(values: dict, season: int, n: int) -> pd.DataFrame:
    rows = pd.DataFrame({"team_id": range(n), "season": season})
    for stat in prof.RELATIVE_STATS:
        rows[stat] = values.get(stat, np.linspace(0.3, 0.7, n))
    return rows


def test_relative_columns_against_a_reference():
    profiles = pd.concat([league({"regular_net_rating": [-6.0, 0.0, 6.0]}, 1990, 3),
                          league({"regular_net_rating": [2.0, 2.0, 2.0]}, 1991, 3)], ignore_index=True)
    ref = prof.league_reference(profiles)
    assert ref.loc[1990, ("regular_net_rating", "mean")] == 0.0
    assert ref.loc[1990, ("regular_net_rating", "std")] == pytest.approx(6.0)   # ddof 1

    frame = pd.DataFrame({"home_regular_net_rating": [3.0, 3.0, 3.0]})
    for stat in prof.RELATIVE_STATS:
        if "home_" + stat not in frame.columns:
            frame["home_" + stat] = 0.5
    out = prof.add_relative_columns(frame, pd.Series([1990, 1991, 1989]), ref, prefix="home_")
    z = out["home_regular_net_rating_z"]
    assert z.iloc[0] == pytest.approx(0.5)
    assert np.isnan(z.iloc[1])        # std 0
    assert np.isnan(z.iloc[2])        # season not in the reference


def test_served_profiles_use_their_own_season():
    profiles = pd.concat([league({"regular_net_rating": [-6.0, 0.0, 6.0]}, 1990, 3),
                          league({"regular_net_rating": [-1.0, 0.0, 1.0]}, 2020, 3)], ignore_index=True)
    out = prof.add_own_season_relative_columns(profiles)
    assert out["regular_net_rating_z"].tolist() == pytest.approx([-1.0, 0.0, 1.0, -1.0, 0.0, 1.0])


def test_rebound_percentages_are_not_relative_stats():
    assert not set(prof.RELATIVE_STATS) & {"regular_rebound_percentage", "regular_offensive_rebound_percentage",
                                           "regular_defensive_rebound_percentage"}
    assert len(prof.RELATIVE_STATS) == 14


@pytest.mark.parametrize("col, safe", [
    ("home_regular_net_rating_z", True),
    ("regular_pace_z_diff", True),
    ("away_regular_win_pct", True),
    ("playoff_win_pct_diff", True),
    ("made_playoffs_diff", True),
    ("home_regular_offensive_rating", False),
    ("regular_pace_diff", False),
    ("home_playoff_offensive_rating", False),
    ("regular_rebound_percentage_z_diff", False),
    ("away_regular_three_pt_pct", False),
])
def test_era_safe_rule(col, safe):
    assert prof.is_era_safe_column(col) is safe


# ---------------------------------------------------------------------------
# Raw data: the fixes on the real files
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def filled_games():
    return prof.load_team_games(2020, prof.load_allowed_team_ids(), fill_game_types=True)


@needs_raw
def test_2022_has_a_full_league(filled_games):
    p = prof.build_season_profiles(filled_games)
    y2022 = p[p["season"] == 2022]
    assert len(y2022) == 30
    assert y2022["regular_games_played"].mean() == pytest.approx(82.0)
    champs = y2022.sort_values("playoff_wins").iloc[-1]
    assert (champs["team_city"], champs["team_name"], int(champs["playoff_wins"])) == ("Golden State", "Warriors", 16)


@needs_raw
def test_bubble_finals_stay_in_2020(filled_games):
    p = prof.build_season_profiles(filled_games).set_index(["season", "team_name"])
    assert p.loc[(2020, "Lakers"), "playoff_wins"] == 16
    assert p.loc[(2021, "Lakers"), "playoff_games_played"] == 6     # 2021: a first-round exit
    assert p.loc[(2021, "Heat"), "playoff_games_played"] == 4


# ---------------------------------------------------------------------------
# A4: the leakage guard on era-relative columns
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def z_season():
    """Point-in-time 2023 rows with z-scores against 2022 (the reference the 2022 fix restores)."""
    ids   = prof.load_allowed_team_ids()
    stats = prof.load_team_games(2022, ids, fill_game_types=True)
    stats = stats[stats["season"] <= 2023]
    games = matchup.load_games(2023, ids, playoffs_by_year=True)
    games = games[games["season"] == 2023]
    m = matchup.attach_point_in_time_profiles(games, stats).reset_index(drop=True)
    profiles = prof.build_season_profiles(stats)
    raw = guard.prepare_stats(stats.drop(columns="season"), playoffs_by_year=True)
    return m, profiles, raw


def with_z(m: pd.DataFrame, profiles: pd.DataFrame, seasons: pd.Series) -> pd.DataFrame:
    ref = prof.league_reference(profiles)
    for side in ("home", "away"):
        m = prof.add_relative_columns(m, seasons, ref, prefix=side + "_")
    return m


@needs_raw
def test_guard_passes_previous_season_z(z_season):
    m, profiles, raw = z_season
    built = with_z(m, profiles, m["season"] - 1)
    assert guard.check_relative(built, raw, guard.sample_rows(built)) == []


@needs_raw
def test_guard_fails_when_z_uses_the_games_own_season(z_season):
    m, profiles, raw = z_season
    leaked = with_z(m, profiles, m["season"])
    failures = guard.check_relative(leaked, raw, guard.sample_rows(leaked))
    assert len(failures) > 1000
    assert {f[1] for f in failures} >= {"home_regular_net_rating_z", "away_regular_offensive_rating_z"}


# ---------------------------------------------------------------------------
# A7: the hist-v2 release
# ---------------------------------------------------------------------------

@needs_hist_v2
def test_hist_v2_loads_and_reads_only_era_safe_columns():
    release = rel.load_release(HIST_V2)
    assert release.purpose == "historical_entertainment"
    assert release.manifest["trainedThroughSeason"] == 2018
    assert release.metrics["publicAccuracyClaim"] is None
    unsafe = [c for c in release.columns if not prof.is_era_safe_column(c)]
    assert unsafe == []
    raw_drift = [c for c in release.columns if not c.endswith("_z") and not c.endswith("_z_diff")
                 and any(d in c for d in DRIFTING)]
    assert raw_drift == []


@needs_hist_v2
def test_hist_v1_stays_loadable_for_rollback():
    assert rel.load_release(rel.RELEASES_DIR / "hist-v1").version == "hist-v1"
    assert rel.active_version() in ("hist-v1", "hist-v2")


# ---------------------------------------------------------------------------
# A6: predict_matchup and the export agree on hist-v2
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def older_profiles_csv(tmp_path_factory):
    """1986-2026 served-style profiles (what Phase B serves), in a temp CSV."""
    stats = prof.load_team_games(prof.OLDER_ERA_START + 1, prof.load_allowed_team_ids(), fill_game_types=True)
    path = tmp_path_factory.mktemp("profiles") / "team_season_profiles_extended.csv"
    prof.build_season_profiles(stats).to_csv(path, index=False)
    return path


@pytest.fixture
def serve_hist_v2(monkeypatch, older_profiles_csv):
    from scripts import export_static_site_data as export
    monkeypatch.setattr(pm, "_PROFILES_PATH", older_profiles_csv)
    monkeypatch.setattr(pm, "load_active_release", lambda: rel.load_release(HIST_V2))
    monkeypatch.setattr(export, "PROFILES_PATH", older_profiles_csv)
    pm._release = pm._clf = pm._reg = pm._cols = pm._profiles = None
    yield export
    monkeypatch.undo()
    pm._release = pm._clf = pm._reg = pm._cols = pm._profiles = None


def exported_pair(export, profiles: pd.DataFrame, key_a: str, key_b: str, release) -> tuple[float, float]:
    """Neutral p and margin for A exactly as export_static_site_data.main() writes them."""
    i = int(profiles.index[profiles["key"] == key_a][0])
    j = int(profiles.index[profiles["key"] == key_b][0])
    pair = profiles.loc[[i, j]].reset_index(drop=True)
    P, M = export.score_all_ordered_pairs(pair, release.classifier, release.regressor, release.columns)
    return round(float((P[0, 1] + (1 - P[1, 0])) / 2), 4), round(float((M[0, 1] - M[1, 0]) / 2), 1)


@needs_raw
@needs_hist_v2
@pytest.mark.parametrize("key_a, a, sa, key_b, b, sb", [
    ("1996-bulls",   "Chicago Bulls",      1996, "2017-warriors", "Golden State Warriors", 2017),
    ("1990-bullets", "Washington Wizards", 1990, "2022-warriors", "Golden State Warriors", 2022),
])
def test_cross_era_pair_matches_between_predict_and_export(serve_hist_v2, key_a, a, sa, key_b, b, sb):
    from scripts.verify_static_export import neutral_prediction
    export = serve_hist_v2
    release = rel.load_release(HIST_V2)
    profiles = export.load_profiles_with_identity()

    live_p, live_m = neutral_prediction(a, sa, b, sb)
    assert pm.get_release().version == "hist-v2"
    exp_p, exp_m = exported_pair(export, profiles, key_a, key_b, release)
    assert exp_p == pytest.approx(live_p, abs=1e-6)
    assert exp_m == pytest.approx(live_m, abs=0.05)

    # The same z-scores in both paths
    z_cols = [c for c in profiles.columns if c.endswith("_z")]
    live_row = pm.find_team_profile(a, sa)
    exp_row  = profiles.loc[profiles["key"] == key_a].iloc[0]
    assert len(z_cols) == len(prof.RELATIVE_STATS)
    for c in z_cols:
        assert live_row[c] == pytest.approx(exp_row[c], abs=1e-12, nan_ok=True)


@needs_raw
@needs_hist_v2
def test_hist_v2_warnings_match_its_training(serve_hist_v2):
    result = pm.predict_matchup("Philadelphia 76ers", 2016, "Brooklyn Nets", 2016)
    assert result["model_release"] == "hist-v2"
    assert result["warnings"]
    trained_playoffs_only = rel.load_release(HIST_V2).metrics.get("trainingFilter") == "playoffs_only"
    assert any("trained on playoff games only" in w for w in result["warnings"]) == trained_playoffs_only
