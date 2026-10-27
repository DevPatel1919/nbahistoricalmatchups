"""
eval_rag.py

Scores one Ask the Court pipeline configuration on the evaluation set (F13).
Session 2 covers linking and retrieval; Session 4 adds answer metrics.

    linking     exact-match accuracy of the linker's keys, on questions that
                name their teams in the text (no page context)
    retrieval   recall@5, recall@20, hit@5 and MRR against relevant_chunk_ids,
                on questions that have relevant chunks
    answers     (configs named answer-*) numeric accuracy, answer_key
                accuracy, grounding first-pass rate, refusal accuracy and
                false refusals, must_not_contain and precise-margin
                violations, words, neurons and latency per answer; with
                --judge, the judge's faithfulness, citation support and
                refusal correctness on the judge set (src/rag/eval/judge.py)

Configurations are named in CONFIGS and ANSWER_CONFIGS below;
src/rag/retrieve.py documents each retrieval stage and the split-card corpus
that names ending in "-split" use, src/rag/generate.py the answer pipeline.

Tune on dev. The test split is scored once per reported configuration, so
--split test also needs --score-test.

Model calls are cached and capped per UTC day (src/rag/workers_ai.py). A run
that reaches the cap saves what it has, marked partial; rerun it the next UTC
day and the cached answers cost nothing.

Writes reports/rag_runs/<config>-<split>.json: the summary, a per-category
breakdown, and every question's top 20 (and answer).

Run from repo root:
    python scripts/eval_rag.py --config bm25 --split dev
    python scripts/eval_rag.py --config answer-llama8b --split dev --judge
    python scripts/eval_rag.py --write-labels answer-llama8b      # the owner's 50 answers to label (Q5)
    python scripts/eval_rag.py --agreement                        # judge vs owner: agreement and kappa
"""

import argparse
import json
import sys
from dataclasses import asdict, replace
from datetime import date
from pathlib import Path

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.rag import workers_ai
from src.rag.config import RETRIEVAL
from src.rag.eval import judge as rag_judge
from src.rag.eval import metrics
from src.rag.generate import AnswerConfig, AskPipeline, sources_of
from src.rag.index_local import load_corpus
from src.rag.linker import Linker
from src.rag.retrieve import BGE_QUERY_PREFIX, RetrievalConfig, Retriever, split_team_cards

REPO_ROOT      = Path(__file__).resolve().parent.parent
QUESTIONS_PATH = REPO_ROOT / "tests" / "fixtures" / "rag" / "eval_questions.jsonl"
RUNS_DIR       = REPO_ROOT / "reports" / "rag_runs"

TOP_K = 20
LONG_ANSWER_WORDS = 140   # the prompt asks for at most 120

SMALL, BASE = workers_ai.EMBED_SMALL, workers_ai.EMBED_BASE
P = BGE_QUERY_PREFIX

CONFIGS = {
    # Session 2 baselines
    "bm25":                     RetrievalConfig(keyword=True, dense_model=None),
    "dense-small":              RetrievalConfig(keyword=False, dense_model=SMALL),
    "dense-base":               RetrievalConfig(keyword=False, dense_model=BASE),
    # Session 3: the BGE query instruction
    "dense-small-prefix":       RetrievalConfig(keyword=False, dense_model=SMALL, query_prefix=P),
    "dense-base-prefix":        RetrievalConfig(keyword=False, dense_model=BASE, query_prefix=P),
    # Session 3: hybrid and the linked stages, added one at a time
    "hybrid":                   RetrievalConfig(dense_model=SMALL),
    "hybrid-context":           RetrievalConfig(dense_model=SMALL, use_context=True),
    "hybrid-filter":            RetrievalConfig(dense_model=SMALL, use_context=True, filters=True),
    "hybrid-filter-pin":        RetrievalConfig(dense_model=SMALL, use_context=True, filters=True, pin=True),
    "hybrid-filter-pin-rerank": RetrievalConfig(dense_model=SMALL, use_context=True, filters=True, pin=True, rerank=True),
    "hybrid-filter-pin-rerank-fuse": RetrievalConfig(dense_model=SMALL, use_context=True, filters=True, pin=True,
                                                     rerank=True, rerank_mode="fuse"),
    "hybrid-filter-rerank":     RetrievalConfig(dense_model=SMALL, use_context=True, filters=True, rerank=True),
    "dense-filter-pin-rerank":  RetrievalConfig(keyword=False, dense_model=SMALL, use_context=True, filters=True,
                                                pin=True, rerank=True),
    # Session 3: chunking (team cards split into summary and stats)
    "hybrid-filter-pin-rerank-fuse-split": RetrievalConfig(dense_model=SMALL, use_context=True, filters=True, pin=True,
                                                           rerank=True, rerank_mode="fuse"),
}

# Session 4: answers. The base is the shipped retrieval (src/rag/config.py) with
# tool facts, 5 chunks and Llama 3.1 8B; each ablation changes one thing.
NO_RERANK = replace(RETRIEVAL, rerank=False)
ANSWER_CONFIGS = {
    "answer-llama8b":          AnswerConfig(RETRIEVAL, workers_ai.LLAMA_8B),
    "answer-llama8b-nofacts":  AnswerConfig(RETRIEVAL, workers_ai.LLAMA_8B, facts=False),
    "answer-llama8b-norerank": AnswerConfig(NO_RERANK, workers_ai.LLAMA_8B),
    "answer-llama8b-3chunks":  AnswerConfig(RETRIEVAL, workers_ai.LLAMA_8B, chunks=3),
    "answer-llama8b-method":   AnswerConfig(RETRIEVAL, workers_ai.LLAMA_8B, reserve_method=True),
    "answer-llama3b":          AnswerConfig(RETRIEVAL, workers_ai.LLAMA_3B),
    "answer-qwen3":            AnswerConfig(RETRIEVAL, workers_ai.QWEN3_30B),
    "answer-gemma4":           AnswerConfig(RETRIEVAL, workers_ai.GEMMA4_26B),
}


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def load_questions(split: str) -> list[dict]:
    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f]
    return [r for r in rows if r["split"] == split]


def make_retriever(name: str, chunks: list[dict], client):
    if name.endswith("-split"):
        chunks = split_team_cards(chunks)
    return Retriever(chunks, CONFIGS[name], client)


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
    client = workers_ai.WorkersAI()
    retriever = make_retriever(config, chunks, client)

    rows = []
    for q in questions:
        retrieved = retriever.search(q["question"], q["context"], TOP_K)
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
    latency = {}
    for model in sorted({m for m, _ in client.latencies}):
        times = sorted(t for m, t in client.latencies if m == model)
        latency[model] = {"requests": len(times), "median_ms": round(1000 * times[len(times) // 2])}
    return {"config": config, "settings": vars(CONFIGS[config]), "split": split, "date": date.today().isoformat(),
            "summary": summarize(rows), "by_category": by_category, "uncached_latency": latency,
            "questions": rows}


# ---------------------------------------------------------------------------
# Answers (Session 4)
# ---------------------------------------------------------------------------

def context_recall(relevant: list, chunk_ids: list, covered: list) -> float:
    """Share of the relevant chunks the generator saw: in its context, or as a team fact."""
    seen = set(chunk_ids) | {"team:" + k for k in covered}
    return len(set(relevant) & seen) / len(set(relevant))


def answer_row(q: dict, a, linker) -> dict:
    expected = q["expected"]
    row = {
        "id":           q["id"],
        "category":     q["category"],
        "question":     q["question"],
        "context":      q["context"],
        "answer":       a.text,
        "first_answer": a.first_text,
        "first_pass":   a.first_pass,
        "grounded":     a.grounded,
        "regenerated":  a.regenerated,
        "removed":      a.removed,
        "problems":     a.problems,
        "facts":        a.facts,
        "covered":      a.covered,
        "chunk_ids":    a.chunk_ids,
        "retrieved":    a.retrieved,
        "relevant":     q["relevant_chunk_ids"],
        "refused":      metrics.refused(a.text),
        "must_refuse":  bool(expected.get("must_refuse")),
        "words":        len(a.text.split()),
        "neurons":      round(a.neurons, 3),
        "latency_ms":   a.latency_ms,
        "calls":        [{k: c[k] for k in ("input_tokens", "output_tokens", "neurons", "latency_ms")} for c in a.calls],
    }
    if q["relevant_chunk_ids"]:
        row["recall@5"] = metrics.recall_at(q["relevant_chunk_ids"], a.retrieved, 5)
        row["context_recall"] = context_recall(q["relevant_chunk_ids"], a.chunk_ids, a.covered)
    if expected.get("numbers"):
        row["numbers_correct"] = metrics.numbers_correct(expected["numbers"], a.text, complement=q["category"] == "matchup")
    if expected.get("answer_key"):
        row["answer_key_correct"] = metrics.answer_key_correct(expected["answer_key"], a.text, linker)
    if expected.get("must_not_contain"):
        row["must_not_contain_hits"] = metrics.must_not_contain_hits(expected["must_not_contain"], a.text)
    row["precise_margin"] = metrics.precise_margin(a.text)
    return row


def summarize_answers(rows: list[dict]) -> dict:
    def mean_of(key, subset=None):
        vals = [r[key] for r in (subset if subset is not None else rows) if r.get(key) is not None]
        return metrics.mean(vals), len(vals)

    in_scope = [r for r in rows if r["category"] != "adversarial"]
    refuse = [r for r in rows if r["must_refuse"]]
    judged = [r["judge"] for r in rows if r.get("judge") and "error" not in r["judge"]]
    lat = [r["latency_ms"] for r in rows if r["latency_ms"]]
    out = {
        "questions":           len(rows),
        "recall@5":            mean_of("recall@5")[0],
        "context_recall":      mean_of("context_recall")[0],
        "numeric_acc":         mean_of("numbers_correct")[0],
        "numeric_n":           mean_of("numbers_correct")[1],
        "answer_key_acc":      mean_of("answer_key_correct")[0],
        "answer_key_n":        mean_of("answer_key_correct")[1],
        "first_pass":          metrics.mean([1.0 if r["first_pass"] else 0.0 for r in rows]),
        "grounded":            metrics.mean([1.0 if r["grounded"] else 0.0 for r in rows]),
        "regenerated":         metrics.mean([1.0 if r["regenerated"] else 0.0 for r in rows]),
        "sentences_removed":   sum(r["removed"] for r in rows),
        "refusal_acc":         metrics.mean([1.0 if r["refused"] else 0.0 for r in refuse]),
        "refusal_n":           len(refuse),
        "false_refusals":      metrics.mean([1.0 if r["refused"] else 0.0 for r in in_scope]),
        "false_refusal_n":     len(in_scope),
        "must_not_contain":    sum(len(r.get("must_not_contain_hits", [])) for r in rows),
        "precise_margins":     sum(1 for r in rows if r["precise_margin"]),
        "words_mean":          metrics.mean([r["words"] for r in rows]),
        "long_answers":        metrics.mean([1.0 if r["words"] > LONG_ANSWER_WORDS else 0.0 for r in rows]),
        "neurons_per_answer":  metrics.mean([r["neurons"] for r in rows]),
        "latency_p50_ms":      metrics.percentile(lat, 0.5),
        "latency_p95_ms":      metrics.percentile(lat, 0.95),
        "judge_n":             len(judged),
        "faithfulness":        metrics.mean([j["faithfulness"] for j in judged if j["faithfulness"] is not None]),
        "citation_support":    metrics.mean([j["citation_support"] for j in judged if j["citation_support"] is not None]),
        "faithful_answers":    metrics.mean([j["faithful"] for j in judged if j["claims"]]),
        "judge_refusal_correct": metrics.mean([j["refusal_correct"] for j in judged if j["refusal_correct"] is not None]),
        "judge_errors":        sum(1 for r in rows if r.get("judge") and "error" in r["judge"]),
        "judge_neurons":       sum(r["judge"]["neurons"] for r in rows if r.get("judge")),
    }
    return out


def run_answers(config: str, split: str, judge: bool, judge_all: bool) -> dict:
    chunks = load_corpus()
    questions = load_questions(split)
    linker = Linker.from_index()
    client = workers_ai.WorkersAI()
    pipeline = AskPipeline(chunks, ANSWER_CONFIGS[config], client, linker=linker)
    judge_ids = {q["id"] for q in questions} if judge_all else set(rag_judge.judge_set(questions))

    rows, partial = [], None
    for q in questions:
        try:
            a = pipeline.answer(q["question"], q["context"])
            row = answer_row(q, a, linker)
            if judge and q["id"] in judge_ids:
                row["judge"] = rag_judge.judge_answer(client, q["question"], a.text, a.sources,
                                                      row["must_refuse"])
        except workers_ai.BudgetExceeded as e:
            partial = str(e)
            break
        rows.append(row)

    by_category = {}
    for category in sorted({r["category"] for r in rows}):
        by_category[category] = summarize_answers([r for r in rows if r["category"] == category])
    settings = asdict(ANSWER_CONFIGS[config])
    return {"config": config, "settings": settings, "split": split, "date": date.today().isoformat(),
            "partial": partial, "judged": sorted(judge_ids) if judge else [],
            "summary": summarize_answers(rows), "by_category": by_category, "questions": rows}


def write_labels(config: str) -> None:
    """The owner's label sheet (Q5): the judge set's answers from a dev run, without the judge's verdicts."""
    path = RUNS_DIR / (config + "-dev.json")
    with open(path, encoding="utf-8") as f:
        run_data = json.load(f)
    if rag_judge.LABELS_CSV.exists() and rag_judge.read_labels():
        raise SystemExit(str(rag_judge.LABELS_CSV) + " already has labels; not overwriting them.")
    chunks = {c["id"]: c for c in load_corpus()}
    by_id = {r["id"]: r for r in run_data["questions"]}
    ids = rag_judge.judge_set(load_questions("dev"))
    missing = [i for i in ids if i not in by_id]
    if missing:
        raise SystemExit("The run has no answer for " + ", ".join(missing[:5]) + "; finish the dev run first.")
    rows = [{"id": i, "category": by_id[i]["category"], "question": by_id[i]["question"], "answer": by_id[i]["answer"],
             "sources": sources_of(by_id[i]["facts"], by_id[i]["chunk_ids"], chunks),
             "must_refuse": by_id[i]["must_refuse"]} for i in ids]
    rag_judge.write_label_sheet(rows)
    print("Saved " + str(len(rows)) + " answers to label to " + str(rag_judge.LABELS_CSV))
    print("Read them with their sources in " + str(rag_judge.LABELS_MD))


def agreement() -> dict:
    """
    The judge against the owner's labels (Q5): the judge grades exactly the
    labelled texts (reports/rag_judge_labels.json; cached when a run already
    judged the same answer), then agreement and Cohen's kappa per label.
    """
    labels = rag_judge.read_labels()
    with open(rag_judge.LABELS_JSON, encoding="utf-8") as f:
        rows = {r["id"]: r for r in json.load(f)}
    client = workers_ai.WorkersAI()
    judged = {}
    for i in labels:
        r = rows[i]
        j = rag_judge.judge_answer(client, r["question"], r["answer"], r["sources"], r["must_refuse"])
        if "error" not in j:
            judged[i] = j
    out = {"labelled": len(labels), "judged": len(judged),
           "disagreements": [{"id": i, "owner": labels[i], "judge": {k: judged[i][k] for k in
                                                                    ("faithful", "citations_ok", "refusal_correct")}}
                             for i in labels if i in judged and (labels[i]["faithful"] != judged[i]["faithful"])]}
    for field, judge_field in (("faithful", "faithful"), ("citations_ok", "citations_ok"), ("refusal_ok", "refusal_correct")):
        pairs = [(labels[i][field], judged[i][judge_field]) for i in labels
                 if i in judged and labels[i][field] is not None and judged[i].get(judge_field) is not None]
        if not pairs:
            continue
        owner, model = [p[0] for p in pairs], [p[1] for p in pairs]
        out[field] = {"n": len(pairs), "agreement": metrics.mean([1.0 if a == b else 0.0 for a, b in pairs]),
                      "kappa": metrics.cohen_kappa(owner, model) if len(set(owner) | set(model)) > 1 else None,
                      "owner_yes": sum(owner), "judge_yes": sum(model)}
    return out


def print_answers(result: dict) -> None:
    s = result["summary"]
    print("Config " + result["config"] + " on " + result["split"] + ": " + str(s["questions"]) + " answers"
          + (" (PARTIAL: " + result["partial"] + ")" if result["partial"] else ""))
    for key in ("recall@5", "context_recall", "numeric_acc", "answer_key_acc", "first_pass", "grounded", "refusal_acc",
                "false_refusals", "faithfulness", "citation_support", "faithful_answers", "judge_refusal_correct",
                "words_mean", "long_answers", "neurons_per_answer", "latency_p50_ms", "latency_p95_ms"):
        print("  " + key + ": " + fmt(s[key]))
    for key in ("numeric_n", "answer_key_n", "refusal_n", "sentences_removed", "must_not_contain", "precise_margins",
                "judge_n", "judge_errors"):
        print("  " + key + ": " + str(s[key]))
    print("  judge_neurons: " + format(s["judge_neurons"], ".1f"))
    print("By category (numeric acc / first pass / faithfulness):")
    for category, c in result["by_category"].items():
        print("  " + category + ": " + fmt(c["numeric_acc"]) + " / " + fmt(c["first_pass"]) + " / " + fmt(c["faithfulness"]))


def fmt(x: float) -> str:
    return "n/a" if x != x else format(x, ".3f")


def save(result: dict, name: str) -> Path:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out = RUNS_DIR / (name + ".json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return out


def main():
    parser = argparse.ArgumentParser(description="Score an Ask the Court configuration.")
    parser.add_argument("--config", choices=sorted(CONFIGS) + sorted(ANSWER_CONFIGS))
    parser.add_argument("--split", default="dev", choices=["dev", "test"])
    parser.add_argument("--score-test", action="store_true",
                        help="confirm a deliberate, once-per-configuration test run")
    parser.add_argument("--judge", action="store_true", help="answer configs: judge the judge set (50 questions)")
    parser.add_argument("--judge-all", action="store_true", help="answer configs: judge every question")
    parser.add_argument("--write-labels", metavar="CONFIG", help="write the owner's label sheet from a dev answer run")
    parser.add_argument("--agreement", action="store_true", help="the judge against the owner's labels (Q5)")
    args = parser.parse_args()

    if args.write_labels:
        write_labels(args.write_labels)
        return
    if args.agreement:
        result = agreement()
        print(json.dumps(result, indent=1))
        print("Saved agreement to " + str(save(result, "judge-agreement")))
        return
    if not args.config:
        parser.error("--config is required")
    if args.split == "test" and not args.score_test:
        parser.error("the test split is scored once per reported configuration; add --score-test to confirm")

    if args.config in ANSWER_CONFIGS:
        result = run_answers(args.config, args.split, args.judge or args.judge_all, args.judge_all)
        out = save(result, args.config + "-" + args.split)
        print_answers(result)
        print("Saved run to " + str(out))
        return

    result = run(args.config, args.split)
    out = save(result, args.config + "-" + args.split)

    s = result["summary"]
    print("Config " + args.config + " on " + args.split + ": " + str(s["questions"]) + " questions")
    print("| Config | Recall@5 | Recall@20 | Hit@5 | MRR | Linking |")
    print("| " + args.config + " | " + fmt(s["recall@5"]) + " | " + fmt(s["recall@20"]) + " | " + fmt(s["hit@5"])
          + " | " + fmt(s["mrr"]) + " | " + fmt(s["linking_acc"]) + " |")
    print("By category (recall@5):")
    for category, c in result["by_category"].items():
        print("  " + category + ": " + fmt(c["recall@5"]) + "  (n=" + str(c["retrieval_n"]) + ")")
    for model, lat in result["uncached_latency"].items():
        print("  " + model + ": " + str(lat["requests"]) + " uncached requests, median " + str(lat["median_ms"]) + " ms")
    print("Saved run to " + str(out))


if __name__ == "__main__":
    main()
