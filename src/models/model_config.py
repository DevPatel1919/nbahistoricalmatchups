"""
model_config.py

Central registry for data and report paths.

Served model artifacts are NOT listed here. They are resolved as one validated
bundle through src/models/release.py (models/production/ACTIVE_RELEASE ->
models/releases/<version>/). Model name, version, feature count, and metrics
come from that release's manifest, never from constants in this file.

Import anywhere paths are needed:
    from src.models.model_config import PROFILES_PATH
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Experiment artifact paths (training outputs; never loaded for serving)
# ---------------------------------------------------------------------------

_EXP = REPO_ROOT / "models" / "experiments"

EXPERIMENT_METRICS_PATH   = _EXP / "experiment_metrics.json"
FEATURE_COEFFICIENTS_PATH = _EXP / "feature_coefficients.csv"

# ---------------------------------------------------------------------------
# Data paths
# ---------------------------------------------------------------------------

PROFILES_PATH            = REPO_ROOT / "data" / "processed" / "team_season_profiles_extended.csv"
TEAM_SEASON_PROFILE_PATH = PROFILES_PATH  # legacy alias

# ---------------------------------------------------------------------------
# Report paths
# ---------------------------------------------------------------------------

REPORTS_DIR               = REPO_ROOT / "reports"
AUDITS_DIR                = REPORTS_DIR / "audits"
PREDICTIONS_DIR           = REPORTS_DIR / "predictions"
AUDIT_CONTRACT_REPORT     = AUDITS_DIR  / "prediction_input_contract.md"
SAMPLE_PREDICTIONS_REPORT = PREDICTIONS_DIR / "sample_matchup_predictions.md"
