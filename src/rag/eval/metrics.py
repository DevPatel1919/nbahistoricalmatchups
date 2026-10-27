"""
metrics.py

Retrieval and linking metrics for Ask the Court (F13). Answer-level metrics
(numbers, faithfulness, refusals) arrive in Session 4.
"""


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
