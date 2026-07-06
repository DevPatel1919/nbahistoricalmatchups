"""
setup_production.py

One-time setup script: copies trained model artifacts from models/experiments/
to models/production/ and archives old baseline models.

Run once from the project root:
    python scripts/setup_production.py

Safe to re-run — skips files that already exist in the destination.
Does NOT delete originals; archives old baseline files instead.
"""

import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

COPIES = [
    (
        REPO / "models" / "experiments" / "best_experiment_model.pkl",
        REPO / "models" / "production" / "best_experiment_model.pkl",
    ),
    (
        REPO / "models" / "experiments" / "point_margin_model.pkl",
        REPO / "models" / "production" / "point_margin_model.pkl",
    ),
    (
        REPO / "models" / "experiments" / "best_experiment_columns.json",
        REPO / "models" / "production" / "best_experiment_columns.json",
    ),
]

# Old baseline files to archive (not delete)
ARCHIVE_FILES = [
    (
        REPO / "models" / "historical_matchup_model.pkl",
        REPO / "archive" / "old_models" / "historical_matchup_model.pkl",
    ),
    (
        REPO / "models" / "model_columns.json",
        REPO / "archive" / "old_models" / "model_columns.json",
    ),
    (
        REPO / "models" / "model_metrics.json",
        REPO / "archive" / "old_models" / "model_metrics.json",
    ),
    (
        REPO / "models" / "feature_experiment_results.csv",
        REPO / "archive" / "old_reports" / "feature_experiment_results.csv",
    ),
    (
        REPO / "models" / "logistic_coefficients.csv",
        REPO / "archive" / "old_reports" / "logistic_coefficients.csv",
    ),
    (
        REPO / "models" / "top_prediction_errors.csv",
        REPO / "archive" / "old_reports" / "top_prediction_errors.csv",
    ),
    (
        REPO / "src" / "models" / "train_model.py",
        REPO / "archive" / "old_scripts" / "train_model.py",
    ),
]


def main():
    print("=" * 60)
    print("NBA Matchup Simulator — Production Setup")
    print("=" * 60)

    # Copy production model files
    print("\n[1/2] Copying production model artifacts...")
    for src, dst in COPIES:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not src.exists():
            print(f"  SKIP (source missing): {src.name}")
            continue
        if dst.exists():
            print(f"  SKIP (already exists): {dst.name}")
        else:
            shutil.copy2(src, dst)
            size = dst.stat().st_size
            print(f"  COPIED: {src.name} -> models/production/  ({size:,} bytes)")

    # Archive old files (copy to archive, don't delete originals)
    print("\n[2/2] Archiving old baseline files...")
    for src, dst in ARCHIVE_FILES:
        dst.parent.mkdir(parents=True, exist_ok=True)
        if not src.exists():
            print(f"  SKIP (not found): {src.name}")
            continue
        if dst.exists():
            print(f"  SKIP (archive already has): {dst.name}")
        else:
            shutil.copy2(src, dst)
            print(f"  ARCHIVED: {src.name} -> {dst.relative_to(REPO)}")

    # Verify production artifacts
    print("\n[3/3] Verifying production artifacts...")
    all_ok = True
    for _, dst in COPIES:
        if dst.exists():
            print(f"  OK: {dst.relative_to(REPO)}")
        else:
            print(f"  MISSING: {dst.relative_to(REPO)}")
            all_ok = False

    print()
    if all_ok:
        print("Setup complete. Production models ready at models/production/")
        print("Run a test: python src/models/test_prediction_pipeline.py")
    else:
        print("Setup incomplete. Some source files were not found.")
        print("Make sure train_model_experiments.py has been run first.")


if __name__ == "__main__":
    main()
