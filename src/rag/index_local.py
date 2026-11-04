"""
index_local.py

The Python reference's two retrievers (F13 Session 2):

- KeywordIndex: SQLite FTS5 with BM25 over chunk titles and text, in
  data/processed/rag/fts.sqlite. The schema is the one the D1 migration will
  use (Session 5), so the same MATCH queries run in both.
- DenseIndex: exact cosine search over Workers AI embeddings of every chunk.
  The Worker uses Vectorize instead (approximate). With about 1,300 chunks,
  exact search here is the ground truth for Vectorize's recall.

Both return [(chunk_id, score)], best first.
"""

import hashlib
import json
import re
import sqlite3
from pathlib import Path

import numpy as np

from src.rag.linker import normalize
from src.rag.workers_ai import EMBED_BASE, WorkersAI

REPO_ROOT   = Path(__file__).resolve().parents[2]
CORPUS_PATH = REPO_ROOT / "data" / "rag" / "corpus.jsonl"
FTS_PATH    = REPO_ROOT / "data" / "processed" / "rag" / "fts.sqlite"

# Title matches count five times as much as body matches.
BM25_WEIGHTS = (5.0, 1.0)

# Words too common in questions to help keyword search.
STOPWORDS = set("""
a an and are as at be been but by can could did do does for from had has have how i if in into is it its
me my of on or over than that the their them then there these they this to under up was were what when
which who whom why will with would you your about against between during per vs versus
""".split())

FTS_SCHEMA = """
CREATE TABLE ask_chunks (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL,
    keys TEXT NOT NULL, seasons TEXT NOT NULL, release TEXT NOT NULL
);
CREATE VIRTUAL TABLE ask_chunks_fts USING fts5(
    title, text, content='ask_chunks', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE ask_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def load_corpus(path: Path = CORPUS_PATH) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def corpus_digest(chunks: list[dict]) -> str:
    blob = json.dumps(chunks, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def fts_query(question: str) -> str:
    """'How good were the '96 Bulls?' -> '"good" OR "96" OR "bulls"' (quoted, so no FTS5 syntax leaks in)."""
    tokens = re.findall(r"[a-z0-9]+", normalize(question))
    kept = []
    for t in tokens:
        if t not in STOPWORDS and t not in kept:
            kept.append(t)
    return " OR ".join('"' + t + '"' for t in kept)


# ---------------------------------------------------------------------------
# Keyword (FTS5, BM25)
# ---------------------------------------------------------------------------

class KeywordIndex:
    def __init__(self, chunks: list[dict], path: Path = FTS_PATH):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        digest = corpus_digest(chunks)
        try:
            row = self.db.execute("SELECT value FROM ask_meta WHERE name = 'corpus'").fetchone()
        except sqlite3.OperationalError:
            row = None
        if row is None or row[0] != digest:
            self.build(chunks, digest)

    def build(self, chunks: list[dict], digest: str) -> None:
        for table in ["ask_chunks_fts", "ask_chunks", "ask_meta"]:
            self.db.execute("DROP TABLE IF EXISTS " + table)
        self.db.executescript(FTS_SCHEMA)
        self.db.executemany("INSERT INTO ask_chunks VALUES (?, ?, ?, ?, ?, ?, ?)",
                            [(c["id"], c["type"], c["title"], c["text"], json.dumps(c["keys"]),
                              json.dumps(c["seasons"]), c["release"]) for c in chunks])
        self.db.execute("INSERT INTO ask_chunks_fts (rowid, title, text) SELECT rowid, title, text FROM ask_chunks")
        self.db.execute("INSERT INTO ask_meta VALUES ('corpus', ?)", (digest,))
        self.db.commit()

    def search(self, question: str, k: int = 20) -> list[tuple[str, float]]:
        match = fts_query(question)
        if not match:
            return []
        rows = self.db.execute(
            "SELECT c.id, bm25(ask_chunks_fts, ?, ?) AS score FROM ask_chunks_fts"
            " JOIN ask_chunks c ON c.rowid = ask_chunks_fts.rowid"
            " WHERE ask_chunks_fts MATCH ? ORDER BY score, c.id LIMIT ?",
            (*BM25_WEIGHTS, match, k)).fetchall()
        return [(cid, -score) for cid, score in rows]   # FTS5's bm25 is lower-is-better


# ---------------------------------------------------------------------------
# Dense (Workers AI embeddings, exact cosine)
# ---------------------------------------------------------------------------

class DenseIndex:
    def __init__(self, chunks: list[dict], client: WorkersAI, model: str = EMBED_BASE,
                 pooling: str = "cls", query_prefix: str = ""):
        self.ids = [c["id"] for c in chunks]
        self.client, self.model, self.pooling, self.query_prefix = client, model, pooling, query_prefix
        vectors = client.embed([c["text"] for c in chunks], model=model, pooling=pooling)
        self.matrix = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)

    def search(self, question: str, k: int = 20) -> list[tuple[str, float]]:
        q = self.client.embed([self.query_prefix + question], model=self.model, pooling=self.pooling)[0]
        scores = self.matrix @ (q / np.linalg.norm(q))
        top = np.argsort(-scores, kind="stable")[:k]
        return [(self.ids[i], float(scores[i])) for i in top]
