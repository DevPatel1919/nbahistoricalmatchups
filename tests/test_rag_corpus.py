"""
test_rag_corpus.py

F13 Session 1 acceptance tests for scripts/build_rag_corpus.py (Ask the
Court: the retrieval corpus and the model inputs).

The unit tests cover the formatting and chunk rules on small inputs. The
artifact tests read the committed data/rag/corpus.jsonl and
data/rag/model_inputs.json with the committed frontend/public/data/, so they
run without data/raw/. The rebuild test re-runs the builder and is skipped
when the gitignored inputs (data/raw/, data/processed/) are missing.

Run from repo root:
    python scripts/build_rag_corpus.py
    python -m pytest tests/test_rag_corpus.py -v
"""

import json
import re

import pandas as pd
import pytest

from scripts import build_rag_corpus as build
from src.rag import corpus as rag
from src.rag import textfmt as fmt

needs_corpus = pytest.mark.skipif(not (build.CORPUS_PATH.exists() and build.MODEL_INPUTS_PATH.exists()),
                                  reason="data/rag/ not built")
needs_raw = pytest.mark.skipif(
    not (build.GAMES_PATH.exists()
         and (build.REPO_ROOT / "data" / "processed" / "team_season_profiles_extended.csv").exists()
         and (build.REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv").exists()),
    reason="data/raw/ or data/processed/ not present")


@pytest.fixture(scope="module")
def chunks():
    with open(build.CORPUS_PATH, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


@pytest.fixture(scope="module")
def by_id(chunks):
    return {c["id"]: c for c in chunks}


@pytest.fixture(scope="module")
def model_inputs():
    with open(build.MODEL_INPUTS_PATH, encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def index():
    with open(build.INDEX_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def test_season_labels_match_the_site():
    assert fmt.season_label(1996) == "1995–96"
    assert fmt.season_label(2000) == "1999–00"
    assert fmt.season_label(1986) == "1985–86"
    assert fmt.team_title(1996, "Chicago", "Bulls") == "1995–96 Chicago Bulls"
    assert fmt.short_label(2004, "Pistons") == "'04 Pistons"


def test_number_formats():
    assert fmt.record(72, 10) == "72–10"
    assert fmt.frac3(0.8780) == ".878"
    assert fmt.frac3(1.0) == "1.000"
    assert fmt.rating(114.349) == "114.3"
    assert fmt.signed(13.29) == "+13.3"
    assert fmt.signed(-2.04) == "-2.0"
    assert fmt.signed(-0.04) == "+0.0"
    assert fmt.signed(2.354, 2) == "+2.35"
    assert fmt.pct1(0.1499) == "15.0%"


def test_ordinals():
    assert [fmt.ordinal(n) for n in (1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111)] == \
           ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]


def test_z_direction_reads_from_the_teams_point_of_view():
    assert fmt.describe_z(2.3, True) == "better than average"
    assert fmt.describe_z(-2.0, False) == "better than average"   # a low defensive rating is good
    assert fmt.describe_z(1.1, False) == "worse than average"
    assert fmt.describe_z(-0.2, None) == "slower than average"
    assert fmt.describe_z(0.04, True) == "average"
    assert fmt.describe_z(float("nan"), True) == "not available"


def test_aliases_cover_common_spellings():
    aliases = fmt.team_aliases(1996, "Chicago", "Bulls")
    for form in ["'96 Bulls", "96 Bulls", "1996 Bulls", "Bulls 1996", "1995-96 Bulls"]:
        assert form in aliases


# ---------------------------------------------------------------------------
# Chunk rules
# ---------------------------------------------------------------------------

def _chunk(text, keys=(), chunk_id="x"):
    return rag.make_chunk(chunk_id, "method", "T", list(keys), [], text, "hist-v2", "test")


@pytest.mark.parametrize("text", [
    "The old model claimed 71.04% in the playoffs.",
    "The model's accuracy on test games was 64.6%.",
    "Check the odds before tip-off.",
    "A good bet for tonight.",
    "Numbers scraped from Basketball-Reference.",
])
def test_forbidden_text_is_rejected(text):
    with pytest.raises(ValueError, match="forbidden"):
        rag.check_corpus([_chunk(text)], set())


def test_allowed_disclaimers_pass():
    rag.check_corpus([_chunk("Output is a model estimate, not a forecast or betting advice. "
                             "The log-odds move with net rating. No accuracy figure is published.")], set())


def test_duplicate_ids_and_unknown_keys_are_rejected():
    with pytest.raises(ValueError, match="Duplicate"):
        rag.check_corpus([_chunk("a"), _chunk("b")], set())
    with pytest.raises(ValueError, match="not in index"):
        rag.check_corpus([_chunk("a", keys=["1996-bulls"])], {"1997-bulls"})


def test_markdown_sections_join_wrapped_lines():
    md = "preamble\n## First\nline one\nline two\n\nnew paragraph\n## Second\nbody\n"
    assert rag.split_markdown_sections(md) == [("First", "line one line two\n\nnew paragraph"),
                                               ("Second", "body")]


def test_season_ranks_respect_direction():
    frame = pd.DataFrame({"season": [1, 1, 1], "drtg": [100.0, 95.0, 105.0]})
    assert rag.season_ranks(frame, "drtg", False).tolist() == [2, 1, 3]   # lowest is best
    assert rag.season_ranks(frame, "drtg", True).tolist() == [2, 3, 1]


# ---------------------------------------------------------------------------
# Model inputs (committed artifact)
# ---------------------------------------------------------------------------

@needs_corpus
def test_model_inputs_reproduce_the_exported_p(model_inputs):
    repro = rag.reproduction_check(model_inputs, build.TEAMS_DIR, build.REPRO_SAMPLES, build.REPRO_SEED)
    assert repro["max_abs_diff"] <= build.REPRO_TOLERANCE, repro


@needs_corpus
def test_model_inputs_cover_every_team_and_only_non_zero_features(model_inputs, index):
    assert model_inputs["release"] == index["release"]["version"]
    assert set(model_inputs["teams"]) == {t["key"] for t in index["teams"]}
    assert sorted(model_inputs["weights"]) == ["regular_net_rating_z", "regular_win_pct_z"]
    assert all(w > 0 for w in model_inputs["weights"].values())
    for z in model_inputs["teams"].values():
        assert set(z) == set(model_inputs["weights"])


@needs_corpus
def test_neutral_p_is_complementary_and_contributions_add_up(model_inputs):
    a, b = "1996-bulls", "2017-warriors"
    assert abs(rag.neutral_p(model_inputs, a, b) + rag.neutral_p(model_inputs, b, a) - 1) < 1e-4
    parts = rag.logit_contributions(model_inputs, a, b)
    flipped = rag.logit_contributions(model_inputs, b, a)
    assert all(abs(parts[f] + flipped[f]) < 1e-12 for f in parts)


# ---------------------------------------------------------------------------
# Corpus (committed artifact)
# ---------------------------------------------------------------------------

@needs_corpus
def test_corpus_passes_its_own_checks(chunks, index):
    rag.check_corpus(chunks, {t["key"] for t in index["teams"]})


@needs_corpus
def test_one_team_card_per_team_and_one_season_card_per_season(chunks, index):
    keys = {t["key"] for t in index["teams"]}
    seasons = {t["season"] for t in index["teams"]}
    cards = [c for c in chunks if c["type"] == "team_card"]
    assert sorted(c["id"] for c in cards) == sorted("team:" + k for k in keys)
    for c in cards:
        assert len(c["keys"]) == 1 and c["seasons"] == [int(c["keys"][0][:4])]
    assert sorted(c["seasons"][0] for c in chunks if c["type"] == "season_card") == sorted(seasons)


@needs_corpus
def test_chunk_fields_and_release(chunks, index):
    fields = ["id", "type", "title", "keys", "seasons", "text", "release", "source"]
    for c in chunks:
        assert list(c) == fields
        assert c["release"] == index["release"]["version"]
        assert c["type"] in {"team_card", "season_card", "leaderboard", "method"}


@needs_corpus
def test_no_chunk_is_too_long_for_the_embedding_model(chunks):
    # bge-base reads at most 512 tokens; the estimate runs a little high on this text.
    assert max(rag.estimated_tokens(c["text"]) for c in chunks) <= 480


@pytest.mark.parametrize("key,expected", [
    ("1996-bulls",   ["1995–96 Chicago Bulls", "72–10", "Won the 1995–96 NBA championship",
                      "going 15–3", "the best record of 29 teams", "computed from the box score"]),
    ("2004-pistons", ["2003–04 Detroit Pistons", "54–28", "Won the 2003–04 NBA championship",
                      "going 16–7", "Defensive rating: 93.8"]),
    ("1986-celtics", ["1985–86 Boston Celtics", "67–15", "Won the 1985–86 NBA championship",
                      "the best record of 23 teams"]),
    ("2017-warriors", ["2016–17 Golden State Warriors", "67–15", "Won the 2016–17 NBA championship"]),
])
@needs_corpus
def test_golden_team_cards(by_id, key, expected):
    text = by_id["team:" + key]["text"]
    for fragment in expected:
        assert fragment in text, fragment
    assert "'" + key[2:4] + " " in text   # the short alias, e.g. '96 Bulls


@needs_corpus
def test_team_cards_show_the_model_inputs(by_id, model_inputs):
    text = by_id["team:1996-bulls"]["text"]
    z = model_inputs["teams"]["1996-bulls"]
    assert "net rating z " + fmt.signed(z["regular_net_rating_z"], 2) in text
    assert "win % z " + fmt.signed(z["regular_win_pct_z"], 2) in text


@needs_corpus
def test_short_and_post_1997_seasons(by_id):
    assert "no team played more than 50" in by_id["season:1999"]["text"]
    assert "computed from the box score" not in by_id["team:2017-warriors"]["text"]
    assert "Champion: 2019–20 Los Angeles Lakers" in by_id["season:2020"]["text"]   # the bubble Finals


@needs_corpus
def test_leaderboards_are_complete_and_inside_their_era(chunks, index):
    season_of = {t["key"]: t["season"] for t in index["teams"]}
    boards = [c for c in chunks if c["type"] == "leaderboard"]
    assert len(boards) == len(rag.LEADERBOARDS) * len(rag.ERAS)
    eras = {era: (start, end) for era, start, end in rag.ERAS}
    for c in boards:
        assert len(c["keys"]) == rag.LEADERBOARD_SIZE
        start, end = eras[c["id"].rsplit(":", 1)[1]]
        if start is not None:
            assert all(start <= season_of[k] <= end for k in c["keys"]), c["id"]
        ranks = [int(m) for m in re.findall(r"(?m)^(\d+)\. ", c["text"])]
        assert ranks == list(range(1, rag.LEADERBOARD_SIZE + 1))


@needs_corpus
def test_leaderboard_order_follows_the_z_score(by_id):
    zs = [float(z) for z in re.findall(r", z ([+-]\d+\.\d)", by_id["leaders:defence:all-time"]["text"])]
    assert zs == sorted(zs)   # best defence = most negative z first
    zs = [float(z) for z in re.findall(r", z ([+-]\d+\.\d)", by_id["leaders:net-rating:1990s"]["text"])]
    assert zs == sorted(zs, reverse=True)


@needs_corpus
def test_method_chunks_cover_the_release_and_model(by_id, model_inputs):
    assert "No accuracy figure is published" in by_id["method:release-limitations"]["text"]
    weights = by_id["method:model-weights"]["text"]
    assert format(model_inputs["weights"]["regular_net_rating_z"], ".3f") in weights
    assert "method:why-teams-are-compared-with-their-own-league" in by_id


# ---------------------------------------------------------------------------
# Rebuild
# ---------------------------------------------------------------------------

@needs_raw
@needs_corpus
def test_rebuild_is_byte_identical(tmp_path):
    build.build(output_dir=tmp_path)
    for name in [build.CORPUS_PATH.name, build.MODEL_INPUTS_PATH.name]:
        assert (tmp_path / name).read_bytes() == (build.OUTPUT_DIR / name).read_bytes(), name
