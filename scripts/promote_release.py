"""
promote_release.py

Builds, activates, and rolls back Historical NBA Matchup Simulator releases.
A release is one immutable folder under models/releases/<version>/ (see
src/models/release.py). Production serves whichever release
models/production/ACTIVE_RELEASE names; activating rewrites only that pointer.

Build a release from one training run's artifacts (never activates it):
    --build VERSION --from DIR --info INFO.json

    DIR must contain best_experiment_model.pkl, point_margin_model.pkl, and
    best_experiment_columns.json from the SAME run. INFO.json supplies
    purpose, description, limitations, trainedThroughSeason, source, and a
    "metrics" object that is written as the release's metrics.json.

Activate (promote) or roll back to a built release:
    --activate VERSION

After activating, re-export and verify the static site data:
    python scripts/export_static_site_data.py
    python scripts/verify_static_export.py

Run from repo root:
    python scripts/promote_release.py --list
    python scripts/promote_release.py --build hist-v2 --from models/experiments --info release_info.json
    python scripts/promote_release.py --activate hist-v2
    python scripts/promote_release.py --activate hist-v1      # rollback
"""

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.models.release import (
    ACTIVE_POINTER_PATH,
    RELEASES_DIR,
    ReleaseError,
    activate,
    build_release,
    load_release,
)

CLASSIFIER_NAME = "best_experiment_model.pkl"
REGRESSOR_NAME  = "point_margin_model.pkl"
COLUMNS_NAME    = "best_experiment_columns.json"


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def list_releases() -> None:
    active = ACTIVE_POINTER_PATH.read_text().strip() if ACTIVE_POINTER_PATH.exists() else None
    versions = sorted(p.name for p in RELEASES_DIR.iterdir() if p.is_dir() and not p.name.startswith(".")) if RELEASES_DIR.exists() else []
    if not versions:
        print("No releases in " + str(RELEASES_DIR))
        return
    for v in versions:
        try:
            release = load_release(RELEASES_DIR / v)
            status = "valid, " + release.purpose + ", " + str(len(release.columns)) + " columns"
        except ReleaseError as e:
            status = "INVALID: " + str(e).splitlines()[0]
        print(("* " if v == active else "  ") + v + "  (" + status + ")")


def build(version: str, source_dir: Path, info_path: Path) -> None:
    with open(info_path) as f:
        info = json.load(f)
    if "metrics" not in info:
        raise ValueError(str(info_path) + " must contain a 'metrics' object.")
    metrics = info.pop("metrics")

    for name in [CLASSIFIER_NAME, REGRESSOR_NAME, COLUMNS_NAME]:
        if not (source_dir / name).exists():
            raise ValueError("Missing " + name + " in " + str(source_dir) + ". A release needs all three from one run.")

    out = build_release(
        version         = version,
        classifier_path = source_dir / CLASSIFIER_NAME,
        regressor_path  = source_dir / REGRESSOR_NAME,
        columns_path    = source_dir / COLUMNS_NAME,
        metrics         = metrics,
        info            = info,
    )
    print("Built release: " + str(out.relative_to(REPO_ROOT)))
    print("Not active yet. Activate with: python scripts/promote_release.py --activate " + version)


def activate_release(version: str) -> None:
    previous = activate(version)
    print("Active release: " + version + "  (previous: " + str(previous) + ")")
    if previous and previous != version:
        print("Roll back with: python scripts/promote_release.py --activate " + previous)
    print("Now re-export and verify:")
    print("  python scripts/export_static_site_data.py")
    print("  python scripts/verify_static_export.py")


def main():
    parser = argparse.ArgumentParser(description="Build, activate, or roll back model releases.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="List releases; * marks the active one.")
    group.add_argument("--build", metavar="VERSION", help="Build a new immutable release.")
    group.add_argument("--activate", metavar="VERSION", help="Validate and activate a release (also used to roll back).")
    parser.add_argument("--from", dest="source", type=Path, help="Folder holding one training run's artifacts (with --build).")
    parser.add_argument("--info", type=Path, help="Release info JSON (with --build).")
    args = parser.parse_args()

    try:
        if args.list:
            list_releases()
        elif args.build:
            if args.source is None or args.info is None:
                parser.error("--build needs --from and --info.")
            build(args.build, args.source, args.info)
        else:
            activate_release(args.activate)
    except ReleaseError as e:
        print("ERROR: " + str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
