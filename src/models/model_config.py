"""
model_config.py

Central registry for model paths and metadata.
Production paths are under models/production/.
Falls back to models/experiments/ if production files have not yet been
copied by scripts/setup_production.py.

Import anywhere paths are needed:
    from src.models.model_config import CLF_MODEL_PATH, PROFILES_PATH
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve(production: Path, fallback: Path) -> Path:
    """Return production path if it exists, otherwise fall back to experiments."""
    return production if production.exists() else fallback


# ---------------------------------------------------------------------------
# Model artifact paths
# ---------------------------------------------------------------------------

_PROD = REPO_ROOT / "models" / "production"
_EXP  = REPO_ROOT / "models" / "experiments"

CLF_MODEL_PATH     = _resolve(_PROD / "best_experiment_model.pkl",   _EXP / "best_experiment_model.pkl")
REG_MODEL_PATH     = _resolve(_PROD / "point_margin_model.pkl",       _EXP / "point_margin_model.pkl")
MODEL_COLUMNS_PATH = _resolve(_PROD / "best_experiment_columns.json", _EXP / "best_experiment_columns.json")

# Experiment-only artifacts (not needed at prediction time)
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

# ---------------------------------------------------------------------------
# Model metadata
# ---------------------------------------------------------------------------

MODEL_NAME        = "baseline_v2_playoff_context_logreg_l1"
MODEL_VERSION     = "2.0"
MODEL_TYPE        = "historical_matchup_simulator"
MODEL_DESCRIPTION = (
    "Historical NBA matchup simulator using completed regular-season and playoff "
    "context. Classification predicts winner probability; regression predicts "
    "projected point margin. Trained on playoff games only (playoffs_only filter) "
    "using L1 Logistic Regression with regular + playoff context features."
)

CLASSIFICATION_MODEL = "LogisticRegression"
REGRESSION_MODEL     = "HistGradientBoostingRegressor"
BEST_DATASET_FILTER  = "playoffs_only"
BEST_FEATURE_SET     = "regular_plus_playoff_context"
FEATURE_COUNT        = 71
BEST_HYPERPARAMETERS = {
    "penalty":      "l1",
    "C":            0.1,
    "solver":       "liblinear",
    "class_weight": "balanced",
}
TEST_METRICS = {
    "accuracy":    0.7104,
    "roc_auc":     0.7685,
    "log_loss":    0.5678,
    "brier_score": 0.1937,
}
