"""
test_rag_grounding.py

F13 Session 4 tests for the grounding check (src/rag/grounding.py): number
extraction on the tricky formats, matching after normalisation, citations,
and stripping. The Worker's grounding.ts must pass the same cases.

Run from repo root:
    python -m pytest tests/test_rag_grounding.py -v
"""

from decimal import Decimal

import pytest

from src.rag import grounding as g
from src.rag import textfmt as fmt


def kinds(text):
    return [(n.kind, n.value if not isinstance(n.value, Decimal) else str(n.value)) for n in g.extract(text)]


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text, expected", [
    ("went 72–10",                 [("record", (72, 10))]),
    ("went 72-10",                 [("record", (72, 10))]),
    ("a .574 win %",               [("fraction", "0.574")]),
    ("0.574",                      [("fraction", "0.574")]),
    ("57.4% of games",             [("percent", "57.4")]),
    ("57 percent",                 [("percent", "57")]),
    ("in 1995–96",                 [("season", 1996)]),
    ("in 1995-1996",               [("season", 1996)]),
    ("the 1999–00 season",         [("season", 2000)]),
    ("the '96 Bulls",              [("season", 1996)]),
    ("the ’17 Warriors",           [("season", 2017)]),
    ("in 1996",                    [("year", 1996)]),
    ("about 7 points",             [("number", "7")]),
    ("+13.3 per 100",              [("number", "13.3"), ("number", "100")]),
    ("z −2.0",                     [("number", "2.0")]),
    ("19th fastest",               [("number", "19")]),
    ("seven teams",                [("number", "7")]),
    ("the 1990s and the '80s",     [("decade", "1990"), ("decade", "80")]),
    ("three-point % of .403",      [("fraction", "0.403")]),
    ("3-pointers",                 []),
    ("cites [F1] and [C12]",       []),
    ("hist-v2",                    []),
    ("2.1 to 3",                   [("number", "2.1"), ("number", "3")]),
])
def test_extraction(text, expected):
    assert kinds(text) == expected


def test_seasons_need_consecutive_years():
    assert kinds("1995–97") == [("year", 1995), ("year", 1997)] or kinds("1995–97")[0][0] != "season"


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

CARD = ("1995–96 Chicago Bulls (1996-bulls). Regular season 1995–96: 72–10 (.878 win %). "
        "Net rating: +13.3 per 100 possessions (z +2.3; 1st). Pace: 91.8 (19th fastest). "
        "Assist %: 61.8% of field goals assisted. Estimated margin 6.9.")


@pytest.mark.parametrize("claim", [
    "72–10", "72-10", ".878", "87.8%", "88%", "+13.3", "13.3", "13", "about 7 points", "1995–96", "'96", "1996",
    "1995", "19th", "61.8%", ".618", "62%", "z 2.3", "seventy" if False else "72 wins",
])
def test_supported_claims(claim):
    pool = g.Pool.of([CARD])
    nums = [n for n in g.extract(claim)]
    assert nums and all(pool.supports(n) for n in nums), claim


@pytest.mark.parametrize("claim", ["73–9", "72–11", ".879", "57.4%", "+13.4", "14", "1997–98", "1990", "20th", "6.8"])
def test_unsupported_claims(claim):
    pool = g.Pool.of([CARD])
    assert not all(pool.supports(n) for n in g.extract(claim)), claim


def test_textfmt_output_always_matches_itself():
    for value in (0.8780, 0.5, 1.0, 0.0449):
        assert g.Pool.of([fmt.frac3(value)]).supports(g.extract(fmt.pct1(value))[0])
    for value in (13.34, -2.0, 0.04):
        assert g.Pool.of([fmt.signed(value)]).supports(g.extract(fmt.signed(value))[0])
    for season in (1986, 2000, 2026):
        assert g.Pool.of([fmt.season_label(season)]).supports(g.extract(str(season))[0])
    assert g.Pool.of([fmt.record(15, 3)]).supports(g.extract("15–3")[0])


# ---------------------------------------------------------------------------
# The check
# ---------------------------------------------------------------------------

SOURCES = {"F1": CARD, "C1": "Best defensive rating, the 1990s. 1. 1992–93 New York Knicks: 98.9, z -2.8."}


def test_a_grounded_answer_passes():
    answer = "The '96 Bulls went 72–10 [F1]. Their net rating was +13.3, 1st in the league [F1]."
    r = g.check(answer, SOURCES)
    assert r.ok and r.citations == ["F1"] and r.numbers == 4


def test_a_number_must_come_from_a_source_its_sentence_cites():
    r = g.check("The 1992–93 Knicks allowed 98.9 points per 100 possessions [F1].", SOURCES)
    assert not r.ok and "isn't in [F1]" in r.problems[0][2]
    assert g.check("The 1992–93 Knicks allowed 98.9 points per 100 possessions [C1].", SOURCES).ok


def test_a_sentence_with_numbers_must_cite():
    r = g.check("The Bulls went 72–10. That is a lot [F1].", SOURCES)
    assert not r.ok and r.problems[0][3] == "uncited"


def test_labels_must_exist():
    r = g.check("The Bulls went 72–10 [F1] [F7].", SOURCES)
    assert not r.ok and r.problems[0][3] == "label"


def test_a_citation_after_the_full_stop_belongs_to_its_sentence():
    assert g.check("The Bulls went 72–10. [F1] They won the title [F1].", SOURCES).ok


def test_grouped_citations_are_read():
    assert g.labels_in("x [F1, C1] y [F2; 3]") == ["F1", "C1", "F2", "F3"]
    assert g.check("The Bulls went 72–10 and the Knicks allowed 98.9 [F1, C1].", SOURCES).ok


def test_question_numbers_and_units_are_exempt():
    q = "Is the 7.3-point margin exact?"
    assert g.check("No: the simulator's 7.3 is an estimate.", SOURCES, question=q).ok
    assert g.check("Net rating is points per 100 possessions, pace per 48 minutes.", SOURCES).ok
    assert g.check("Of the two teams, one was better in the 1990s.", SOURCES).ok


def test_refusals_have_nothing_to_check():
    assert g.check("Sorry, I can't answer that from the site's data.", SOURCES).ok


def test_strip_removes_failed_sentences_and_repairs_bad_labels():
    answer = "The Bulls went 72–10 [F1]. They scored 120 points a game [F1]. Their pace was 91.8 [F1, F9]."
    r = g.check(answer, SOURCES)
    text, removed = g.strip_unsupported(r, SOURCES)
    assert removed == 1
    assert text == "The Bulls went 72–10 [F1]. Their pace was 91.8 [F1]."
    assert "120" in g.feedback(r)
