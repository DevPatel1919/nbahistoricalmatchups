"""
test_release_integrity.py

F01 acceptance tests for model release bundles (src/models/release.py).

Failure tests build throwaway releases in a temp folder from the committed
hist-v1 artifacts. The smoke suite runs representative matchups through the
active release and needs data/processed/team_season_profiles_extended.csv;
it is skipped when that gitignored file is absent.

Run from repo root:
    python -m pytest tests/test_release_integrity.py -v
"""

import json
import shutil
from pathlib import Path

import pytest

from src.models import predict_matchup as pm
from src.models import release as rel
from src.models.model_config import PROFILES_PATH

REPO_ROOT   = Path(__file__).resolve().parents[1]
SHIPPED     = rel.RELEASES_DIR / "hist-v1"
RETRAIN_DIR = REPO_ROOT / "models" / "experiments" / "pregame_retrain"
INDEX_PATH  = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
TEAMS_DIR   = INDEX_PATH.parent / "teams"

INFO = {
    "purpose":              "historical_entertainment",
    "description":          "test release",
    "limitations":          ["test only"],
    "trainedThroughSeason": 2018,
    "source":               "tests",
}

needs_profiles = pytest.mark.skipif(not PROFILES_PATH.exists(), reason="team profiles CSV not built")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def layout(tmp_path):
    """Empty releases/ and production/ folders for one test."""
    releases = tmp_path / "releases"
    production = tmp_path / "production"
    releases.mkdir()
    production.mkdir()
    return releases, production / rel.ACTIVE_POINTER_NAME


def build(releases: Path, version: str, columns_path: Path = None) -> Path:
    return rel.build_release(
        version         = version,
        classifier_path = SHIPPED / "classifier.pkl",
        regressor_path  = SHIPPED / "regressor.pkl",
        columns_path    = columns_path or SHIPPED / "columns.json",
        metrics         = {"publicAccuracyClaim": None},
        info            = INFO,
        releases_dir    = releases,
    )


def rewrite_manifest(directory: Path, **changes) -> None:
    path = directory / rel.MANIFEST_NAME
    manifest = json.loads(path.read_text())
    manifest.update(changes)
    path.write_text(json.dumps(manifest, indent=2))


# ---------------------------------------------------------------------------
# Reproduction of the 2026-09-22 mismatch
# ---------------------------------------------------------------------------

def test_legacy_partial_production_folder_is_rejected(layout):
    """
    The old loader took best_experiment_columns.json from models/production/
    and the weights from models/experiments/, so a retrain loaded 196-column
    weights against a 70-column list and failed deep inside sklearn. Loose
    files in production/ must now stop loading outright, with or without a
    pointer, and nothing may fall back to another folder.
    """
    releases, pointer = layout
    shutil.copy2(SHIPPED / "columns.json", pointer.parent / "best_experiment_columns.json")

    with pytest.raises(rel.ReleaseError, match="must contain only ACTIVE_RELEASE"):
        rel.load_active_release(releases, pointer)

    build(releases, "v1")
    pointer.write_text("v1\n")
    with pytest.raises(rel.ReleaseError, match="best_experiment_columns.json"):
        rel.load_active_release(releases, pointer)


def test_missing_pointer_is_one_actionable_error(layout):
    releases, pointer = layout
    build(releases, "v1")
    with pytest.raises(rel.ReleaseError, match="(?s)No active model release.*promote_release.py"):
        rel.load_active_release(releases, pointer)


def test_retrained_weights_with_stale_columns_cannot_be_built(layout):
    """The same mix as the Sep 22 break, attempted as a release, never lands on disk."""
    releases, _ = layout
    bad_columns = releases.parent / "stale_columns.json"
    retrain_cols = json.loads((RETRAIN_DIR / "best_experiment_columns.json").read_text())
    bad_columns.write_text(json.dumps(retrain_cols))

    with pytest.raises(rel.ReleaseError, match="differ from columns.json"):
        build(releases, "mixed", columns_path=bad_columns)
    assert list(releases.iterdir()) == []


# ---------------------------------------------------------------------------
# Mixed or damaged bundles fail before inference
# ---------------------------------------------------------------------------

def test_mixed_bundle_with_matching_hashes_fails_on_feature_names(layout):
    """Hashes alone are not enough: a re-hashed foreign columns.json must still fail."""
    releases, _ = layout
    directory = build(releases, "v1")
    retrain_cols = (RETRAIN_DIR / "best_experiment_columns.json").read_bytes()
    (directory / "columns.json").write_bytes(retrain_cols)
    count = len(json.loads(retrain_cols))
    rewrite_manifest(
        directory,
        columns={"path": "columns.json", "sha256": rel.sha256_of(directory / "columns.json"), "count": count},
    )
    with pytest.raises(rel.ReleaseError, match="differ from columns.json"):
        rel.load_release(directory)


def test_swapped_artifact_fails_hash_check(layout):
    releases, _ = layout
    directory = build(releases, "v1")
    shutil.copy2(RETRAIN_DIR / "best_experiment_model.pkl", directory / "classifier.pkl")
    with pytest.raises(rel.ReleaseError, match="classifier file classifier.pkl hash"):
        rel.load_release(directory)


def test_missing_regressor_is_a_partial_bundle(layout):
    releases, _ = layout
    directory = build(releases, "v1")
    (directory / "regressor.pkl").unlink()
    with pytest.raises(rel.ReleaseError, match="regressor file regressor.pkl is missing"):
        rel.load_release(directory)


@pytest.mark.parametrize("changes, message", [
    ({"profileSchemaVersion": "team_season_profiles_extended.v0"}, "profile schema"),
    ({"purpose": "betting"}, "purpose"),
    ({"version": "other"}, "does not match its folder name"),
])
def test_manifest_disagreements_are_rejected(layout, changes, message):
    releases, _ = layout
    directory = build(releases, "v1")
    rewrite_manifest(directory, **changes)
    with pytest.raises(rel.ReleaseError, match=message):
        rel.load_release(directory)


def test_manifest_column_count_must_match(layout):
    releases, _ = layout
    directory = build(releases, "v1")
    columns = json.loads((directory / rel.MANIFEST_NAME).read_text())["columns"]
    rewrite_manifest(directory, columns={**columns, "count": 71})
    with pytest.raises(rel.ReleaseError, match="column count 71"):
        rel.load_release(directory)


def test_predict_matchup_fails_before_inference(layout, monkeypatch):
    releases, pointer = layout
    directory = build(releases, "v1")
    (directory / "regressor.pkl").unlink()
    pointer.write_text("v1\n")

    monkeypatch.setattr(pm, "load_active_release", lambda: rel.load_active_release(releases, pointer))
    pm._release = pm._clf = pm._reg = pm._cols = pm._profiles = None
    try:
        with pytest.raises(rel.ReleaseError, match="Partial bundles are not loadable"):
            pm.predict_matchup("Warriors", 2017, "Bulls", 1998)
        assert pm._clf is None and pm._reg is None
    finally:
        monkeypatch.undo()
        pm._release = pm._clf = pm._reg = pm._cols = pm._profiles = None


# ---------------------------------------------------------------------------
# Promotion and rollback
# ---------------------------------------------------------------------------

def test_promote_and_roll_back_as_one_unit(layout):
    releases, pointer = layout
    build(releases, "v1")
    build(releases, "v2")

    assert rel.activate("v1", releases, pointer) is None
    assert rel.activate("v2", releases, pointer) == "v1"
    assert rel.load_active_release(releases, pointer).version == "v2"

    assert rel.activate("v1", releases, pointer) == "v2"
    assert rel.load_active_release(releases, pointer).version == "v1"


def test_invalid_release_is_never_activated(layout):
    releases, pointer = layout
    build(releases, "v1")
    broken = build(releases, "v2")
    (broken / "columns.json").write_text("[]")

    rel.activate("v1", releases, pointer)
    with pytest.raises(rel.ReleaseError):
        rel.activate("v2", releases, pointer)
    assert pointer.read_text().strip() == "v1"


def test_releases_are_immutable(layout):
    releases, _ = layout
    build(releases, "v1")
    with pytest.raises(rel.ReleaseError, match="immutable"):
        build(releases, "v1")


# ---------------------------------------------------------------------------
# The committed active release and its public metadata
# ---------------------------------------------------------------------------

def test_active_release_is_hist_v2_and_valid():
    release = rel.load_active_release()
    assert release.version == "hist-v2"
    assert release.purpose == "historical_entertainment"
    assert release.manifest["columns"]["count"] == len(release.columns) == 14
    assert release.manifest["trainedThroughSeason"] == 2018


def test_hist_v1_still_loads_for_rollback():
    """promote_release.py --activate hist-v1 must keep working (F11)."""
    release = rel.load_release(SHIPPED)
    assert release.version == "hist-v1"
    assert release.manifest["columns"]["count"] == len(release.columns) == 70
    assert release.metrics["recordedAtTraining"]["validForClaims"] is False


def test_active_release_publishes_no_accuracy_claim():
    release = rel.load_active_release()
    assert release.metrics["publicAccuracyClaim"] is None
    assert any("margin is approximate" in l for l in release.manifest["limitations"])


def test_static_export_matches_active_release():
    index = json.loads(INDEX_PATH.read_text())
    release = rel.load_active_release()
    assert index["release"] == {
        "version":                 release.version,
        "purpose":                 release.purpose,
        "nonPlayoffExtrapolation": rel.extrapolates_non_playoff_teams(release),
    }


def test_only_a_playoffs_only_release_extrapolates_non_playoff_teams():
    """hist-v1 trained on playoff games only; hist-v2 on all game types, regular-season stats only."""
    assert rel.extrapolates_non_playoff_teams(rel.load_release(SHIPPED)) is True
    assert rel.extrapolates_non_playoff_teams(rel.load_release(rel.RELEASES_DIR / "hist-v2")) is False


# ---------------------------------------------------------------------------
# prediction_mode follows how the release was trained
# ---------------------------------------------------------------------------

PLAYOFF     = {"made_playoffs": 1, "team_city": "Golden State", "team_name": "Warriors"}
NON_PLAYOFF = {"made_playoffs": 0, "team_city": "Philadelphia", "team_name": "76ers"}


@pytest.mark.parametrize("a, b", [(PLAYOFF, PLAYOFF), (PLAYOFF, NON_PLAYOFF), (NON_PLAYOFF, PLAYOFF),
                                  (NON_PLAYOFF, NON_PLAYOFF)])
def test_non_playoff_teams_are_not_extrapolations_for_hist_v2(a, b):
    mode, warnings = pm._prediction_mode(a, b, extrapolates_non_playoff=False)
    assert mode == pm.MODE_REGULAR_SEASON_RELATIVE
    assert warnings == []


@pytest.mark.parametrize("a, b, mode, warned", [
    (PLAYOFF,     PLAYOFF,     "playoff_context_model",              False),
    (PLAYOFF,     NON_PLAYOFF, "playoff_context_model_extrapolated", True),
    (NON_PLAYOFF, NON_PLAYOFF, "playoff_context_model_extrapolated", True),
])
def test_playoffs_only_release_still_flags_extrapolation(a, b, mode, warned):
    got, warnings = pm._prediction_mode(a, b, extrapolates_non_playoff=True)
    assert got == mode
    assert bool(warnings) is warned
    assert all("trained on playoff games only" in w for w in warnings)


# ---------------------------------------------------------------------------
# Smoke suite: representative matchups through the active release
# ---------------------------------------------------------------------------

SMOKE_MATCHUPS = [
    # label,                                 team A,                  season, team B,                  season, a non-playoff team?
    ("playoff vs playoff",                    "Golden State Warriors", 2017, "Cleveland Cavaliers",     2016, False),
    ("same season, both missed playoffs",     "Philadelphia 76ers",    2016, "Brooklyn Nets",           2016, True),
    ("same season, one missed playoffs",      "Golden State Warriors", 2016, "Philadelphia 76ers",      2016, True),
    ("historical names: Sonics vs Vancouver", "Oklahoma City Thunder", 2005, "Memphis Grizzlies",       1999, True),
    ("cross-era",                             "Chicago Bulls",         1998, "Denver Nuggets",          2023, False),
    # F11: 1985-86 to 1996-97 (predict_matchup finds teams by current franchise name)
    ("older playoff team",                    "Boston Celtics",        1986, "Detroit Pistons",         1989, False),
    ("older non-playoff team",                "Clippers",              1987, "Los Angeles Lakers",      1987, True),
    ("historical name: 1990 Bullets",         "Washington Wizards",    1990, "Golden State Warriors",   2022, True),
    ("cross-era: 1996 Bulls vs 2017 Warriors", "Chicago Bulls",        1996, "Golden State Warriors",   2017, False),
]


def expected_mode(release, non_playoff: bool) -> str:
    """The mode a release should report: only a playoffs-only release extrapolates."""
    if not rel.extrapolates_non_playoff_teams(release):
        return "regular_season_relative_model"
    return "playoff_context_model_extrapolated" if non_playoff else "playoff_context_model"


def check_smoke(result, release, non_playoff: bool) -> None:
    mode = expected_mode(release, non_playoff)
    assert result["model_release"] == release.version
    assert result["model_purpose"] == release.purpose
    assert result["model_feature_count"] == release.manifest["columns"]["count"]
    assert result["prediction_mode"] == mode
    assert 0.0 < result["team_a_win_probability"] < 1.0
    assert result["team_a_win_probability"] + result["team_b_win_probability"] == pytest.approx(1.0, abs=1e-4)
    assert isinstance(result["projected_margin_team_a"], float)
    # A playoff warning appears exactly when the pair lies outside the training
    # data. (hist-v1 also warns that pre-1996-97 teams lack rebound percentages.)
    playoff_warnings = [w for w in result["warnings"] if "playoff" in w.lower()]
    assert bool(playoff_warnings) is mode.endswith("_extrapolated")
    if not rel.extrapolates_non_playoff_teams(release):
        assert result["warnings"] == []


@needs_profiles
@pytest.mark.parametrize("label, a, sa, b, sb, non_playoff", SMOKE_MATCHUPS, ids=[m[0] for m in SMOKE_MATCHUPS])
def test_smoke_matchup(label, a, sa, b, sb, non_playoff):
    pm.reload()
    check_smoke(pm.predict_matchup(a, sa, b, sb), rel.load_active_release(), non_playoff)


@needs_profiles
@pytest.mark.parametrize("label, a, sa, b, sb, non_playoff", SMOKE_MATCHUPS, ids=[m[0] for m in SMOKE_MATCHUPS])
def test_smoke_matchup_after_rollback_to_hist_v1(monkeypatch, label, a, sa, b, sb, non_playoff):
    """A rollback to hist-v1 serves the same profiles and keeps its playoffs-only warnings."""
    monkeypatch.setattr(pm, "load_active_release", lambda: rel.load_release(SHIPPED))
    pm.reload()
    try:
        check_smoke(pm.predict_matchup(a, sa, b, sb), rel.load_release(SHIPPED), non_playoff)
    finally:
        monkeypatch.undo()
        pm._release = pm._clf = pm._reg = pm._cols = pm._profiles = None


@needs_profiles
def test_historical_name_resolves_through_export():
    """The site shows era-correct names; the exported pair must match live output."""
    from scripts.verify_static_export import neutral_prediction

    index = json.loads(INDEX_PATH.read_text())
    by_key = {t["key"]: t for t in index["teams"]}
    sonics = by_key["2005-supersonics"]
    assert (sonics["city"], sonics["name"]) == ("Seattle", "SuperSonics")

    exported = json.loads((TEAMS_DIR / "2005-supersonics.json").read_text())["opponents"]["1999-grizzlies"]
    reverse  = json.loads((TEAMS_DIR / "1999-grizzlies.json").read_text())["opponents"]["2005-supersonics"]
    assert exported["p"] + reverse["p"] == pytest.approx(1.0, abs=1e-4)

    pm.reload()
    live_p, live_m = neutral_prediction("Oklahoma City Thunder", 2005, "Memphis Grizzlies", 1999)
    assert exported["p"] == pytest.approx(live_p, abs=1e-6)
    assert exported["m"] == pytest.approx(live_m, abs=0.05)
