"""
config.py

The retrieval configuration Ask the Court ships with (F13 Session 3), chosen
on the dev split. reports/rag_evaluation.md has the ablation behind each
setting; the Worker (Session 5) must match it.
"""

from src.rag.retrieve import RetrievalConfig
from src.rag.workers_ai import EMBED_SMALL

RETRIEVAL = RetrievalConfig(
    keyword=True,              # BM25 over FTS5: exact names and years
    dense_model=EMBED_SMALL,   # bge-small beat bge-base on dev; CLS pooling, no query prefix (prefix didn't help)
    query_prefix="",
    use_context=True,          # the page's matchup joins the query and the linked keys
    filters=True,              # drop chunks the linked teams, seasons or decade rule out
    pin=True,                  # linked teams' cards always come first (the tool facts)
    rerank=True,               # bge-reranker-base on the top 20 ...
    rerank_mode="fuse",        # ... fused with the retrieval order; replacing it lost rankings
    candidates=30,
    rerank_pool=20,
)

# How many retrieved chunks the generator sees, besides the pinned cards.
CONTEXT_CHUNKS = 5
