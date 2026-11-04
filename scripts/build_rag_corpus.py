"""
build_rag_corpus.py

Builds the Ask the Court (F13 Session 1) retrieval corpus and the model-input
file behind its "why" explanations.

Reads:
  data/processed/team_season_profiles_extended.csv   (via the static export's loader,
  data/raw/TeamStatisticsExtended.csv, TeamStatistics.csv   which also attaches era-correct names)
  data/raw/Games.csv                                  champions (the Daily Three rule)
  frontend/public/data/index.json                     keys; must match the profiles
  frontend/public/data/teams/*.json                   exported p, for the reproduction check
  models/releases/<active>/                           classifier and manifest
  src/rag/sources/method_notes.md                     curated method notes

Writes (committed, so later sessions and cloud sessions need no raw data):
  data/rag/corpus.jsonl          one chunk per line (src/rag/corpus.py lists the fields)
  data/rag/model_inputs.json     the folded linear model and every team's non-zero-feature z-scores
  reports/rag_corpus.md          counts, token estimates, the reproduction check, sample chunks

The output is deterministic: a rebuild from the same inputs is byte-identical
(tests/test_rag_corpus.py checks it when data/raw/ is present).

Run from repo root:
    python scripts/build_rag_corpus.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from scripts.export_daily_data import GAMES_PATH, derive_champions, load_index
from scripts.export_static_site_data import load_profiles_with_identity
from src.models.release import load_active_release
from src.rag import corpus as rag

REPO_ROOT         = Path(__file__).resolve().parent.parent
INDEX_PATH        = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
TEAMS_DIR         = REPO_ROOT / "frontend" / "public" / "data" / "teams"
NOTES_PATH        = REPO_ROOT / "src" / "rag" / "sources" / "method_notes.md"
OUTPUT_DIR        = REPO_ROOT / "data" / "rag"
CORPUS_PATH       = OUTPUT_DIR / "corpus.jsonl"
MODEL_INPUTS_PATH = OUTPUT_DIR / "model_inputs.json"
REPORT_PATH       = REPO_ROOT / "reports" / "rag_corpus.md"

# Reproduction check: model_inputs must give the exported neutral p.
REPRO_SAMPLES   = 2000
REPRO_SEED      = 20261026
REPRO_TOLERANCE = 0.0005

# Chunks shown in full in the report, for the owner to read.
SAMPLE_IDS = {
    "team_card":   ["team:1996-bulls", "team:2004-pistons", "team:1986-celtics"],
    "season_card": ["season:1996", "season:1999", "season:2020"],
    "leaderboard": ["leaders:net-rating:all-time", "leaders:defence:1990s", "leaders:worst-win-pct:2010s"],
    "method":      ["method:model-weights", "method:why-teams-are-compared-with-their-own-league",
                    "method:release-limitations"],
}


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

def load_inputs():
    release = load_active_release()
    profiles = load_profiles_with_identity()
    index = load_index(INDEX_PATH)
    with open(INDEX_PATH, encoding="utf-8") as f:
        index_release = json.load(f)["release"]["version"]
    if index_release != release.version:
        raise ValueError("index.json was exported from " + index_release + " but the active release is "
                         + release.version + ". Re-export the static site data first.")

    profile_keys, index_keys = set(profiles["key"]), set(index["key"])
    if profile_keys != index_keys:
        raise ValueError("Profile and index.json keys differ: "
                         + str(sorted(profile_keys ^ index_keys)[:10]))
    names = index.set_index("key")[["city", "name"]]
    mismatch = [k for k, row in profiles.set_index("key").iterrows()
                if (row["era_city"], row["era_name"]) != tuple(names.loc[k])]
    if mismatch:
        raise ValueError("Era-correct names differ from index.json for " + str(mismatch[:10]))

    games = pd.read_csv(GAMES_PATH, usecols=["gameId", "gameDateTimeEst", "gameType", "winner"], low_memory=False)
    champions = derive_champions(games, index)

    with open(release.directory / "manifest.json", encoding="utf-8") as f:
        manifest = json.load(f)
    notes = NOTES_PATH.read_text(encoding="utf-8")
    return release, profiles, index_keys, champions, manifest, notes


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_jsonl(chunks: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False, separators=(",", ":")) + "\n")


def write_json(payload: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def token_table(chunks: list[dict]) -> list[str]:
    lines = ["| Type | Chunks | Tokens: min | median | 90th pct | max |", "|---|---|---|---|---|---|"]
    frame = pd.DataFrame({"type": [c["type"] for c in chunks],
                          "tokens": [rag.estimated_tokens(c["text"]) for c in chunks]})
    for chunk_type in ["team_card", "season_card", "leaderboard", "method"]:
        t = frame[frame["type"] == chunk_type]["tokens"]
        lines.append("| `" + chunk_type + "` | " + str(len(t)) + " | " + str(int(t.min())) + " | "
                     + str(int(t.median())) + " | " + str(int(np.percentile(t, 90))) + " | " + str(int(t.max())) + " |")
    lines.append("| **All** | **" + str(len(frame)) + "** | | | | |")
    return lines


def write_report(chunks: list[dict], model_inputs: dict, repro: dict, champions: dict) -> None:
    by_id = {c["id"]: c for c in chunks}
    w = model_inputs["weights"]
    lines = [
        "# Ask the Court corpus (F13 Session 1)",
        "",
        "Generated by `scripts/build_rag_corpus.py` for release `" + model_inputs["release"] + "`. "
        "The corpus is `data/rag/corpus.jsonl` and the model inputs are `data/rag/model_inputs.json`; both are "
        "committed and rebuilt byte-identically. Token counts are estimates (characters / "
        + str(rag.CHARS_PER_TOKEN) + "); Session 2 measures them with the embedding model's tokenizer.",
        "",
        "## Chunks",
        "",
    ] + token_table(chunks) + [
        "",
        "Champions are derived from the last playoff game of each season (" + str(len(champions))
        + " seasons), with the Daily Three rule (`derive_champions`).",
        "",
        "## The model inputs reproduce the site",
        "",
        "The classifier pipeline (median imputer, standard scaler, L1 logistic regression) folds into one "
        "linear formula over z-score differences, home minus away:",
        "",
        "| Term | Value |",
        "|---|---|",
        "| Intercept (home court, after folding the scaler) | " + format(model_inputs["intercept"], ".6f") + " |",
    ] + ["| Weight on `" + f + "` difference | " + format(w[f], ".6f") + " |" for f in sorted(w)] + [
        "",
        "Every other column has a weight of exactly 0, and no served profile is missing a non-zero feature, so "
        "the imputer never acts and the fold is exact.",
        "",
        "Applying the static export's rounding (each home order to 4 decimals, then the neutral average to 4) to "
        + str(repro["pairs"]) + " random ordered pairs (seed " + str(REPRO_SEED) + "):",
        "",
        "| Check | Result |",
        "|---|---|",
        "| Pairs that match the exported `p` exactly | " + str(repro["exact"]) + " of " + str(repro["pairs"]) + " |",
        "| Largest difference | " + format(repro["max_abs_diff"], ".4f") + " (tolerance " + str(REPRO_TOLERANCE) + ") |",
        "| Mean difference | " + format(repro["mean_abs_diff"], ".6f") + " |",
        "",
        "## Sample chunks",
        "",
        "Three of each type, exactly as they will be embedded.",
        "",
    ]
    for chunk_type, ids in SAMPLE_IDS.items():
        lines.append("### `" + chunk_type + "`")
        lines.append("")
        for chunk_id in ids:
            c = by_id[chunk_id]
            lines.append("**`" + chunk_id + "`**: " + c["title"] + " (about " + str(rag.estimated_tokens(c["text"]))
                         + " tokens; keys " + (", ".join("`" + k + "`" for k in c["keys"]) or "none") + ")")
            lines.append("")
            lines.append("```text")
            lines.append(c["text"])
            lines.append("```")
            lines.append("")
    REPORT_PATH.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8", newline="\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build(output_dir: Path = OUTPUT_DIR) -> tuple[list[dict], dict, dict, dict]:
    print("Loading release, profiles, index and champions...")
    release, profiles, index_keys, champions, manifest, notes = load_inputs()
    print("Release: " + release.version + "  Team-seasons: " + str(len(profiles)) + "  Champions: " + str(len(champions)))

    print("Folding the classifier into model inputs...")
    model_inputs = rag.build_model_inputs(release, profiles)
    repro = rag.reproduction_check(model_inputs, TEAMS_DIR, REPRO_SAMPLES, REPRO_SEED)
    print("Reproduction: " + str(repro["exact"]) + "/" + str(repro["pairs"]) + " exact, max diff "
          + format(repro["max_abs_diff"], ".4f"))
    if repro["max_abs_diff"] > REPRO_TOLERANCE:
        raise ValueError("model_inputs does not reproduce the exported p (max diff "
                         + str(repro["max_abs_diff"]) + "). Do not ship decomposed explanations.")

    print("Building chunks...")
    short = rag.short_season_lengths(profiles)
    chunks = (rag.build_team_cards(profiles, champions, model_inputs, short, release.version)
              + rag.build_season_cards(profiles, champions, short, release.version)
              + rag.build_leaderboards(profiles, release.version)
              + rag.build_method_chunks(notes, manifest, model_inputs, release.version))
    rag.check_corpus(chunks, index_keys)

    write_jsonl(chunks, output_dir / CORPUS_PATH.name)
    write_json(model_inputs, output_dir / MODEL_INPUTS_PATH.name)
    return chunks, model_inputs, repro, champions


def main():
    chunks, model_inputs, repro, champions = build()
    write_report(chunks, model_inputs, repro, champions)
    counts = pd.Series([c["type"] for c in chunks]).value_counts().sort_index()
    for chunk_type, n in counts.items():
        print("  " + chunk_type + ": " + str(n))
    print("Saved " + str(len(chunks)) + " chunks to " + str(CORPUS_PATH))
    print("Saved model inputs to " + str(MODEL_INPUTS_PATH))
    print("Saved report to " + str(REPORT_PATH))


if __name__ == "__main__":
    main()
