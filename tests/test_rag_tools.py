"""
test_rag_tools.py

F13 Session 4 tests for Ask the Court's tools (src/rag/tools.py) and their
shared fixtures (tests/fixtures/rag/tools.json), which the Worker must also
pass. Everything reads committed files; nothing calls Cloudflare.

Run from repo root:
    python -m pytest tests/test_rag_tools.py -v
"""

import json
import math

import pytest

from scripts import build_rag_tool_fixtures as fixtures
from src.rag import grounding
from src.rag.corpus import neutral_p, sigmoid
from src.rag.index_local import load_corpus
from src.rag.tools import SUGGESTED, Tools, UnknownEntity, approx_margin, possessive, share_text, template_answer


@pytest.fixture(scope="module")
def tools():
    return Tools.from_files()


@pytest.fixture(scope="module")
def cards():
    return {c["id"]: c for c in load_corpus()}


@pytest.fixture(scope="module")
def committed():
    with open(fixtures.FIXTURES_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Fixtures (the Worker's contract)
# ---------------------------------------------------------------------------

def test_fixtures_are_the_tools_output(tools, committed):
    assert json.loads(json.dumps(fixtures.build_cases(tools), ensure_ascii=False)) == committed


def test_fixtures_cover_at_least_30_matchups(committed):
    assert len(committed["matchups"]) >= 30
    assert len({(m["a"], m["b"]) for m in committed["matchups"]}) == len(committed["matchups"])


# ---------------------------------------------------------------------------
# get_matchup
# ---------------------------------------------------------------------------

def test_matchup_returns_the_exported_p_and_m(tools):
    with open(tools.teams_dir / "1996-bulls.json", encoding="utf-8") as f:
        exported = json.load(f)["opponents"]["2017-warriors"]
    mu = tools.get_matchup("1996-bulls", "2017-warriors")
    assert (mu["p"], mu["m"]) == (exported["p"], exported["m"])
    assert mu["favoured"] == "2017-warriors" and mu["p_b"] == "53.1%"


def test_decomposition_adds_up_to_the_models_score(tools, committed):
    mi = tools.model_inputs
    for case in committed["matchups"]:
        mu = case["get_matchup"]
        assert math.isclose(sum(p["contribution"] for p in mu["parts"]), mu["score"], abs_tol=1e-5)
        # The score with the home intercept, both orders averaged, is the exported neutral p.
        assert neutral_p(mi, mu["a"], mu["b"]) == mu["p"]
        assert math.isclose(sum(p["share"] for p in mu["parts"]), 1.0, abs_tol=1e-3)
        b0 = mi["intercept"]
        assert (sigmoid(b0 + mu["score"]) + 1 - sigmoid(b0 - mu["score"])) / 2 == pytest.approx(mu["p"], abs=6e-4)


def test_each_part_favours_the_team_with_the_higher_z(tools):
    mu = tools.get_matchup("2008-pistons", "1987-celtics")
    by_label = {p["label"]: p for p in mu["parts"]}
    for p in by_label.values():
        higher = mu["a"] if float(p["z_a"]) > float(p["z_b"]) else mu["b"]
        assert p["favours"] == higher
    assert by_label["net rating"]["favours"] != by_label["win %"]["favours"]   # this pair's inputs disagree


def test_matchup_is_symmetric(tools):
    ab, ba = tools.get_matchup("1996-bulls", "2017-warriors"), tools.get_matchup("2017-warriors", "1996-bulls")
    assert ab["favoured"] == ba["favoured"]
    assert ab["p_a"] == ba["p_b"] and ab["p_b"] == ba["p_a"]


def test_unknown_teams_and_self_matchups_are_rejected(tools):
    with pytest.raises(UnknownEntity):
        tools.get_matchup("1996-bulls", "1972-lakers")
    with pytest.raises(ValueError):
        tools.get_matchup("1996-bulls", "1996-bulls")
    with pytest.raises(UnknownEntity):
        tools.get_season(1980)


@pytest.mark.parametrize("m, text", [(6.9, "about 7 points"), (-7.3, "about 7 points"), (0.7, "about 1 point"),
                                     (0.4, "less than a point"), (12.5, "about 13 points")])
def test_margins_are_never_precise(m, text):
    assert approx_margin(m) == text


def test_small_formatters():
    assert share_text(0.8834) == "88%" and share_text(0.115) == "12%"
    assert possessive("1985–86 Boston Celtics") == "1985–86 Boston Celtics'"
    assert possessive("2005–06 Miami Heat") == "2005–06 Miami Heat's"


# ---------------------------------------------------------------------------
# Facts agree with the cards
# ---------------------------------------------------------------------------

def test_every_team_fact_number_is_on_its_card(tools, cards):
    for key in tools.facts["teams"]:
        card = cards["team:" + key]["text"]
        card_pool = grounding.Pool.of([card])
        t = tools.get_team_season(key)
        assert t["title"] in card and t["record"] in card and t["playoffs"] in card
        for slug, s in t["stats"].items():
            assert s["value"] in card and ("z " + s["z"]) in card, (key, slug)
        for n in grounding.extract(tools.team_fact(key)):
            assert card_pool.supports(n), (key, n.raw)


def test_every_season_fact_number_is_on_its_season_card(tools, cards):
    for season in tools.facts["seasons"]:
        card = cards["season:" + season]["text"]
        titles = " ".join(cards["team:" + k]["title"] for k in tools.facts["teams"] if k.startswith(season))
        pool = grounding.Pool.of([card, titles])
        for n in grounding.extract(tools.season_fact(int(season))):
            assert pool.supports(n), (season, n.raw)


def test_team_fact_reads_well(tools):
    fact = tools.team_fact("1996-bulls")
    assert fact.startswith("1995–96 Chicago Bulls (1996-bulls): 72–10 (.878 win %), the best record of 29 teams.")
    assert "net rating +13.3 per 100 possessions (z +2.3, 1st of 29)" in fact
    assert "pace 91.8 (z -0.2, 19th fastest of 29)" in fact
    assert "The simulator reads net rating z +2.35 and win % z +2.21." in fact
    assert "box score" in fact
    assert "box score" not in tools.team_fact("2017-warriors")


def test_season_fact_reads_well(tools):
    fact = tools.season_fact(1999)
    assert "a shortened season of at most 50 games per team" in fact
    assert "champion 1998–99 San Antonio Spurs" in fact
    assert "best record 1998–99 Utah Jazz, 37–13" in fact


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def test_templates_pass_the_grounding_check(committed):
    for case in committed["matchups"]:
        for kind in SUGGESTED:
            t = case["templates"][kind]
            sources = {"F" + str(i): f for i, f in enumerate(t["facts"], 1)}
            report = grounding.check(t["text"], sources)
            assert report.ok, (case["a"], case["b"], kind, report.problems)


def test_why_template_states_the_exported_probability_and_both_inputs(tools):
    t = template_answer(tools, "why", "1996-bulls", "2017-warriors")
    assert "favours the 2016–17 Golden State Warriors: it gives them a 53.1% chance" in t["text"]
    assert "Net rating" in t["text"] and "Win %" in t["text"]
    assert "never happened" in t["text"]
    assert "." not in approx_margin(tools.get_matchup("1996-bulls", "2017-warriors")["m"])


def test_defence_template_compares_z_scores(tools):
    text = template_answer(tools, "defence", "1986-celtics", "2017-warriors")["text"]
    assert text.startswith("Relative to their own leagues, the 2016–17 Golden State Warriors had the better defence")
    assert "1985–86 Boston Celtics' ratings are computed from the box score" in text


def test_limits_template_uses_the_manifest(tools):
    t = template_answer(tools, "limits", "1986-celtics", "2017-warriors")
    assert t["facts"][0].startswith("Limitations of the hist-v2 simulator:")
    assert "about 11 points" in t["text"] and "injuries" in t["text"]
    assert len(t["facts"]) == 2      # the 1986 Celtics' box-score note
    assert len(template_answer(tools, "limits", "2016-warriors", "2017-warriors")["facts"]) == 1


def test_templates_never_quote_an_accuracy_figure_or_betting(committed):
    for case in committed["matchups"]:
        for kind in SUGGESTED:
            text = case["templates"][kind]["text"].lower()
            assert "accura" not in text and "odds" not in text and "bet" not in text.split()
