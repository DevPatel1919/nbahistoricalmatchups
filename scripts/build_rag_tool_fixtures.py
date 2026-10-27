"""
build_rag_tool_fixtures.py

Writes tests/fixtures/rag/tools.json: the outputs of Ask the Court's tools
(src/rag/tools.py) for a fixed set of matchups, team-seasons and seasons, and
the three template answers for each matchup (F13 Session 4). The Worker's
tools.ts and templates (Session 5) and the browser templates (Session 6) must
reproduce every case exactly.

Reads data/rag/facts.json, data/rag/model_inputs.json and
frontend/public/data/ (all committed). Deterministic; tests/test_rag_tools.py
rebuilds the cases and compares.

Run from repo root:
    python scripts/build_rag_tool_fixtures.py
"""

import json
import random
import sys
from pathlib import Path

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.rag.tools import SUGGESTED, Tools, template_answer

REPO_ROOT     = Path(__file__).resolve().parent.parent
FIXTURES_PATH = REPO_ROOT / "tests" / "fixtures" / "rag" / "tools.json"

SEED          = 20261027
RANDOM_PAIRS  = 24

# Hand-picked pairs: famous matchups, an even one, one whose two inputs pull
# opposite ways, box-score-era teams, short seasons, and both orders of one pair.
CHOSEN_PAIRS = [
    ("1996-bulls", "2017-warriors"),
    ("2017-warriors", "1996-bulls"),
    ("2008-pistons", "1987-celtics"),
    ("1986-celtics", "2016-warriors"),
    ("2004-pistons", "1993-knicks"),
    ("1999-spurs", "2012-heat"),
    ("2020-lakers", "2021-bucks"),
    ("1991-nuggets", "2025-thunder"),
    ("2001-lakers", "2015-warriors"),
    ("1990-bullets", "1996-supersonics"),
    ("2026-pistons", "2003-kings"),
    ("1987-lakers", "1988-celtics"),
]
CHOSEN_TEAMS   = ["1996-bulls", "1986-celtics", "2004-pistons", "1999-spurs", "2012-heat", "2021-bucks", "1991-nuggets"]
CHOSEN_SEASONS = [1986, 1996, 1999, 2012, 2020, 2026]


def pairs(tools: Tools) -> list[tuple[str, str]]:
    keys = sorted(tools.facts["teams"])
    rng = random.Random(SEED)
    out = list(CHOSEN_PAIRS)
    while len(out) < len(CHOSEN_PAIRS) + RANDOM_PAIRS:
        a, b = rng.sample(keys, 2)
        if (a, b) not in out:
            out.append((a, b))
    return out


def build_cases(tools: Tools) -> dict:
    matchups = []
    for a, b in pairs(tools):
        matchups.append({
            "a": a, "b": b,
            "get_matchup": tools.get_matchup(a, b),
            "facts":       tools.matchup_facts(a, b),
            "templates":   {kind: template_answer(tools, kind, a, b) for kind in SUGGESTED},
        })
    teams = [{"key": k, "get_team_season": tools.get_team_season(k), "fact": tools.team_fact(k)} for k in CHOSEN_TEAMS]
    seasons = [{"season": s, "get_season": tools.get_season(s), "fact": tools.season_fact(s)} for s in CHOSEN_SEASONS]
    return {"about": "Tool and template fixtures for F13 Ask the Court (src/rag/tools.py). The Worker's tools and "
                     "templates must reproduce every case exactly. Rebuild with scripts/build_rag_tool_fixtures.py.",
            "release": tools.facts["release"], "matchups": matchups, "teams": teams, "seasons": seasons}


def main():
    cases = build_cases(Tools.from_files())
    with open(FIXTURES_PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cases, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("Matchups: " + str(len(cases["matchups"])) + "  Teams: " + str(len(cases["teams"]))
          + "  Seasons: " + str(len(cases["seasons"])))
    print("Saved tool fixtures to " + str(FIXTURES_PATH))


if __name__ == "__main__":
    main()
