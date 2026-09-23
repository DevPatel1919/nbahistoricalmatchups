"""
verify_static_export.py

Acceptance check for scripts/export_static_site_data.py (see
docs/frontend-handoff.md, "Step 3: acceptance checks").

Samples 200 random team-season pairs from the exported JSON in
frontend/public/data/, recomputes each pair LIVE with predict_matchup()
(both home/away orderings, neutralised exactly as export_static_site_data.py
does), and compares against what was exported. This is the check that
matters: a silently wrong export would serve wrong numbers on every page of
the site.

A pair passes if:
    |exported_p - live_neutral_p| <= 1e-6
    |exported_m - live_neutral_m| <= 0.05

Exits non-zero if any pair fails, or if setup is broken.

The exported JSON stores each team-season's ERA-CORRECT name (e.g. "2005
Seattle SuperSonics"), but predict_matchup() looks teams up by the name in
team_season_profiles_extended.csv, which uses each franchise's CURRENT name
(e.g. "Thunder" for that same 2005 team-season). So this script looks up the
current name/season pair by franchiseId + season before calling
predict_matchup(), exactly as the frontend never needs to (it only ever
reads precomputed JSON).

Run from repo root (after scripts/export_static_site_data.py):
    python scripts/verify_static_export.py
"""

import json
import random
import sys
from pathlib import Path

import pandas as pd

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.models.model_config import PROFILES_PATH
from src.models.predict_matchup import predict_matchup

REPO_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR   = REPO_ROOT / "frontend" / "public" / "data"
INDEX_PATH = DATA_DIR / "index.json"
TEAMS_DIR  = DATA_DIR / "teams"

SAMPLE_SIZE     = 200
PROB_TOLERANCE  = 1e-6
MARGIN_TOLERANCE = 0.05
RANDOM_SEED     = 42


def load_current_name_lookup() -> dict:
    """(franchiseId, season) -> current team_city/team_name, as used by predict_matchup()."""
    profiles = pd.read_csv(PROFILES_PATH)
    lookup = {}
    for _, row in profiles.iterrows():
        lookup[(int(row["team_id"]), int(row["season"]))] = (row["team_city"], row["team_name"])
    return lookup


def neutral_prediction(name_a: str, season_a: int, name_b: str, season_b: int) -> tuple[float, float]:
    """Live neutral-site probability/margin for A, computed exactly as the export script does."""
    ab = predict_matchup(name_a, season_a, name_b, season_b)
    ba = predict_matchup(name_b, season_b, name_a, season_a)

    p_ab = ab["team_a_win_probability"]
    p_ba = ba["team_a_win_probability"]
    neutral_p_a = (p_ab + (1 - p_ba)) / 2

    m_ab = ab["projected_margin_team_a"]
    m_ba = ba["projected_margin_team_a"]
    neutral_margin_a = (m_ab - m_ba) / 2

    return round(neutral_p_a, 4), round(neutral_margin_a, 1)


def main():
    if not INDEX_PATH.exists():
        raise ValueError("Missing " + str(INDEX_PATH) + " -- run scripts/export_static_site_data.py first.")

    index = json.load(open(INDEX_PATH))
    teams = index["teams"]
    if len(teams) == 0:
        raise ValueError("index.json has no teams.")

    name_lookup = load_current_name_lookup()

    random.seed(RANDOM_SEED)
    keys = [t["key"] for t in teams]
    by_key = {t["key"]: t for t in teams}

    sample_pairs = set()
    while len(sample_pairs) < min(SAMPLE_SIZE, len(keys) * (len(keys) - 1) // 2):
        a, b = random.sample(keys, 2)
        pair = tuple(sorted((a, b)))
        sample_pairs.add(pair)
    sample_pairs = list(sample_pairs)

    print("Sampling " + str(len(sample_pairs)) + " pairs for verification...")

    failures = []
    prob_diffs = []
    margin_diffs = []

    for key_a, key_b in sample_pairs:
        team_a = by_key[key_a]
        team_b = by_key[key_b]

        exported = json.load(open(TEAMS_DIR / (key_a + ".json")))
        if key_b not in exported["opponents"]:
            failures.append(key_a + " vs " + key_b + ": " + key_b + " missing from " + key_a + ".json")
            continue
        exported_p = exported["opponents"][key_b]["p"]
        exported_m = exported["opponents"][key_b]["m"]

        try:
            current_a = name_lookup[(team_a["franchiseId"], team_a["season"])]
            current_b = name_lookup[(team_b["franchiseId"], team_b["season"])]
        except KeyError as e:
            failures.append(key_a + " vs " + key_b + ": no current-name lookup for " + str(e))
            continue

        name_a = current_a[0] + " " + current_a[1]
        name_b = current_b[0] + " " + current_b[1]

        live_p, live_m = neutral_prediction(name_a, team_a["season"], name_b, team_b["season"])

        p_diff = abs(exported_p - live_p)
        m_diff = abs(exported_m - live_m)
        prob_diffs.append(p_diff)
        margin_diffs.append(m_diff)

        if p_diff > PROB_TOLERANCE:
            failures.append(
                key_a + " vs " + key_b + ": probability mismatch -- exported=" + str(exported_p)
                + " live=" + str(live_p) + " diff=" + str(p_diff)
            )
        if m_diff > MARGIN_TOLERANCE:
            failures.append(
                key_a + " vs " + key_b + ": margin mismatch -- exported=" + str(exported_m)
                + " live=" + str(live_m) + " diff=" + str(m_diff)
            )

    print("Checked: " + str(len(sample_pairs)))
    print("Max probability diff: " + str(max(prob_diffs) if prob_diffs else 0.0))
    print("Max margin diff: " + str(max(margin_diffs) if margin_diffs else 0.0))
    print("Mean probability diff: " + str(sum(prob_diffs) / len(prob_diffs) if prob_diffs else 0.0))
    print("Mean margin diff: " + str(sum(margin_diffs) / len(margin_diffs) if margin_diffs else 0.0))

    if failures:
        print("\nFAILED: " + str(len(failures)) + " mismatch(es):")
        for f in failures:
            print("  " + f)
        sys.exit(1)

    print("\nPASSED: all " + str(len(sample_pairs)) + " sampled pairs matched within tolerance.")
    sys.exit(0)


if __name__ == "__main__":
    main()
