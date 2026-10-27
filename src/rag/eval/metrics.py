"""
metrics.py

Retrieval, linking and answer metrics for Ask the Court (F13). The judge's
metrics (faithfulness, citation support) are in judge.py.
"""

import re
from decimal import Decimal

from src.rag import grounding


def recall_at(relevant: list, retrieved: list, k: int) -> float:
    """Share of the relevant chunks found in the top k."""
    if not relevant:
        raise ValueError("recall is undefined without relevant chunks")
    return len(set(relevant) & set(retrieved[:k])) / len(set(relevant))


def hit_at(relevant: list, retrieved: list, k: int) -> float:
    """1 if any relevant chunk is in the top k."""
    return 1.0 if set(relevant) & set(retrieved[:k]) else 0.0


def reciprocal_rank(relevant: list, retrieved: list) -> float:
    """1 / rank of the first relevant chunk, 0 if none was retrieved."""
    wanted = set(relevant)
    for rank, cid in enumerate(retrieved, start=1):
        if cid in wanted:
            return 1.0 / rank
    return 0.0


def link_correct(expected: list, linked: list) -> float:
    """1 if the linker found exactly the expected team-seasons (order ignored)."""
    return 1.0 if set(expected) == set(linked) else 0.0


def mean(values: list) -> float:
    return sum(values) / len(values) if values else float("nan")


# ---------------------------------------------------------------------------
# Answers (Session 4)
# ---------------------------------------------------------------------------

# The opening of a refusal: the system prompt's two refusal sentences, and
# the ways models paraphrase them. "Cannot be rebuilt" is not a refusal, so
# the verbs must be about answering.
REFUSAL = re.compile(r"\b(sorry|(?:can't|cannot|can not|unable to|not able to) (?:answer|help|provide|say|tell)"
                     r"|i (?:don't|do not) have|(?:isn't|is not|aren't|are not) (?:in|part of|covered by) the"
                     r" (?:site's )?data|no data)\b", re.IGNORECASE)

# A margin stated with a decimal ("by 7.3 points", "a 7.3-point margin").
PRECISE_MARGIN = re.compile(r"(?:margin|win by|by)\D{0,30}\d+\.\d\s*-?\s*points?\b|\b\d+\.\d\s*-?\s*point margin",
                            re.IGNORECASE)


def numbers_correct(expected: list, answer: str, complement: bool = False) -> float:
    """
    1 if every expected number is in the answer at the expected precision (% <-> fraction allowed).
    complement=True also accepts 100 - p for an expected percentage: matchup questions expect the
    favoured team's chance, but "What chance does the model give A against B?" is rightly answered
    with A's, the complement.
    """
    pool = grounding.Pool.of([answer])
    wanted = [n for e in expected for n in grounding.extract(e)]

    def found(n):
        if pool.supports(n):
            return True
        return (complement and n.kind == "percent"
                and pool.supports(grounding.Num("percent", Decimal(100) - n.value, n.places, n.raw)))

    return 1.0 if wanted and all(found(n) for n in wanted) else 0.0


def first_sentence(answer: str) -> str:
    parts = grounding.sentences(answer)
    return parts[0] if parts else ""


def refused(answer: str) -> bool:
    """Whether the answer declines: a refusal phrase in its first sentence."""
    return bool(REFUSAL.search(first_sentence(answer)))


def answer_key_correct(answer_key: str, answer: str, linker) -> float:
    """
    1 if the first team-season the answer names is answer_key. A heuristic:
    answers that lead with the other team ("Compared with X, Y...") count as
    wrong, so the judge and the owner's labels are the check on it.
    """
    for sentence in grounding.sentences(answer):
        keys = linker.link(grounding.CITATION.sub(" ", sentence)).keys
        if keys:
            return 1.0 if keys[0] == answer_key else 0.0
    return 0.0


def must_not_contain_hits(phrases: list, answer: str) -> list:
    low = answer.lower()
    return [p for p in phrases if p.lower() in low]


def precise_margin(answer: str) -> bool:
    return bool(PRECISE_MARGIN.search(grounding.normalize(answer)))


def percentile(values: list, q: float) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))]


def cohen_kappa(a: list, b: list) -> float:
    """Cohen's kappa for two raters' binary labels."""
    if len(a) != len(b) or not a:
        raise ValueError("kappa needs two equal, non-empty label lists")
    n = len(a)
    observed = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    expected = pa * pb + (1 - pa) * (1 - pb)
    return 1.0 if expected == 1 else (observed - expected) / (1 - expected)
