"""
build_rag_eval_set.py

Writes the Ask the Court evaluation set (F13 Session 2),
tests/fixtures/rag/eval_questions.jsonl, from the committed corpus
(data/rag/corpus.jsonl), index.json, the exported team files and the
hand-written questions in src/rag/eval/handwritten.jsonl. Deterministic for
a given seed; src/rag/eval/generate.py documents every field.

Run from repo root:
    python scripts/build_rag_eval_set.py
"""

import sys
from collections import Counter
from pathlib import Path

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.rag.eval import generate


def main():
    rows = generate.build()
    generate.write(rows)
    counts = Counter((r["category"], r["split"]) for r in rows)
    for category in sorted({r["category"] for r in rows}):
        print("  " + category + ": " + str(counts[(category, "dev")]) + " dev, " + str(counts[(category, "test")]) + " test")
    print("Saved " + str(len(rows)) + " questions to " + str(generate.OUTPUT_PATH))


if __name__ == "__main__":
    main()
