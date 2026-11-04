"""
eval_rag.py

Scores one Ask the Court pipeline configuration on the evaluation set (F13).
Session 2 covers linking and retrieval; Session 4 adds answer metrics.

    linking     exact-match accuracy of the linker's keys, on questions that
                name their teams in the text (no page context)
    retrieval   recall@5, recall@20, hit@5 and MRR against relevant_chunk_ids,
                on questions that have relevant chunks

Configurations (CONFIGS below):
    bm25         SQLite FTS5 keyword search only
    dense-small  exact cosine search over bge-small-en-v1.5 embeddings (Workers AI)
    dense-base   exact cosine search over bge-base-en-v1.5 embeddings (Workers AI)

Tune on dev. The test split is scored once per reported configuration, so
--split test also needs --score-test.

Writes reports/rag_runs/<config>-<split>.json: the summary, a per-category
breakdown, and every question's top 20.

Run from repo root:
    python scripts/eval_rag.py --config bm25 --split dev
    python scripts/eval_rag.py --config dense-base --split dev
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.rag import workers_ai
from src.rag.eval import metrics
from src.rag.index_local import DenseIndex, KeywordIndex, load_corpus
from src.rag.linker import Linker

REPO_ROOT      = Path(__file__).resolve().parent.parent
QUESTIONS_PATH = REPO_ROOT / "tests" / "fixtures" / "rag" / "eval_questions.jsonl"
RUNS_DIR       = REPO_ROOT / "reports" / "rag_runs"

TOP_K = 20

CONFIGS = {
    "bm25":        {"retriever": "keyword"},
    "dense-small": {"retriever": "dense", "model": workers_ai.EMBED_SMALL},
    "dense-base":  {"retriever": "dense", "model": workers_ai.EMBED_BASE},
}


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def load_questions(split: str) -> list[dict]:
    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f]
    return [r for r in rows if r["split"] == split]


def make_retriever(name: str, chunks: list[dict]):
    config = CONFIGS[name]
    if config["retriever"] == "keyword":
        return KeywordIndex(chunks)
    return DenseIndex(chunks, workers_ai.WorkersAI(), model=config["model"])


def summarize(rows: list[dict]) -> dict:
    scored = [r for r in rows if r["relevant"]]
    linked = [r for r in rows if r["link_correct"] is not None]
    return {
        "questions":       len(rows),
        "retrieval_n":     len(scored),
        "recall@5":        metrics.mean([r["recall@5"] for r in scored]),
        "recall@20":       metrics.mean([r["recall@20"] for r in scored]),
        "hit@5":           metrics.mean([r["hit@5"] for r in scored]),
        "mrr":             metrics.mean([r["mrr"] for r in scored]),
        "linking_n":       len(linked),
        "linking_acc":     metrics.mean([r["link_correct"] for r in linked]),
    }


def run(config: str, split: str) -> dict:
    chunks = load_corpus()
    questions = load_questions(split)
    linker = Linker.from_index()
    retriever = make_retriever(config, chunks)

    rows = []
    for q in questions:
        retrieved = [cid for cid, _ in retriever.search(q["question"], TOP_K)]
        relevant = q["relevant_chunk_ids"]
        linked = linker.link(q["question"]).keys
        row = {
            "id":           q["id"],
            "category":     q["category"],
            "relevant":     relevant,
            "retrieved":    retrieved,
            "linked":       linked,
            "link_correct": metrics.link_correct(q["link"], linked) if q["context"] is None else None,
        }
        if relevant:
            row.update({
                "recall@5":  metrics.recall_at(relevant, retrieved, 5),
                "recall@20": metrics.recall_at(relevant, retrieved, 20),
                "hit@5":     metrics.hit_at(relevant, retrieved, 5),
                "mrr":       metrics.reciprocal_rank(relevant, retrieved),
            })
        rows.append(row)

    by_category = {}
    for category in sorted({r["category"] for r in rows}):
        by_category[category] = summarize([r for r in rows if r["category"] == category])
    return {"config": config, "split": split, "date": date.today().isoformat(),
            "summary": summarize(rows), "by_category": by_category, "questions": rows}


def fmt(x: float) -> str:
    return "n/a" if x != x else format(x, ".3f")


def main():
    parser = argparse.ArgumentParser(description="Score an Ask the Court configuration.")
    parser.add_argument("--config", required=True, choices=sorted(CONFIGS))
    parser.add_argument("--split", default="dev", choices=["dev", "test"])
    parser.add_argument("--score-test", action="store_true",
                        help="confirm a deliberate, once-per-configuration test run")
    args = parser.parse_args()
    if args.split == "test" and not args.score_test:
        parser.error("the test split is scored once per reported configuration; add --score-test to confirm")

    result = run(args.config, args.split)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out = RUNS_DIR / (args.config + "-" + args.split + ".json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")

    s = result["summary"]
    print("Config " + args.config + " on " + args.split + ": " + str(s["questions"]) + " questions")
    print("| Config | Recall@5 | Recall@20 | Hit@5 | MRR | Linking |")
    print("| " + args.config + " | " + fmt(s["recall@5"]) + " | " + fmt(s["recall@20"]) + " | " + fmt(s["hit@5"])
          + " | " + fmt(s["mrr"]) + " | " + fmt(s["linking_acc"]) + " |")
    print("By category (recall@5):")
    for category, c in result["by_category"].items():
        print("  " + category + ": " + fmt(c["recall@5"]) + "  (n=" + str(c["retrieval_n"]) + ")")
    print("Saved run to " + str(out))


if __name__ == "__main__":
    main()
