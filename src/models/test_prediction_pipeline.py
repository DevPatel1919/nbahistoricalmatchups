"""
test_prediction_pipeline.py

End-to-end production prediction test.
Runs 6 historical matchups through the full pipeline and generates a markdown report.

Run from project root:
    python src/models/test_prediction_pipeline.py

Outputs:
    reports/predictions/sample_matchup_predictions.md
"""

import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from src.models.predict_matchup import predict_matchup, find_team_profile, list_available_teams, _load
from src.models.model_config import (
    CLF_MODEL_PATH,
    REG_MODEL_PATH,
    MODEL_COLUMNS_PATH,
    PROFILES_PATH,
    SAMPLE_PREDICTIONS_REPORT,
    MODEL_VERSION,
    MODEL_NAME,
    FEATURE_COUNT,
    TEST_METRICS,
)

# ---------------------------------------------------------------------------
# Target matchups
# ---------------------------------------------------------------------------

TARGET_MATCHUPS = [
    ("Chicago Bulls",          1998, "Golden State Warriors",  2017),
    ("Los Angeles Lakers",     2001, "Golden State Warriors",  2017),
    ("Denver Nuggets",         2023, "Toronto Raptors",        2019),
    ("Boston Celtics",         2024, "Denver Nuggets",         2023),
    ("Detroit Pistons",        2004, "Golden State Warriors",  2016),
    ("Los Angeles Lakers",     2020, "Milwaukee Bucks",        2021),
]

# Feature keys to print for each matchup
DETAIL_COLS = [
    "regular_win_pct",
    "playoff_win_pct",
    "regular_net_rating",
    "regular_true_shooting_percentage",
    "regular_three_pt_pct",
    "playoff_win_pct",
]


def _get_stat(profile, col: str):
    val = profile.get(col)
    if val is None:
        return "N/A"
    try:
        return round(float(val), 4)
    except (TypeError, ValueError):
        return val


def _resolve_matchups(targets: list[tuple]) -> list[tuple]:
    """
    Verify each target matchup exists in the CSV.
    If a team/season is missing, replace with a valid alternative from the same era.
    Returns list of (a_name, a_season, b_name, b_season, note).
    """
    _load()
    resolved = []
    for a_name, a_season, b_name, b_season in targets:
        note = ""
        try:
            find_team_profile(a_name, a_season)
        except ValueError as e:
            # Fall back: find any playoff team from that season
            available = list_available_teams(a_season)
            playoff = available[available["made_playoffs"] == 1]
            if len(playoff) > 0:
                row = playoff.iloc[0]
                new_name = f"{row['team_city']} {row['team_name']}"
                note += f"Replaced '{a_name} {a_season}' with '{new_name} {a_season}'. "
                a_name = new_name
            else:
                note += f"No playoff teams found for {a_season}. "

        try:
            find_team_profile(b_name, b_season)
        except ValueError:
            available = list_available_teams(b_season)
            playoff = available[available["made_playoffs"] == 1]
            if len(playoff) > 0:
                row = playoff.iloc[0]
                new_name = f"{row['team_city']} {row['team_name']}"
                note += f"Replaced '{b_name} {b_season}' with '{new_name} {b_season}'. "
                b_name = new_name
            else:
                note += f"No playoff teams found for {b_season}. "

        resolved.append((a_name, a_season, b_name, b_season, note.strip()))
    return resolved


def run_tests() -> list[dict]:
    """Run all target matchups and return list of result dicts."""
    matchups = _resolve_matchups(TARGET_MATCHUPS)
    results = []

    for a_name, a_season, b_name, b_season, note in matchups:
        entry = {"note": note}
        try:
            result = predict_matchup(a_name, a_season, b_name, b_season)
            entry.update(result)

            # Fetch raw profile stats for the report
            pa = find_team_profile(a_name, a_season)
            pb = find_team_profile(b_name, b_season)

            entry["team_a_regular_win_pct"]    = _get_stat(pa, "regular_win_pct")
            entry["team_b_regular_win_pct"]    = _get_stat(pb, "regular_win_pct")
            entry["team_a_playoff_win_pct"]    = _get_stat(pa, "playoff_win_pct")
            entry["team_b_playoff_win_pct"]    = _get_stat(pb, "playoff_win_pct")
            entry["team_a_made_playoffs"]      = int(pa.get("made_playoffs", 0))
            entry["team_b_made_playoffs"]      = int(pb.get("made_playoffs", 0))
            entry["playoff_win_pct_diff"]      = round(
                float(pa.get("playoff_win_pct", 0)) - float(pb.get("playoff_win_pct", 0)), 4
            )
            entry["regular_net_rating_diff"]   = round(
                float(pa.get("regular_net_rating", 0)) - float(pb.get("regular_net_rating", 0)), 2
            )
            entry["regular_ts_pct_diff"]       = round(
                float(pa.get("regular_true_shooting_percentage", 0)) - float(pb.get("regular_true_shooting_percentage", 0)), 4
            )
            entry["regular_three_pt_pct_diff"] = round(
                float(pa.get("regular_three_pt_pct", 0)) - float(pb.get("regular_three_pt_pct", 0)), 4
            )
            entry["error"] = None

        except Exception as e:
            entry["team_a"]   = f"{a_name} {a_season}"
            entry["team_b"]   = f"{b_name} {b_season}"
            entry["error"]    = str(e)
            print(f"  ERROR: {e}")

        results.append(entry)

    return results


def print_results(results: list[dict]) -> None:
    for r in results:
        print()
        print(f"  Matchup:     {r.get('team_a', '?')}  vs  {r.get('team_b', '?')}")
        if r.get("error"):
            print(f"  ERROR: {r['error']}")
            continue
        print(f"  Mode:        {r.get('prediction_mode', '?')}")
        print(f"  Winner:      {r.get('predicted_winner', '?')}")
        print(f"  Prob A:      {r.get('team_a_win_probability', 0):.1%}   Prob B: {r.get('team_b_win_probability', 0):.1%}")
        print(f"  Margin:      {r.get('projected_margin_winner_text', '?')}")
        print(f"  Both made playoffs: {'Yes' if r.get('team_a_made_playoffs') and r.get('team_b_made_playoffs') else 'No'}")
        print(f"  A reg win%: {r.get('team_a_regular_win_pct')}   B reg win%: {r.get('team_b_regular_win_pct')}")
        print(f"  A ply win%: {r.get('team_a_playoff_win_pct')}   B ply win%: {r.get('team_b_playoff_win_pct')}")
        print(f"  playoff_win_pct_diff:      {r.get('playoff_win_pct_diff')}")
        print(f"  regular_net_rating_diff:   {r.get('regular_net_rating_diff')}")
        print(f"  regular_ts_pct_diff:       {r.get('regular_ts_pct_diff')}")
        print(f"  regular_3pt_pct_diff:      {r.get('regular_three_pt_pct_diff')}")
        if r.get("warnings"):
            for w in r["warnings"]:
                print(f"  WARNING: {w}")
        if r.get("note"):
            print(f"  NOTE: {r['note']}")


def generate_report(results: list[dict]) -> None:
    SAMPLE_PREDICTIONS_REPORT.parent.mkdir(parents=True, exist_ok=True)

    now    = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    lines  = []

    lines += [
        "# Sample Matchup Predictions",
        "",
        f"Generated: {now}",
        f"Model version: {MODEL_VERSION}  (`{MODEL_NAME}`)",
        "",
        "## Source",
        "",
        f"| Field | Value |",
        f"| ----- | ----- |",
        f"| Team profile CSV | `{PROFILES_PATH.relative_to(PROFILES_PATH.parents[2])}` |",
        f"| Classification model | `{CLF_MODEL_PATH.relative_to(CLF_MODEL_PATH.parents[2])}` |",
        f"| Regression model | `{REG_MODEL_PATH.relative_to(REG_MODEL_PATH.parents[2])}` |",
        f"| Model columns | `{MODEL_COLUMNS_PATH.relative_to(MODEL_COLUMNS_PATH.parents[2])}` |",
        f"| Model feature count | {FEATURE_COUNT} |",
        f"| Test accuracy | {TEST_METRICS['accuracy']} |",
        f"| Test ROC-AUC | {TEST_METRICS['roc_auc']} |",
        "",
    ]

    # Compute team-seasons from profile CSV
    try:
        profiles = pd.read_csv(PROFILES_PATH)
        lines.append(f"Total team-seasons available: **{len(profiles)}** "
                     f"({profiles['season'].min():.0f}–{profiles['season'].max():.0f})")
    except Exception:
        lines.append("Total team-seasons available: see team_season_profiles_extended.csv")
    lines.append("")

    lines += [
        "## Matchup Results",
        "",
        "| Matchup | Mode | Predicted Winner | A Win% | B Win% | Margin | A Reg Win% | B Reg Win% | A Playoff Win% | B Playoff Win% | Warnings |",
        "| ------- | ---- | ---------------- | ------ | ------ | ------ | ---------- | ---------- | -------------- | -------------- | -------- |",
    ]

    for r in results:
        if r.get("error"):
            lines.append(
                f"| {r.get('team_a','?')} vs {r.get('team_b','?')} | ERROR | — | — | — | {r['error']} | — | — | — | — | — |"
            )
            continue

        mode      = r.get("prediction_mode", "?").replace("playoff_context_model_extrapolated", "extrapolated")
        winner    = r.get("predicted_winner", "?")
        a_prob    = f"{r.get('team_a_win_probability', 0):.1%}"
        b_prob    = f"{r.get('team_b_win_probability', 0):.1%}"
        margin    = r.get("projected_margin_winner_text", "?")
        a_reg     = r.get("team_a_regular_win_pct", "?")
        b_reg     = r.get("team_b_regular_win_pct", "?")
        a_ply     = r.get("team_a_playoff_win_pct", "?")
        b_ply     = r.get("team_b_playoff_win_pct", "?")
        warn_str  = "; ".join(r.get("warnings", [])) or "none"
        if len(warn_str) > 60:
            warn_str = warn_str[:57] + "..."

        lines.append(
            f"| {r['team_a']} vs {r['team_b']} | {mode} | {winner} | {a_prob} | {b_prob} | {margin} | {a_reg} | {b_reg} | {a_ply} | {b_ply} | {warn_str} |"
        )
    lines.append("")

    lines += [
        "## Key Feature Diffs",
        "",
        "| Matchup | playoff_win_pct_diff | regular_net_rating_diff | regular_ts_pct_diff | regular_3pt_pct_diff |",
        "| ------- | -------------------- | ----------------------- | ------------------- | -------------------- |",
    ]
    for r in results:
        if r.get("error"):
            continue
        lines.append(
            f"| {r['team_a']} vs {r['team_b']} | {r.get('playoff_win_pct_diff','?')} | {r.get('regular_net_rating_diff','?')} | {r.get('regular_ts_pct_diff','?')} | {r.get('regular_three_pt_pct_diff','?')} |"
        )
    lines.append("")

    lines += [
        "## Notes",
        "",
        "**Classification model** predicts win probability using 71 features.",
        "The strongest predictor is `playoff_win_pct_diff` (coefficient 1.19 — by far the dominant feature).",
        "",
        "**Regression model** predicts the projected point margin.",
        "A positive margin means Team A is favored by that many points.",
        "A negative margin means Team B is favored.",
        "",
        "**Prediction mode:**",
        "- `playoff_context_model` — both teams made the playoffs; model is operating within its training distribution.",
        "- `playoff_context_model_extrapolated` — one or both teams did not make the playoffs;",
        "  playoff context features for those teams are filled with 0, which may reduce accuracy.",
        "  A warning is added to the result.",
        "",
        "**Model strengths:** Cross-era comparisons between playoff-caliber teams.",
        "Dynasty teams (championship runs, high playoff win%) will be heavily favored over regular-season teams.",
        "This is by design — the model learned from actual playoff game outcomes.",
        "",
        "**Model limitations:** The regression R² is only 0.22, meaning projected margins have",
        "high variance (~13 RMSE). Use margins as rough guidance, not precise forecasts.",
    ]

    with open(SAMPLE_PREDICTIONS_REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print(f"\nReport saved to: {SAMPLE_PREDICTIONS_REPORT}")


def main() -> None:
    print("=" * 65)
    print("NBA Historical Matchup Simulator — Prediction Pipeline Test")
    print("=" * 65)

    print(f"\nClassification model: {CLF_MODEL_PATH}")
    print(f"Regression model:     {REG_MODEL_PATH}")
    print(f"Model columns:        {MODEL_COLUMNS_PATH}")
    print(f"Team profiles:        {PROFILES_PATH}")

    if not CLF_MODEL_PATH.exists():
        print("\nERROR: Classification model not found.")
        print("Run 'python scripts/setup_production.py' first to copy models to production/.")
        return

    print(f"\nRunning {len(TARGET_MATCHUPS)} matchups...\n")
    results = run_tests()
    print_results(results)

    ok       = sum(1 for r in results if not r.get("error"))
    errors   = sum(1 for r in results if r.get("error"))

    print(f"\n{'='*65}")
    print(f"Results: {ok} successful, {errors} failed out of {len(results)} matchups")
    generate_report(results)

    print("\n=== PIPELINE TEST SUMMARY ===")
    print(f"  Matchups tested:       {len(results)}")
    print(f"  Successful:            {ok}")
    print(f"  Failed:                {errors}")
    print(f"  Report:                {SAMPLE_PREDICTIONS_REPORT}")
    print(f"  Model version:         {MODEL_VERSION}")
    print(f"  Feature count:         {FEATURE_COUNT}")


if __name__ == "__main__":
    main()
