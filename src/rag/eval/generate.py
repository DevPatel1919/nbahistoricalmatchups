"""
generate.py

Builds the Ask the Court evaluation set (F13 Session 2):
tests/fixtures/rag/eval_questions.jsonl.

Templated questions are generated from the committed corpus, index.json and
the exported team files, so every expected number is exactly what a chunk
shows. Hand-written method, multi-hop and adversarial questions come from
src/rag/eval/handwritten.jsonl. The set is split dev/test, stratified by
category, with a fixed seed. Tune on dev only; score test once per reported
configuration (CONTRIBUTING.md, "Evaluating a change").

Each line:
    id                  <category>-<nnn>
    category            stat | comparison | ranking | matchup | season | method | multihop | adversarial
    split               dev | test
    question            what a visitor types
    context             null, or {"a": key, "b": key} for a question asked on a matchup page
    link                team-season keys the linker should find in the question text
    relevant_chunk_ids  chunks a good retriever returns (empty for out-of-scope questions)
    expected            answer checks for Session 4: keys, answer_key, numbers, answer,
                        must_refuse, must_not_contain, behaviour
"""

import json
import math
import re
from pathlib import Path

import numpy as np

from src.rag import textfmt as fmt

REPO_ROOT        = Path(__file__).resolve().parents[3]
CORPUS_PATH      = REPO_ROOT / "data" / "rag" / "corpus.jsonl"
INDEX_PATH       = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
TEAMS_DIR        = REPO_ROOT / "frontend" / "public" / "data" / "teams"
HANDWRITTEN_PATH = Path(__file__).resolve().parent / "handwritten.jsonl"
OUTPUT_PATH      = REPO_ROOT / "tests" / "fixtures" / "rag" / "eval_questions.jsonl"

SEED       = 20261026
DEV_SHARE  = 0.6
COUNTS     = {"stat": 55, "comparison": 35, "ranking": 30, "matchup": 35, "season": 20}
CONTEXT_MATCHUPS = 8            # matchup questions asked on a page, with no team named
NOTABLE_BY_WIN_PCT = 120        # plus every champion: the teams people ask about
MIN_SEASON_GAP = 8              # comparisons and matchups are cross-era

FIELDS = ["id", "category", "split", "question", "context", "link", "relevant_chunk_ids", "expected"]

# Card stat label -> (question phrases, comparison phrase, higher_is_better).
STATS = {
    "Net rating":         (["What was the net rating of the {T}?", "How dominant were the {T} by net rating?",
                            "Net rating for the {T}?"], "the better net rating", True),
    "Offensive rating":   (["How good was the {T} offence?", "What was the offensive rating of the {T}?",
                            "How many points per 100 possessions did the {T} score?"], "the better offence", True),
    "Defensive rating":   (["How good was the {T} defence?", "What was the defensive rating of the {T}?",
                            "How many points per 100 possessions did the {T} allow?"], "the better defence", False),
    "Pace":               (["How fast did the {T} play?", "What was the pace of the {T}?"], "played faster", True),
    "True shooting":      (["How efficiently did the {T} shoot?", "What was the true shooting of the {T}?"],
                           "the more efficient shooting", True),
    "Three-point %":      (["How well did the {T} shoot from three?", "Three-point percentage of the {T}?"],
                           "the better three-point shooting", True),
}

RANKING_PHRASES = {
    "net-rating":        "Which team had the best net rating {E}, relative to its league?",
    "offence":           "Who had the best offence {E}, adjusted for era?",
    "defence":           "Who had the best defence {E}?",
    "fastest":           "Which team played the fastest {E}?",
    "slowest":           "Which team played the slowest {E}?",
    "true-shooting":     "Which team shot the most efficiently {E}?",
    "three-point":       "Who was the best three-point shooting team {E}?",
    "opponent-shooting": "Which defence held opponents to the worst shooting {E}?",
    "forced-turnovers":  "Which team forced the most turnovers {E}?",
    "win-pct":           "Who had the best regular-season record {E}?",
    "worst-net-rating":  "Who was the worst team by net rating {E}?",
    "worst-win-pct":     "Which team had the worst record {E}?",
}
ERA_PHRASES = {
    "all-time": ["of all time", "ever", "since 1985-86"],
    "1980s":    ["in the late 80s", "of the 1980s"],
    "1990s":    ["in the 90s", "of the 1990s", "during the nineties"],
    "2000s":    ["in the 2000s", "of the 2000s"],
    "2010s":    ["in the 2010s", "of the 2010s"],
    "2020s":    ["in the 2020s", "of the 2020s"],
}

MATCHUP_PHRASES = [
    ("Why does the model favour the {F} over the {U}?", True),
    ("Who wins, the {A} or the {B}?", False),
    ("How likely are the {A} to beat the {B}?", False),
    ("What chance does the model give the {U} against the {F}?", False),
    ("Why are the {F} favoured against the {U}?", True),
]
CONTEXT_PHRASES = [
    ("Why does the model favour this team?", True),
    ("How sure is the model about this matchup?", False),
    ("What decides this one?", True),
    ("Why is this so close?", True),
]


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

def load_inputs():
    with open(CORPUS_PATH, encoding="utf-8") as f:
        chunks = {c["id"]: c for c in map(json.loads, f)}
    with open(INDEX_PATH, encoding="utf-8") as f:
        teams = {t["key"]: t for t in json.load(f)["teams"]}
    with open(HANDWRITTEN_PATH, encoding="utf-8") as f:
        handwritten = [json.loads(line) for line in f if line.strip()]
    return chunks, teams, handwritten


def card_stats(card_text: str) -> dict:
    """{label: (shown value, z)} parsed from a team card's stat lines."""
    stats = {}
    for m in re.finditer(r"(?m)^- ([^:]+): (\S+?)(?:,| ).*?\(z ([+-]\d+\.\d)", card_text):
        stats[m.group(1)] = (m.group(2), float(m.group(3)))
    return stats


def champions(chunks: dict) -> dict:
    out = {}
    for cid, c in chunks.items():
        if c["type"] == "season_card":
            m = re.search(r"Champion: .*\((\S+)\)\.", c["text"])
            if m:
                out[c["seasons"][0]] = m.group(1)
    return out


def team_phrase(rng, team: dict) -> str:
    """One of the ways a person names a team-season."""
    season, city, name = int(team["season"]), team["city"], team["name"]
    yy = str(season % 100).zfill(2)
    styles = [
        "'" + yy + " " + name,
        str(season) + " " + name,
        str(season - 1) + "-" + yy + " " + name,
        fmt.season_label(season) + " " + city + " " + name,
        name + " " + str(season),
        str(season) + " " + city + " " + name,
    ]
    return styles[rng.integers(len(styles))]


def notable_keys(teams: dict, champs: dict) -> list:
    by_pct = sorted(teams.values(), key=lambda t: (-t["wins"] / (t["wins"] + t["losses"]), t["key"]))
    keys = {t["key"] for t in by_pct[:NOTABLE_BY_WIN_PCT]} | set(champs.values())
    return sorted(keys)


def question(category, text, relevant, link=(), context=None, **expected) -> dict:
    return {"category": category, "question": text, "context": context, "link": list(link),
            "relevant_chunk_ids": list(relevant), "expected": expected}


# ---------------------------------------------------------------------------
# Templated categories
# ---------------------------------------------------------------------------

def stat_questions(rng, chunks, teams, notable) -> list:
    keys = sorted(teams)
    out = []
    while len(out) < COUNTS["stat"]:
        pool = notable if rng.random() < 0.6 else keys
        key = pool[rng.integers(len(pool))]
        team = teams[key]
        T = team_phrase(rng, team)
        if rng.random() < 0.15:
            text = "What record did the " + T + " finish with?"
            if any(q["question"] == text for q in out):
                continue
            out.append(question("stat", text, ["team:" + key], [key], keys=[key],
                                numbers=[fmt.record(team["wins"], team["losses"])]))
            continue
        label = list(STATS)[rng.integers(len(STATS))]
        phrases = STATS[label][0]
        value, _ = card_stats(chunks["team:" + key]["text"])[label]
        text = phrases[rng.integers(len(phrases))].replace("{T}", T)
        if any(q["question"] == text for q in out):
            continue
        out.append(question("stat", text, ["team:" + key], [key], keys=[key], numbers=[value]))
    return out


def cross_era_pair(rng, pool, teams):
    while True:
        a, b = pool[rng.integers(len(pool))], pool[rng.integers(len(pool))]
        if abs(teams[a]["season"] - teams[b]["season"]) >= MIN_SEASON_GAP:
            return a, b


def comparison_questions(rng, chunks, teams, notable) -> list:
    out = []
    while len(out) < COUNTS["comparison"]:
        a, b = cross_era_pair(rng, notable, teams)
        label = list(STATS)[rng.integers(len(STATS))]
        _, phrase, higher_is_better = STATS[label]
        va, za = card_stats(chunks["team:" + a]["text"])[label]
        vb, zb = card_stats(chunks["team:" + b]["text"])[label]
        if za == zb:
            continue
        winner = a if (za > zb) == higher_is_better else b
        A, B = team_phrase(rng, teams[a]), team_phrase(rng, teams[b])
        if label == "Pace":
            text = "Relative to their leagues, who played faster: the " + A + " or the " + B + "?"
        else:
            text = "Who had " + phrase + " relative to their league, the " + A + " or the " + B + "?"
        if any(q["question"] == text for q in out):
            continue
        out.append(question("comparison", text, ["team:" + a, "team:" + b], [a, b],
                            keys=[a, b], answer_key=winner, numbers=[va, vb]))
    return out


def ranking_questions(rng, chunks) -> list:
    boards = sorted(c for c in chunks if c.startswith("leaders:"))
    picks = [boards[i] for i in sorted(rng.choice(len(boards), size=COUNTS["ranking"], replace=False))]
    out = []
    for cid in picks:
        _, slug, era = cid.split(":")
        phrases = ERA_PHRASES[era]
        text = RANKING_PHRASES[slug].replace("{E}", phrases[rng.integers(len(phrases))])
        first = chunks[cid]["text"].split("\n")[1]
        m = re.match(r"1\. .*?\((\S+)\): (\S+?)[,;]", first)
        out.append(question("ranking", text, [cid], answer_key=m.group(1), numbers=[m.group(2)]))
    return out


def matchup_questions(rng, teams, notable) -> list:
    out = []
    files = {}
    while len(out) < COUNTS["matchup"]:
        a, b = cross_era_pair(rng, notable, teams)
        if a not in files:
            with open(TEAMS_DIR / (a + ".json"), encoding="utf-8") as f:
                files[a] = json.load(f)["opponents"]
        p = files[a][b]["p"]
        if p == 0.5:
            continue
        fav, dog = (a, b) if p > 0.5 else (b, a)
        p_fav = max(p, 1 - p)
        with_context = len(out) < CONTEXT_MATCHUPS
        if with_context:
            text, why = CONTEXT_PHRASES[rng.integers(len(CONTEXT_PHRASES))]
            link, context = [], {"a": a, "b": b}
        else:
            template, why = MATCHUP_PHRASES[rng.integers(len(MATCHUP_PHRASES))]
            names = {"F": fav, "U": dog, "A": a, "B": b}
            order = [k for k in re.findall(r"\{([FUAB])\}", template)]
            text = template
            for slot in order:
                text = text.replace("{" + slot + "}", team_phrase(rng, teams[names[slot]]), 1)
            link, context = [names[s] for s in order], None
        if any(q["question"] == text and q["context"] == context for q in out):
            continue
        relevant = ["team:" + a, "team:" + b] + (["method:model-weights"] if why else [])
        out.append(question("matchup", text, relevant, link, context, keys=[a, b], answer_key=fav,
                            numbers=[fmt.pct1(p_fav)]))
    return out


def season_questions(rng, chunks, champs) -> list:
    seasons = sorted(champs)
    picks = [seasons[i] for i in sorted(rng.choice(len(seasons), size=COUNTS["season"], replace=False))]
    out = []
    for season in picks:
        text = chunks["season:" + str(season)]["text"]
        forms = [fmt.season_label(season), str(season - 1) + "-" + str(season % 100).zfill(2), "the " + str(season) + " season"]
        S = forms[rng.integers(len(forms))]
        kind = rng.integers(4)
        if kind == 0:
            out.append(question("season", "Who won the " + S + " championship?", ["season:" + str(season)],
                                answer_key=champs[season]))
        elif kind == 1:
            key = re.search(r"Best record: .*?, (\d+–\d+)\.", text)
            out.append(question("season", "Which team had the best record in " + S + "?", ["season:" + str(season)],
                                numbers=[key.group(1)]))
        elif kind == 2:
            pace = re.search(r"pace (\d+\.\d)", text).group(1)
            out.append(question("season", "What was the league's average pace in " + S + "?", ["season:" + str(season)],
                                numbers=[pace]))
        else:
            worst = re.search(r"Worst net rating: .*?, ([+-]\d+\.\d)\.", text).group(1)
            out.append(question("season", "Who was the worst team by net rating in " + S + "?", ["season:" + str(season)],
                                numbers=[worst]))
    return out


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def assign_ids_and_split(rows: list, seed: int = SEED) -> list:
    rng = np.random.default_rng(seed)
    counters, by_category = {}, {}
    for row in rows:
        n = counters.get(row["category"], 0) + 1
        counters[row["category"]] = n
        row["id"] = row["category"] + "-" + str(n).zfill(3)
        by_category.setdefault(row["category"], []).append(row)
    for category, group in by_category.items():
        order = rng.permutation(len(group))
        n_dev = math.ceil(DEV_SHARE * len(group))
        for rank, i in enumerate(order):
            group[i]["split"] = "dev" if rank < n_dev else "test"
    return [{f: row[f] for f in FIELDS} for row in rows]


def build(seed: int = SEED) -> list:
    chunks, teams, handwritten = load_inputs()
    rng = np.random.default_rng(seed)
    champs = champions(chunks)
    notable = notable_keys(teams, champs)
    rows = (stat_questions(rng, chunks, teams, notable)
            + comparison_questions(rng, chunks, teams, notable)
            + ranking_questions(rng, chunks)
            + matchup_questions(rng, teams, notable)
            + season_questions(rng, chunks, champs)
            + handwritten)

    seen = set()
    for row in rows:
        ident = (row["question"], json.dumps(row["context"]))
        if ident in seen:
            raise ValueError("Duplicate question: " + row["question"])
        seen.add(ident)
        missing = [c for c in row["relevant_chunk_ids"] if c not in chunks]
        if missing:
            raise ValueError("Unknown chunk ids " + str(missing) + " for: " + row["question"])
        unknown = [k for k in row["link"] if k not in teams]
        if unknown:
            raise ValueError("Unknown keys " + str(unknown) + " for: " + row["question"])
    return assign_ids_and_split(rows, seed)


def write(rows: list, path: Path = OUTPUT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
