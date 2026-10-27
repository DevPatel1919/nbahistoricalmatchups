"""
retrieve.py

The Python reference retrieval pipeline for Ask the Court (F13 Session 3).
Each stage can be switched off, so every part has to earn its place in the
evaluation (reports/rag_evaluation.md):

    1. link      the linker's team-seasons, seasons and decade, plus the
                 page's matchup when the question is asked on one
    2. query     the question; on a matchup page the two team titles are
                 appended, since "Why is this so close?" names no team
    3. retrieve  BM25 (FTS5) and/or exact dense search, each a ranked list
    4. filter    drop chunks the linked entities rule out (other seasons of
                 a named team, leaderboards for another decade); method
                 chunks are never dropped
    5. fuse      reciprocal rank fusion of the lists: sum of 1 / (60 + rank)
    6. pin       the linked teams' cards go first. They are the tool facts
                 the generator always gets, so retrieval must not lose them
    7. rerank    bge-reranker-base reorders the next candidates, either
                 replacing the fused order or fused with it by RRF

The Worker (Session 5) implements the same stages with Vectorize metadata
filters in place of step 4's post-filter.
"""

from dataclasses import dataclass

from src.rag.index_local import FTS_PATH, DenseIndex, KeywordIndex
from src.rag.linker import Linker
from src.rag.workers_ai import EMBED_SMALL, RERANKER, WorkersAI

RRF_K = 60

# BGE's recommended instruction for short retrieval queries (the passages
# are embedded without it).
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


@dataclass(frozen=True)
class RetrievalConfig:
    keyword: bool = True
    dense_model: str | None = EMBED_SMALL
    query_prefix: str = ""
    use_context: bool = False      # append the page's matchup to the query
    filters: bool = False
    pin: bool = False
    rerank: bool = False
    rerank_mode: str = "replace"   # "replace": reranker order wins; "fuse": RRF of fused and reranked orders
    candidates: int = 30           # per retriever, after filtering
    rerank_pool: int = 20          # how many fused candidates the reranker sees
    pool: int = 300                # rows fetched before filtering


def parent_id(chunk_id: str) -> str:
    """'team:1996-bulls#stats' -> 'team:1996-bulls' (split-chunk ablation)."""
    return chunk_id.split("#", 1)[0]


def dedupe_parents(ids: list) -> list:
    seen, out = set(), []
    for cid in ids:
        p = parent_id(cid)
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def rrf(lists: list[list]) -> list:
    """Reciprocal rank fusion: ids ordered by sum of 1 / (RRF_K + rank), ties by id."""
    scores = {}
    for ranked in lists:
        for rank, cid in enumerate(ranked, start=1):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank)
    return sorted(scores, key=lambda c: (-scores[c], c))


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

@dataclass
class Constraints:
    keys: list
    seasons: set           # seasons named, or covered by a decade, or of a linked key
    season_range: tuple | None

    @property
    def empty(self) -> bool:
        return not self.keys and not self.seasons and self.season_range is None


def constraints_for(link, context: dict | None) -> Constraints:
    keys = list(link.keys)
    if context:
        keys += [k for k in (context["a"], context["b"]) if k not in keys]
    seasons = set(link.seasons) | {int(k[:4]) for k in keys}
    if link.season_range:
        seasons |= set(range(link.season_range[0], link.season_range[1] + 1))
    return Constraints(keys, seasons, link.season_range)


def allowed(chunk: dict, c: Constraints) -> bool:
    """Whether a chunk survives the linked constraints."""
    if c.empty or chunk["type"] == "method":
        return True
    if chunk["type"] == "team_card":
        if c.keys:
            return chunk["keys"][0] in c.keys
        return chunk["seasons"][0] in c.seasons
    if chunk["type"] == "season_card":
        return not c.seasons or chunk["seasons"][0] in c.seasons
    if chunk["type"] == "leaderboard":
        if c.season_range is None:
            return True
        span = (min(chunk["seasons"]), max(chunk["seasons"]))
        return span == c.season_range or chunk["id"].endswith(":all-time")
    return True


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class Retriever:
    def __init__(self, chunks: list[dict], config: RetrievalConfig, client: WorkersAI | None = None,
                 linker: Linker | None = None):
        self.config = config
        self.chunks = {c["id"]: c for c in chunks}
        self.linker = linker or Linker.from_index()
        self.client = client
        self.titles = {}
        for c in chunks:
            if c["type"] == "team_card":
                self.titles[c["keys"][0]] = c["title"]
        split = any("#" in c["id"] for c in chunks)
        fts_path = FTS_PATH.with_name("fts_split.sqlite") if split else FTS_PATH
        self.keyword = KeywordIndex(chunks, fts_path) if config.keyword else None
        self.dense = None
        if config.dense_model:
            self.dense = DenseIndex(chunks, client, model=config.dense_model, query_prefix=config.query_prefix)

    def query_text(self, question: str, context: dict | None) -> str:
        if not (self.config.use_context and context):
            return question
        names = [self.titles.get(k, k) for k in (context["a"], context["b"])]
        return question + " (" + " vs ".join(names) + ")"

    def search(self, question: str, context: dict | None = None, k: int = 20) -> list:
        cfg = self.config
        link = self.linker.link(question)
        cons = constraints_for(link, context if cfg.use_context else None)
        query = self.query_text(question, context)

        lists = []
        for index in (self.keyword, self.dense):
            if index is None:
                continue
            ranked = [cid for cid, _ in index.search(query, cfg.pool if cfg.filters else cfg.candidates)]
            if cfg.filters:
                ranked = [cid for cid in ranked if allowed(self.chunks[cid], cons)]
            lists.append(ranked[:cfg.candidates])
        fused = rrf(lists) if len(lists) > 1 else lists[0]

        pinned = []
        if cfg.pin:
            for key in cons.keys:
                for cid in self.chunks:
                    if parent_id(cid) == "team:" + key and cid not in pinned:
                        pinned.append(cid)
        rest = [cid for cid in fused if cid not in pinned]

        if cfg.rerank and rest:
            pool = rest[:cfg.rerank_pool]
            scores = self.client.rerank(question, [self.chunks[cid]["text"] for cid in pool], model=RERANKER)
            order = [pool[i] for i in sorted(range(len(pool)), key=lambda i: (-scores[i], i))]
            if cfg.rerank_mode == "fuse":
                order = rrf([pool, order])
            rest = order + rest[cfg.rerank_pool:]

        return dedupe_parents(pinned + rest)[:k]


def split_team_cards(chunks: list[dict]) -> list[dict]:
    """
    The chunking ablation: each team card becomes two chunks, a summary
    (identity, record, playoffs, scoring, model inputs) and its stat lines.
    Both keep the card's title line so either can be found by name.
    """
    out = []
    for c in chunks:
        if c["type"] != "team_card":
            out.append(c)
            continue
        lines = c["text"].split("\n")
        cut = next(i for i, line in enumerate(lines) if line.startswith("Compared with the"))
        summary = lines[:cut] + [line for line in lines[cut:] if line.startswith("What the simulator reads")]
        stats = [lines[0]] + [line for line in lines[cut:] if not line.startswith("What the simulator reads")]
        for suffix, part in (("summary", summary), ("stats", stats)):
            out.append(dict(c, id=c["id"] + "#" + suffix, text="\n".join(part)))
    return out
