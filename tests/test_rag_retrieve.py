"""
test_rag_retrieve.py

F13 Session 3 tests for the retrieval pipeline (src/rag/retrieve.py): fusion,
filters, pinning, reranking and the split-card ablation. Model calls use a
fake client, so nothing here calls Cloudflare.

Run from repo root:
    python -m pytest tests/test_rag_retrieve.py -v
"""

import hashlib
import re

import numpy as np
import pytest

from scripts import eval_rag
from src.rag import config as rag_config
from src.rag.index_local import load_corpus
from src.rag.linker import Link
from src.rag.retrieve import (Constraints, RetrievalConfig, Retriever, allowed, constraints_for, dedupe_parents,
                              rrf, split_team_cards)


class FakeClient:
    """Bag-of-words embeddings and word-overlap reranking: deterministic, no network."""

    def __init__(self):
        self.rerank_calls = 0

    @staticmethod
    def vector(text):
        v = np.zeros(64, dtype=np.float32)
        for word in re.findall(r"[a-z0-9]+", text.lower()):
            v[int(hashlib.md5(word.encode()).hexdigest(), 16) % 64] += 1.0
        return v + 1e-3

    def embed(self, texts, model=None, pooling="cls"):
        return np.array([self.vector(t) for t in texts])

    def rerank(self, query, texts, model=None):
        self.rerank_calls += 1
        q = set(re.findall(r"[a-z0-9]+", query.lower()))
        return [float(len(q & set(re.findall(r"[a-z0-9]+", t.lower())))) for t in texts]


@pytest.fixture(scope="module")
def corpus():
    return load_corpus()


@pytest.fixture(scope="module")
def by_id(corpus):
    return {c["id"]: c for c in corpus}


# ---------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------

def test_rrf_rewards_agreement_and_breaks_ties_by_id():
    assert rrf([["a", "b", "c"], ["b", "a", "d"]])[:2] == ["a", "b"]
    assert rrf([["x"], ["y"]]) == ["x", "y"]
    assert rrf([["c", "b"], ["b"]])[0] == "b"


def test_dedupe_parents_keeps_first_position():
    assert dedupe_parents(["team:a#stats", "method:x", "team:a#summary", "team:b"]) == ["team:a", "method:x", "team:b"]


def test_constraints_merge_page_context():
    link = Link(keys=["1996-bulls"], seasons=[], season_range=(1990, 1999))
    c = constraints_for(link, {"a": "2017-warriors", "b": "1996-bulls"})
    assert c.keys == ["1996-bulls", "2017-warriors"]
    assert {1996, 2017, 1990, 1999} <= c.seasons
    assert constraints_for(Link(), None).empty


def test_filters(by_id):
    named = Constraints(keys=["2004-pistons"], seasons={2004}, season_range=None)
    assert allowed(by_id["team:2004-pistons"], named)
    assert not allowed(by_id["team:2005-pistons"], named)
    assert allowed(by_id["method:model-weights"], named)
    assert allowed(by_id["season:2004"], named) and not allowed(by_id["season:2005"], named)

    nineties = Constraints(keys=[], seasons=set(range(1990, 2000)), season_range=(1990, 1999))
    assert allowed(by_id["leaders:defence:1990s"], nineties)
    assert allowed(by_id["leaders:defence:all-time"], nineties)
    assert not allowed(by_id["leaders:defence:2000s"], nineties)
    assert allowed(by_id["team:1993-knicks"], nineties) and not allowed(by_id["team:2004-pistons"], nineties)
    assert allowed(by_id["team:2004-pistons"], Constraints([], set(), None))


def test_split_team_cards(by_id):
    parts = split_team_cards([by_id["team:1996-bulls"], by_id["method:neutral-court"]])
    assert [p["id"] for p in parts] == ["team:1996-bulls#summary", "team:1996-bulls#stats", "method:neutral-court"]
    summary, stats = parts[0]["text"], parts[1]["text"]
    assert summary.splitlines()[0] == stats.splitlines()[0] == "1995–96 Chicago Bulls (1996-bulls)."
    assert "72–10" in summary and "What the simulator reads" in summary
    assert "- Net rating:" in stats and "What the simulator reads" not in stats


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

def test_pinning_puts_named_teams_first(corpus):
    r = Retriever(corpus, RetrievalConfig(keyword=True, dense_model=None, filters=True, pin=True))
    top = r.search("Who had the better defence, the '04 Pistons or the 1993 Knicks?", None, 5)
    assert top[:2] == ["team:2004-pistons", "team:1993-knicks"]


def test_page_context_is_used_only_when_enabled(corpus):
    context = {"a": "1996-bulls", "b": "2017-warriors"}
    on = Retriever(corpus, RetrievalConfig(keyword=True, dense_model=None, use_context=True, filters=True, pin=True))
    assert on.search("Why does the model favour this team?", context, 5)[:2] == ["team:1996-bulls", "team:2017-warriors"]
    off = Retriever(corpus, RetrievalConfig(keyword=True, dense_model=None, pin=True))
    assert "team:1996-bulls" not in off.search("Why does the model favour this team?", context, 5)


def test_hybrid_rerank_fuse_runs_with_a_fake_client(corpus):
    client = FakeClient()
    r = Retriever(corpus, RetrievalConfig(dense_model="fake", use_context=True, filters=True, pin=True,
                                          rerank=True, rerank_mode="fuse"), client)
    top = r.search("Who had the best defence of the 1990s?", None, 10)
    assert client.rerank_calls == 1
    assert len(top) == len(set(top)) == 10
    assert "leaders:defence:2000s" not in top                 # filtered: another decade


def test_shipped_config_is_the_reported_one():
    assert rag_config.RETRIEVAL == eval_rag.CONFIGS["hybrid-filter-pin-rerank-fuse"]
