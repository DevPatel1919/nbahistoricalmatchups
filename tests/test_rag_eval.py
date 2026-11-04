"""
test_rag_eval.py

F13 Session 2 tests: the entity linker, the evaluation set, the metrics, the
keyword index and the Workers AI client. Nothing here calls Cloudflare: the
client is tested with a fake HTTP session, and everything else reads
committed files.

Run from repo root:
    python -m pytest tests/test_rag_eval.py -v
"""

import json

import pytest

from src.rag import workers_ai as wai
from src.rag.eval import generate, metrics
from src.rag.index_local import KeywordIndex, fts_query, load_corpus
from src.rag.linker import Linker, expand_two_digit, normalize

FIXTURES = generate.REPO_ROOT / "tests" / "fixtures" / "rag"


@pytest.fixture(scope="module")
def linker():
    return Linker.from_index()


@pytest.fixture(scope="module")
def questions():
    with open(generate.OUTPUT_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


@pytest.fixture(scope="module")
def corpus():
    return {c["id"]: c for c in load_corpus()}


# ---------------------------------------------------------------------------
# Linker
# ---------------------------------------------------------------------------

def _linker_cases():
    with open(FIXTURES / "linker.json", encoding="utf-8") as f:
        return json.load(f)["cases"]


@pytest.mark.parametrize("case", _linker_cases(), ids=lambda c: c["text"][:40])
def test_linker_fixtures(linker, case):
    expected = {"keys": case.get("keys", []), "seasons": case.get("seasons", []), "range": case.get("range"),
                "franchises": case.get("franchises", []), "unresolved": case.get("unresolved", [])}
    assert linker.link(case["text"]).as_dict() == expected


def test_linker_fixture_count():
    assert len(_linker_cases()) >= 80


def test_two_digit_years_follow_the_site_search():
    assert expand_two_digit("98") == 1998
    assert expand_two_digit("17") == 2017
    assert expand_two_digit("86") == 1986
    assert expand_two_digit("72") is None
    assert expand_two_digit("50") is None


def test_normalize_folds_quotes_and_dashes():
    assert normalize("The ’96 Bulls – 1995–96") == "the '96 bulls - 1995-96"


# ---------------------------------------------------------------------------
# Evaluation set
# ---------------------------------------------------------------------------

def test_eval_set_is_the_generators_output(questions):
    assert generate.build() == questions


def test_eval_set_shape(questions, corpus):
    assert len(questions) >= 240
    assert len({q["id"] for q in questions}) == len(questions)
    for q in questions:
        assert list(q) == generate.FIELDS
        assert all(c in corpus for c in q["relevant_chunk_ids"]), q["id"]
        if q["expected"].get("must_refuse"):
            assert not q["relevant_chunk_ids"], q["id"]


def test_split_is_stratified(questions):
    for category in {q["category"] for q in questions}:
        group = [q for q in questions if q["category"] == category]
        dev = sum(q["split"] == "dev" for q in group)
        assert abs(dev / len(group) - generate.DEV_SHARE) < 0.1, category


def test_expected_numbers_appear_in_a_relevant_chunk(questions, corpus):
    for q in questions:
        if q["category"] not in {"stat", "comparison", "ranking", "season"}:
            continue
        text = "\n".join(corpus[c]["text"] for c in q["relevant_chunk_ids"])
        for number in q["expected"].get("numbers", []):
            assert number in text, (q["id"], number)


def test_matchup_answers_use_the_exported_probability(questions):
    for q in questions:
        if q["category"] != "matchup":
            continue
        a, b = q["expected"]["keys"]
        with open(generate.TEAMS_DIR / (a + ".json"), encoding="utf-8") as f:
            p = json.load(f)["opponents"][b]["p"]
        assert q["expected"]["answer_key"] == (a if p > 0.5 else b)


def test_the_linker_finds_every_named_team(questions, linker):
    named = [q for q in questions if q["context"] is None]
    correct = [metrics.link_correct(q["link"], linker.link(q["question"]).keys) for q in named]
    assert metrics.mean(correct) == 1.0


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def test_retrieval_metrics():
    retrieved = ["x", "a", "y", "b"]
    assert metrics.recall_at(["a", "b"], retrieved, 2) == 0.5
    assert metrics.recall_at(["a", "b"], retrieved, 4) == 1.0
    assert metrics.hit_at(["b"], retrieved, 3) == 0.0
    assert metrics.reciprocal_rank(["b", "a"], retrieved) == 0.5
    assert metrics.reciprocal_rank(["z"], retrieved) == 0.0
    with pytest.raises(ValueError):
        metrics.recall_at([], retrieved, 5)


# ---------------------------------------------------------------------------
# Keyword index
# ---------------------------------------------------------------------------

def test_fts_query_drops_stopwords_and_quotes_tokens():
    assert fts_query("How good were the '96 Bulls?") == '"good" OR "96" OR "bulls"'
    assert fts_query("the of and") == ""
    assert '"' not in fts_query('say "NEAR" * OR').replace('"say"', "").replace('"near"', "")


def test_keyword_index_ranks_and_rebuilds(tmp_path):
    chunks = [
        {"id": "a", "type": "method", "title": "Pace", "text": "Pace is possessions per 48 minutes.",
         "keys": [], "seasons": [], "release": "r", "source": "s"},
        {"id": "b", "type": "method", "title": "Defence", "text": "Defensive rating counts points allowed.",
         "keys": [], "seasons": [], "release": "r", "source": "s"},
    ]
    path = tmp_path / "fts.sqlite"
    assert KeywordIndex(chunks, path).search("what is pace?")[0][0] == "a"
    chunks[0]["text"] = "Tempo only."
    assert [cid for cid, _ in KeywordIndex(chunks, path).search("defensive rating")] == ["b"]


# ---------------------------------------------------------------------------
# Workers AI client (fake HTTP)
# ---------------------------------------------------------------------------

class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json})
        return self.responses.pop(0)


def _ok(result):
    return FakeResponse(200, {"success": True, "result": result})


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "token")


def _client(tmp_path, session, cap=100.0):
    return wai.WorkersAI(cache_path=tmp_path / "cache.sqlite", daily_cap=cap, session=session,
                         today=lambda: "2026-10-26", sleep=lambda s: None)


def test_embed_caches_each_text(tmp_path, creds):
    session = FakeSession([_ok({"data": [[1.0, 0.0], [0.0, 1.0]]}), _ok({"data": [[0.5, 0.5]]})])
    client = _client(tmp_path, session)
    first = client.embed(["one", "two"], model=wai.EMBED_SMALL)
    again = client.embed(["two", "three", "one"], model=wai.EMBED_SMALL)
    assert first.tolist() == [[1.0, 0.0], [0.0, 1.0]]
    assert again.tolist() == [[0.0, 1.0], [0.5, 0.5], [1.0, 0.0]]
    assert [c["json"]["text"] for c in session.calls] == [["one", "two"], ["three"]]
    assert session.calls[0]["url"].endswith("/accounts/acct/ai/run/" + wai.EMBED_SMALL)


def test_cached_calls_need_no_credentials(tmp_path, creds, monkeypatch):
    client = _client(tmp_path, FakeSession([_ok({"data": [[1.0]]})]))
    client.embed(["x"], model=wai.EMBED_SMALL)
    monkeypatch.delenv("CLOUDFLARE_API_TOKEN")
    assert client.embed(["x"], model=wai.EMBED_SMALL).tolist() == [[1.0]]
    with pytest.raises(wai.MissingCredentials):
        client.embed(["new"], model=wai.EMBED_SMALL)


def test_budget_stops_calls_before_they_are_sent(tmp_path, creds):
    session = FakeSession([])
    client = _client(tmp_path, session, cap=0.001)
    with pytest.raises(wai.BudgetExceeded):
        client.embed(["a long text " * 50], model=wai.EMBED_BASE)
    assert session.calls == []


def test_ledger_adds_up_estimates(tmp_path, creds):
    client = _client(tmp_path, FakeSession([_ok({"data": [[1.0]]})]))
    client.embed(["x" * 4000], model=wai.EMBED_BASE)
    assert client.spent_today() == pytest.approx(wai.estimate_neurons(wai.EMBED_BASE, 1000))


def test_rerank_returns_scores_in_input_order(tmp_path, creds):
    session = FakeSession([_ok({"response": [{"id": 1, "score": 0.9}, {"id": 0, "score": 0.2}]})])
    client = _client(tmp_path, session)
    assert client.rerank("q", ["a", "b"]) == [0.2, 0.9]
    assert client.rerank("q", ["a", "b"]) == [0.2, 0.9]   # cached
    assert len(session.calls) == 1


def test_retries_rate_limits_then_raises_on_errors(tmp_path, creds):
    session = FakeSession([FakeResponse(429, {}), _ok({"data": [[2.0]]})])
    assert _client(tmp_path, session).embed(["y"], model=wai.EMBED_SMALL).tolist() == [[2.0]]
    bad = FakeSession([FakeResponse(400, {"success": False, "errors": [{"message": "bad"}]})])
    with pytest.raises(wai.WorkersAIError):
        _client(tmp_path / "other", bad).embed(["z"], model=wai.EMBED_SMALL)


def test_unknown_models_have_no_rate():
    with pytest.raises(ValueError):
        wai.estimate_neurons("@cf/unknown/model", 10)
