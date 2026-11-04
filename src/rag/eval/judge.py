"""
judge.py

The LLM judge for Ask the Court answers (F13 Session 4). The judge is
gpt-oss-120b on Workers AI: larger than every generator candidate (117B
parameters against at most 30B) and from a different maker (OpenAI, where
the candidates are Meta, Qwen and Google), so it isn't grading its own family.

It reads the question, the answer, the tool facts and the chunks the answer
cites, and returns JSON:
    claims   each factual claim, whether the facts and cited sources support
             it (faithfulness), and whether its own citation supports it
             (citation support)
    refused  whether the answer declines to answer

Scores per answer:
    faithfulness      supported claims / claims (answers with no claims are skipped)
    citation_support  claims whose citation supports them / claims
    faithful          1 if every claim is supported (compared with the owner's labels)
    refusal_correct   on questions that must be refused: 1 if the answer refused

The judge is checked against the owner's labels on 50 dev answers (Q5) with
Cohen's kappa before its numbers are reported. Its calls are cached and
budgeted like every other model call.
"""

import csv
import json
import random
import re
from pathlib import Path

from src.rag.workers_ai import GPT_OSS, WorkersAI

REPO_ROOT    = Path(__file__).resolve().parents[3]
LABELS_CSV   = REPO_ROOT / "reports" / "rag_judge_labels.csv"
LABELS_MD    = REPO_ROOT / "reports" / "rag_judge_labels.md"
LABELS_JSON  = REPO_ROOT / "reports" / "rag_judge_labels.json"   # the labelled answers with their sources, for the judge
JUDGE_MODEL  = GPT_OSS
JUDGE_SET_N  = 50
JUDGE_SEED   = 20261027
MAX_TOKENS   = 1500

RUBRIC = """You grade answers from a question-answering box on a basketball statistics site. The answer was written by another model from numbered facts [F1].. and sources [C1].. It must use only them.

Split the answer into its factual claims (each number, comparison or statement about a team, a season or the simulator is a claim). A refusal, a greeting, a hedge, or a statement about what the assistant can or can't answer is not a claim. For each claim decide:
- supported: "yes" if the facts or the sources below state it or directly imply it, "no" if they contradict it or don't contain it. A rounded number ("about 7 points" for 6.9) is supported. A claim that is true in reality but not in the material is "no".
- cited: "yes" if a label the claim's sentence cites supports it, "no" if the cited label doesn't, "none" if the sentence cites nothing.

Also decide "refused": true if the answer declines to answer the question (for example "Sorry, I can't answer that"), false if it answers.

Reply with JSON only, no other text:
{"claims": [{"claim": "<the claim in at most 12 words>", "supported": "yes|no", "cited": "yes|no|none"}], "refused": true|false}"""


def shown_labels(answer: str, sources: dict) -> list[str]:
    """What the judge (and the owner) sees: every fact, and the chunks the answer cites."""
    cited = set(re.findall(r"[FC]\d+", " ".join(re.findall(r"\[[^\]]*\]", answer))))
    return [lab for lab in sources if lab.startswith("F") or lab in cited]


def judge_message(question: str, answer: str, sources: dict) -> str:
    shown = shown_labels(answer, sources)
    parts = ["Question: " + question, "", "Answer: " + answer, "", "Material:"]
    parts += ["[" + lab + "] " + sources[lab] for lab in shown] or ["(none)"]
    return "\n".join(parts)


def parse(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data.get("claims"), list):
        return None
    return data


def score(data: dict, must_refuse: bool | None) -> dict:
    claims = [c for c in data["claims"] if isinstance(c, dict)]
    supported = [str(c.get("supported", "")).lower() == "yes" for c in claims]
    cited = [str(c.get("cited", "")).lower() == "yes" for c in claims]
    refused = bool(data.get("refused"))
    return {
        "claims":           len(claims),
        "faithfulness":     sum(supported) / len(claims) if claims else None,
        "citation_support": sum(cited) / len(claims) if claims else None,
        "faithful":         1 if all(supported) else 0,
        "citations_ok":     1 if all(cited) else 0,
        "refused":          refused,
        "refusal_correct":  (1 if refused else 0) if must_refuse else None,
    }


def judge_answer(client: WorkersAI, question: str, answer: str, sources: dict, must_refuse: bool | None) -> dict:
    messages = [{"role": "system", "content": RUBRIC},
                {"role": "user", "content": judge_message(question, answer, sources)}]
    reply = client.chat(JUDGE_MODEL, messages, max_tokens=MAX_TOKENS, reasoning_effort="low")
    data = parse(reply["text"])
    result = {"neurons": reply["neurons"], "raw": reply["text"]}
    if data is None:
        result.update({"error": "unparseable"})
        return result
    result.update(score(data, must_refuse))
    result["judged_claims"] = data["claims"]
    return result


# ---------------------------------------------------------------------------
# The judge set and the owner's labels (Q5)
# ---------------------------------------------------------------------------

def judge_set(questions: list[dict], n: int = JUDGE_SET_N, seed: int = JUDGE_SEED) -> list[str]:
    """n question ids, stratified by category (largest remainder), in a fixed order."""
    by_cat = {}
    for q in questions:
        by_cat.setdefault(q["category"], []).append(q["id"])
    total = len(questions)
    quota = {c: n * len(ids) / total for c, ids in by_cat.items()}
    counts = {c: int(q) for c, q in quota.items()}
    for c in sorted(quota, key=lambda c: (-(quota[c] - counts[c]), c))[:n - sum(counts.values())]:
        counts[c] += 1
    rng = random.Random(seed)
    picked = []
    for c in sorted(by_cat):
        picked += sorted(rng.sample(sorted(by_cat[c]), counts[c]))
    return picked


def write_label_sheet(rows: list[dict], csv_path: Path = LABELS_CSV, md_path: Path = LABELS_MD,
                      json_path: Path = LABELS_JSON) -> None:
    """
    rows: {id, category, question, answer, sources, must_refuse}. Writes the
    CSV the owner fills in, a Markdown file with each answer's facts and
    cited chunks for reading alongside it, and the rows as JSON so the judge
    later grades exactly the texts the owner labelled. The judge's verdicts
    are not shown.
    """
    for r in rows:
        r["sources"] = {lab: text for lab, text in r["sources"].items() if lab in shown_labels(r["answer"], r["sources"])}
    with open(json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
        f.write("\n")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "category", "question", "answer", "faithful", "citations_ok", "refusal_ok", "notes"])
        for r in rows:
            w.writerow([r["id"], r["category"], r["question"], r["answer"], "", "",
                        "" if r["must_refuse"] else "n/a", ""])
    lines = ["# Ask the Court: answers to label (Q5)", "",
             "Fill in `reports/rag_judge_labels.csv`, one row per answer below. Each answer shows the facts and the "
             "chunks it cites, which is everything the answer was allowed to use.", "",
             "- **faithful**: `yes` if every claim in the answer is supported by its facts or cited chunks (a rounded "
             "number like \"about 7 points\" for 6.9 counts as supported), `no` if any claim isn't.",
             "- **citations_ok**: `yes` if each claim's own citation supports it, `no` if any citation points at a "
             "source that doesn't say it (or a sentence with a fact cites nothing).",
             "- **refusal_ok**: only for questions marked *must refuse*: `yes` if the answer declined, `no` if it "
             "answered.",
             "- **notes**: anything else (optional).", ""]
    for i, r in enumerate(rows, 1):
        lines += ["## " + str(i) + ". `" + r["id"] + "` (" + r["category"] + ")" + (" — must refuse" if r["must_refuse"] else ""),
                  "", "**Question:** " + r["question"], "", "**Answer:** " + r["answer"], ""]
        for lab in shown_labels(r["answer"], r["sources"]):
            lines += ["<details><summary>[" + lab + "]</summary>", "", "```text", r["sources"][lab], "```", "",
                      "</details>", ""]
    md_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8", newline="\n")


def read_labels(csv_path: Path = LABELS_CSV) -> dict:
    """{id: {faithful, citations_ok, refusal_ok}} with 1/0/None; rows with no faithful label are skipped."""
    to_int = {"yes": 1, "y": 1, "1": 1, "no": 0, "n": 0, "0": 0}
    out = {}
    with open(csv_path, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            faithful = to_int.get(row["faithful"].strip().lower())
            if faithful is None:
                continue
            out[row["id"]] = {"faithful": faithful,
                              "citations_ok": to_int.get(row["citations_ok"].strip().lower()),
                              "refusal_ok": to_int.get(row["refusal_ok"].strip().lower())}
    return out
