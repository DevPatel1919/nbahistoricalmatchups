"""
release.py

Model release bundles for the Historical NBA Matchup Simulator.

A release is one immutable folder, models/releases/<version>/, holding every
artifact the prediction path needs plus a manifest.json that pins each file by
sha256:

    manifest.json     version, purpose, file hashes, column count, schema, limits
    classifier.pkl    win-probability pipeline
    regressor.pkl     point-margin pipeline
    columns.json      exact feature order both pipelines were fit on
    metrics.json      what the model scored, and whether that may be quoted

models/production/ACTIVE_RELEASE names the one release that is live. Promotion
and rollback rewrite only that pointer, atomically. Nothing falls back file by
file: a release either validates as a whole or fails before inference with a
single ReleaseError that says how to fix it.

Import anywhere the model is needed:
    from src.models.release import load_active_release
    release = load_active_release()
    release.classifier.predict_proba(X)

Build, activate, or roll back a release with scripts/promote_release.py.
"""

import hashlib
import json
import os
import pickle
import shutil
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Paths and contract constants
# ---------------------------------------------------------------------------

RELEASES_DIR        = REPO_ROOT / "models" / "releases"
PRODUCTION_DIR      = REPO_ROOT / "models" / "production"
ACTIVE_POINTER_NAME = "ACTIVE_RELEASE"
ACTIVE_POINTER_PATH = PRODUCTION_DIR / ACTIVE_POINTER_NAME

MANIFEST_NAME    = "manifest.json"
MANIFEST_VERSION = 1

# Bump when team_season_profiles_extended.csv changes a column's meaning, so an
# old release cannot silently read new-meaning inputs.
PROFILE_SCHEMA_VERSION = "team_season_profiles_extended.v1"

ALLOWED_PURPOSES = {"historical_entertainment"}

BUNDLE_FILES = {
    "classifier": "classifier.pkl",
    "regressor":  "regressor.pkl",
    "columns":    "columns.json",
    "metrics":    "metrics.json",
}

PROMOTE_HINT = "Build and activate a complete release with: python scripts/promote_release.py --help"


class ReleaseError(RuntimeError):
    """The model release is missing, partial, tampered with, or inconsistent."""


@dataclass(frozen=True)
class Release:
    version:     str
    directory:   Path
    manifest:    dict
    classifier:  object = field(repr=False)
    regressor:   object = field(repr=False)
    columns:     list   = field(repr=False)
    metrics:     dict   = field(repr=False)

    @property
    def purpose(self) -> str:
        return self.manifest["purpose"]

    @property
    def classifier_name(self) -> str:
        return self.manifest["classifier"]["estimator"]

    @property
    def regressor_name(self) -> str:
        return self.manifest["regressor"]["estimator"]

    @property
    def profile_base_stats(self) -> list[str]:
        return parse_base_stats(self.columns)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 16), b""):
            h.update(block)
    return h.hexdigest()


def parse_base_stats(cols: list[str]) -> list[str]:
    """Unique profile stat names behind home_/away_/_diff model columns."""
    bases = set()
    for col in cols:
        if col.startswith("home_") or col.startswith("away_"):
            bases.add(col[5:])
        elif col.endswith("_diff"):
            bases.add(col[:-5])
        else:
            raise ReleaseError("Unrecognized model column pattern: " + col)
    return sorted(bases)


def final_estimator_name(model) -> str:
    """Class name of a pipeline's last step (or of a bare estimator)."""
    steps = getattr(model, "steps", None)
    return type(steps[-1][1] if steps else model).__name__


def _fail(version: str, problem: str) -> ReleaseError:
    return ReleaseError("Model release '" + version + "' is invalid: " + problem + "\n" + PROMOTE_HINT)


# ---------------------------------------------------------------------------
# Loading and validation
# ---------------------------------------------------------------------------

def load_release(directory: Path) -> Release:
    """
    Load and fully validate one release folder. Hashes are checked before any
    pickle is opened. Raises ReleaseError on the first inconsistency.
    """
    directory = Path(directory)
    version = directory.name
    manifest_path = directory / MANIFEST_NAME

    if not manifest_path.exists():
        raise _fail(version, "no " + MANIFEST_NAME + " in " + str(directory) + ".")
    with open(manifest_path) as f:
        manifest = json.load(f)

    if manifest.get("manifestVersion") != MANIFEST_VERSION:
        raise _fail(version, "manifestVersion is " + str(manifest.get("manifestVersion")) + ", expected " + str(MANIFEST_VERSION) + ".")
    if manifest.get("version") != version:
        raise _fail(version, "manifest version '" + str(manifest.get("version")) + "' does not match its folder name.")
    if manifest.get("purpose") not in ALLOWED_PURPOSES:
        raise _fail(version, "purpose '" + str(manifest.get("purpose")) + "' is not one of " + str(sorted(ALLOWED_PURPOSES)) + ".")
    if manifest.get("profileSchemaVersion") != PROFILE_SCHEMA_VERSION:
        raise _fail(version, "built for profile schema '" + str(manifest.get("profileSchemaVersion"))
                    + "' but the code reads '" + PROFILE_SCHEMA_VERSION + "'.")

    # Every file present and matching its pinned hash, before anything is unpickled.
    for role, expected_name in BUNDLE_FILES.items():
        entry = manifest.get(role)
        if not isinstance(entry, dict) or "path" not in entry or "sha256" not in entry:
            raise _fail(version, "manifest has no complete '" + role + "' entry.")
        if entry["path"] != expected_name:
            raise _fail(version, role + " path is '" + entry["path"] + "', expected '" + expected_name + "'.")
        path = directory / entry["path"]
        if not path.exists():
            raise _fail(version, role + " file " + entry["path"] + " is missing. Partial bundles are not loadable.")
        actual = sha256_of(path)
        if actual != entry["sha256"]:
            raise _fail(version, role + " file " + entry["path"] + " hash " + actual[:12]
                        + "... does not match manifest " + entry["sha256"][:12] + "...")

    with open(directory / BUNDLE_FILES["columns"]) as f:
        columns = json.load(f)
    with open(directory / BUNDLE_FILES["metrics"]) as f:
        metrics = json.load(f)
    with open(directory / BUNDLE_FILES["classifier"], "rb") as f:
        classifier = pickle.load(f)
    with open(directory / BUNDLE_FILES["regressor"], "rb") as f:
        regressor = pickle.load(f)

    if not isinstance(columns, list) or not columns or len(set(columns)) != len(columns):
        raise _fail(version, "columns.json must be a non-empty list of unique names.")
    if manifest["columns"].get("count") != len(columns):
        raise _fail(version, "manifest column count " + str(manifest["columns"].get("count"))
                    + " does not match columns.json (" + str(len(columns)) + ").")
    parse_base_stats(columns)

    for role, model in [("classifier", classifier), ("regressor", regressor)]:
        fitted = getattr(model, "feature_names_in_", None)
        if fitted is None:
            raise _fail(version, role + " was not fit on named columns; cannot confirm its feature order.")
        if list(fitted) != columns:
            raise _fail(version, role + " was fit on " + str(len(fitted))
                        + " features that differ from columns.json (" + str(len(columns)) + ").")
        name = final_estimator_name(model)
        if manifest[role].get("estimator") != name:
            raise _fail(version, role + " is a " + name + " but the manifest says "
                        + str(manifest[role].get("estimator")) + ".")

    if 1 not in list(classifier.classes_):
        raise _fail(version, "classifier has no home-win class 1; classes are " + str(list(classifier.classes_)) + ".")

    return Release(
        version    = version,
        directory  = directory,
        manifest   = manifest,
        classifier = classifier,
        regressor  = regressor,
        columns    = columns,
        metrics    = metrics,
    )


def active_version(pointer_path: Path = ACTIVE_POINTER_PATH) -> str:
    """Read the active release name, refusing a production folder with loose artifacts."""
    pointer_path = Path(pointer_path)
    production = pointer_path.parent

    if production.exists():
        stray = sorted(p.name for p in production.iterdir() if p.name != pointer_path.name)
        if stray:
            raise ReleaseError(
                "models/production/ must contain only " + pointer_path.name + ", but also has "
                + str(stray) + ". Loose artifacts there are never loaded; move them into a "
                "release or to archive/.\n" + PROMOTE_HINT
            )

    if not pointer_path.exists():
        raise ReleaseError("No active model release: " + str(pointer_path) + " does not exist.\n" + PROMOTE_HINT)

    version = pointer_path.read_text().strip()
    if not version:
        raise ReleaseError("Active release pointer " + str(pointer_path) + " is empty.\n" + PROMOTE_HINT)
    return version


def load_active_release(
    releases_dir: Path = RELEASES_DIR,
    pointer_path: Path = ACTIVE_POINTER_PATH,
) -> Release:
    """Resolve the active pointer and load that whole release."""
    version = active_version(pointer_path)
    directory = Path(releases_dir) / version
    if not directory.is_dir():
        raise ReleaseError("Active release '" + version + "' has no folder at " + str(directory) + ".\n" + PROMOTE_HINT)
    return load_release(directory)


def check_profiles(release: Release, profile_columns) -> None:
    """Raise ReleaseError if the profile table lacks any stat the release reads."""
    missing = [s for s in release.profile_base_stats if s not in set(profile_columns)]
    if missing:
        raise ReleaseError(
            "Team profiles are missing " + str(len(missing)) + " stat(s) that release '"
            + release.version + "' needs: " + str(missing[:10])
            + ". Rebuild data/processed/team_season_profiles_extended.csv."
        )


# ---------------------------------------------------------------------------
# Building and promotion
# ---------------------------------------------------------------------------

def build_release(
    version: str,
    classifier_path: Path,
    regressor_path: Path,
    columns_path: Path,
    metrics: dict,
    info: dict,
    releases_dir: Path = RELEASES_DIR,
) -> Path:
    """
    Copy one training run's artifacts into a new immutable release folder and
    write its manifest. The folder is assembled under a temporary name and
    renamed into place only after it validates, so a failed build leaves nothing.

    info must provide: purpose, description, limitations (list),
    trainedThroughSeason, and source (where the artifacts came from).
    """
    releases_dir = Path(releases_dir)
    final_dir = releases_dir / version
    if final_dir.exists():
        raise ReleaseError("Release '" + version + "' already exists. Releases are immutable; choose a new version.")

    for key in ["purpose", "description", "limitations", "trainedThroughSeason", "source"]:
        if key not in info:
            raise ReleaseError("Release info is missing '" + key + "'.")

    staging = releases_dir / (".building-" + version)
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    try:
        shutil.copy2(classifier_path, staging / BUNDLE_FILES["classifier"])
        shutil.copy2(regressor_path,  staging / BUNDLE_FILES["regressor"])
        shutil.copy2(columns_path,    staging / BUNDLE_FILES["columns"])
        with open(staging / BUNDLE_FILES["metrics"], "w") as f:
            json.dump(metrics, f, indent=2)
            f.write("\n")

        with open(staging / BUNDLE_FILES["columns"]) as f:
            columns = json.load(f)
        with open(staging / BUNDLE_FILES["classifier"], "rb") as f:
            clf_name = final_estimator_name(pickle.load(f))
        with open(staging / BUNDLE_FILES["regressor"], "rb") as f:
            reg_name = final_estimator_name(pickle.load(f))

        manifest = {
            "manifestVersion":      MANIFEST_VERSION,
            "version":              version,
            "purpose":              info["purpose"],
            "description":          info["description"],
            "limitations":          info["limitations"],
            "source":               info["source"],
            "classifier":           {"path": BUNDLE_FILES["classifier"], "sha256": sha256_of(staging / BUNDLE_FILES["classifier"]), "estimator": clf_name},
            "regressor":            {"path": BUNDLE_FILES["regressor"],  "sha256": sha256_of(staging / BUNDLE_FILES["regressor"]),  "estimator": reg_name},
            "columns":              {"path": BUNDLE_FILES["columns"],    "sha256": sha256_of(staging / BUNDLE_FILES["columns"]),    "count": len(columns)},
            "metrics":              {"path": BUNDLE_FILES["metrics"],    "sha256": sha256_of(staging / BUNDLE_FILES["metrics"])},
            "metricsPath":          BUNDLE_FILES["metrics"],
            "profileSchemaVersion": PROFILE_SCHEMA_VERSION,
            "trainedThroughSeason": int(info["trainedThroughSeason"]),
        }
        with open(staging / MANIFEST_NAME, "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")

        # load_release() checks the folder name against the manifest version,
        # so validate under the final name by renaming, and undo on failure.
        os.replace(staging, final_dir)
        try:
            load_release(final_dir)
        except ReleaseError:
            shutil.rmtree(final_dir)
            raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)

    return final_dir


def activate(
    version: str,
    releases_dir: Path = RELEASES_DIR,
    pointer_path: Path = ACTIVE_POINTER_PATH,
) -> str | None:
    """
    Validate a release, then atomically point production at it. Returns the
    previously active version (or None) so the caller can report a rollback.
    Used for both promotion and rollback.
    """
    pointer_path = Path(pointer_path)
    load_release(Path(releases_dir) / version)

    previous = pointer_path.read_text().strip() if pointer_path.exists() else None

    pointer_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = pointer_path.with_name(pointer_path.name + ".tmp")
    tmp.write_text(version + "\n")
    os.replace(tmp, pointer_path)
    return previous
