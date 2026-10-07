"""
test_daily_data.py

F12 Session 1 acceptance tests for scripts/export_daily_data.py (Daily Three:
the matchup pool and player data).

The unit tests run each rule on small synthetic frames. The artifact tests
read the committed frontend/public/data/daily/teams.json and index.json, so
they run without data/raw/. The rebuild test re-runs the export and is
skipped when the gitignored raw files (data/raw/, data/raw/bbref/) are
missing.

Run from repo root:
    python backend/scripts/import_bbref_dataset.py    # once
    python scripts/export_daily_data.py
    python -m pytest tests/test_daily_data.py -v
"""

import json

import numpy as np
import pandas as pd
import pytest

from scripts import export_daily_data as daily

TEAMS_PATH = daily.OUTPUT_PATH
needs_pool = pytest.mark.skipif(not TEAMS_PATH.exists(), reason="daily teams.json not exported")
needs_raw  = pytest.mark.skipif(not (daily.PLAYERS_PATH.exists() and daily.GAMES_PATH.exists()
                                     and daily.TEAM_STATS_PATH.exists() and daily.PEOPLE_PATH.exists()
                                     and daily.BBREF_TOTALS_PATH.exists() and daily.BBREF_ABBREV_PATH.exists()),
                                reason="data/raw/ or data/raw/bbref/ not present")

# Finals winners, 1985-86 to 2024-25 (2025-26 is checked from the data by eye
# in reports/daily_pool.md).
KNOWN_CHAMPIONS = {
    1986: "celtics", 1987: "lakers", 1988: "lakers", 1989: "pistons", 1990: "pistons",
    1991: "bulls", 1992: "bulls", 1993: "bulls", 1994: "rockets", 1995: "rockets",
    1996: "bulls", 1997: "bulls", 1998: "bulls", 1999: "spurs", 2000: "lakers",
    2001: "lakers", 2002: "lakers", 2003: "spurs", 2004: "pistons", 2005: "spurs",
    2006: "heat", 2007: "spurs", 2008: "celtics", 2009: "lakers", 2010: "lakers",
    2011: "mavericks", 2012: "heat", 2013: "heat", 2014: "spurs", 2015: "warriors",
    2016: "cavaliers", 2017: "warriors", 2018: "warriors", 2019: "raptors", 2020: "lakers",
    2021: "bucks", 2022: "warriors", 2023: "nuggets", 2024: "celtics", 2025: "thunder",
}

# The brief's starting-five fixtures, spelled as Basketball-Reference spells
# them ("J.R. Smith").
FIXTURE_FIVES = {
    "1986-celtics":   {"Danny Ainge", "Dennis Johnson", "Larry Bird", "Kevin McHale", "Robert Parish"},
    "1996-bulls":     {"Ron Harper", "Michael Jordan", "Scottie Pippen", "Dennis Rodman", "Luc Longley"},
    "2016-cavaliers": {"Kyrie Irving", "J.R. Smith", "LeBron James", "Kevin Love", "Tristan Thompson"},
    "2017-warriors":  {"Stephen Curry", "Klay Thompson", "Kevin Durant", "Draymond Green", "Zaza Pachulia"},
    "2004-pistons":   {"Chauncey Billups", "Richard Hamilton", "Tayshaun Prince", "Rasheed Wallace", "Ben Wallace"},
}


# ---------------------------------------------------------------------------
# Synthetic fixtures
# ---------------------------------------------------------------------------

def roster(rows) -> pd.DataFrame:
    """player_team_seasons-shaped rows from (personId, games, starts, inferred, top5, minutes)."""
    out = pd.DataFrame(rows, columns=["personId", "games", "starts", "inferred", "top5", "minutes"])
    out["key"], out["season"] = "2000-testers", 2000
    out["firstName"] = ["P" + str(i) for i in out["personId"]]
    out["lastName"] = "Player"
    return out


def stint(season=2000, games=80, **totals) -> pd.Series:
    base = {"season": season, "games": games, "pts": 800, "reb": 0, "ast": 0, "stl": 0, "blk": 0,
            "fgm": 0, "fga": 0, "tpm": 0, "tpa": 0}
    base.update(totals)
    return pd.Series(base)


def league(season=2000, n=100, **columns) -> pd.DataFrame:
    """A qualified league whose stat columns run evenly from 0 to 1 unless given."""
    out = pd.DataFrame({"season": season, "personId": range(n), "qualified": True})
    for label in daily.SIG_STATS:
        out[label] = columns.get(label, np.linspace(0, 1, n))
    return out


def team(wins, losses, made_playoffs=True) -> dict:
    return {"wins": wins, "losses": losses, "win_pct": wins / (wins + losses), "madePlayoffs": made_playoffs}


# ---------------------------------------------------------------------------
# Loading helpers
# ---------------------------------------------------------------------------

def test_parse_minutes_reads_floats_clock_strings_and_blanks():
    out = daily.parse_minutes(pd.Series(["31.5", "12:30", None, "7:04", 40.0], dtype=object))
    assert out.round(3).tolist() == [31.5, 12.5, 0.0, round(7 + 4 / 60, 3), 40.0]


def test_short_name_keeps_suffixes_and_accents():
    assert daily.short_name({"firstName": "Michael", "lastName": "Jordan"}) == "M. Jordan"
    assert daily.short_name({"firstName": "Gary", "lastName": "Payton II"}) == "G. Payton II"
    assert daily.short_name({"firstName": "Nikola", "lastName": "Jokić"}) == "N. Jokić"
    assert daily.short_name({"firstName": "", "lastName": "Nenê"}) == "Nenê"


# ---------------------------------------------------------------------------
# Champions
# ---------------------------------------------------------------------------

def test_champions_use_the_last_playoff_game_and_keep_the_bubble_finals_in_2020():
    index = pd.DataFrame({"key": ["2020-lakers", "2020-heat", "2021-bucks", "2021-suns"],
                          "season": [2020, 2020, 2021, 2021], "franchiseId": [1, 2, 3, 4]})
    games = pd.DataFrame({
        "gameId":          [41900401, 41900406, 42000406, 22000001],
        "gameDateTimeEst": ["2020-09-30 21:00:00", "2020-10-11 19:30:00", "2021-07-20 21:00:00", "2021-07-21 21:00:00"],
        "gameType":        ["Playoffs", "Playoffs", "Playoffs", "Regular Season"],
        "winner":          [2, 1, 3, 4],
    })
    assert daily.derive_champions(games, index) == {2020: "2020-lakers", 2021: "2021-bucks"}


def test_champions_raise_when_a_season_has_no_playoffs():
    index = pd.DataFrame({"key": ["2020-lakers", "2021-bucks"], "season": [2020, 2021], "franchiseId": [1, 3]})
    games = pd.DataFrame({"gameId": [41900406], "gameDateTimeEst": ["2020-10-11 19:30:00"],
                          "gameType": ["Playoffs"], "winner": [1]})
    with pytest.raises(ValueError, match="No playoff games"):
        daily.derive_champions(games, index)


# ---------------------------------------------------------------------------
# Starting fives
# ---------------------------------------------------------------------------

def test_flag_five_is_most_starts_with_minutes_breaking_ties():
    r = roster([(1, 80, 80, 0, 0, 2800), (2, 80, 78, 0, 0, 2500), (3, 80, 70, 0, 0, 2400),
                (4, 80, 60, 0, 0, 2300), (5, 80, 50, 0, 0, 1500), (6, 80, 50, 0, 0, 1900),
                (7, 80, 2, 0, 0, 2600)])
    five = daily.pick_five(r, daily.CHECK_FLAG, games=82)
    assert set(five["ids"]) == {1, 2, 3, 4, 6}
    assert five["sixth"] == 5 and five["gap"] == 0


def test_proxy_five_takes_the_heavy_minute_sixth_man_over_a_low_minute_starter():
    # The proxy's known weakness (1995-96 Kukoc): ranked by games in the team's top 5 for minutes.
    r = roster([(1, 82, 0, 0, 80, 3000), (2, 82, 0, 0, 78, 2900), (3, 82, 0, 0, 75, 2700),
                (4, 82, 0, 0, 60, 2300), (5, 82, 0, 0, 30, 1600), (6, 82, 0, 0, 55, 2100)])
    five = daily.pick_five(r, daily.CHECK_PROXY, games=82)
    assert 6 in five["ids"] and 5 not in five["ids"]
    assert five["method"] == daily.CHECK_PROXY


def test_five_needs_min_team_games_and_raises_without_five_eligible():
    r = roster([(1, 82, 82, 0, 0, 3000), (2, 82, 82, 0, 0, 2900), (3, 82, 82, 0, 0, 2700),
                (4, 82, 82, 0, 0, 2300), (5, daily.MIN_TEAM_GAMES - 1, 19, 0, 0, 700), (6, 60, 10, 0, 0, 1000)])
    assert 5 not in daily.pick_five(r, daily.CHECK_FLAG, games=82)["ids"]
    with pytest.raises(ValueError, match="Fewer than 5"):
        daily.pick_five(r[r["personId"] != 6], daily.CHECK_FLAG, games=82)


def test_infer_starters_finds_the_subset_that_scores_team_minus_bench():
    points  = np.array([30, 20, 10, 8, 6, 12, 4], dtype=float)
    minutes = np.array([40, 38, 30, 28, 26, 30, 10], dtype=float)
    # Starters scored 74: {30, 20, 10, 8, 6}. {30, 20, 12, 8, 4} also sums to 74 with fewer minutes.
    best = daily.infer_starters(points, minutes, target=74.0)
    assert sorted(best.tolist()) == [0, 1, 2, 3, 4]


def test_infer_starters_prefers_usual_starters_before_minutes_and_gives_none_without_a_match():
    points  = np.array([30, 20, 10, 8, 6, 12, 4], dtype=float)
    minutes = np.array([40, 38, 30, 28, 26, 30, 10], dtype=float)
    prior   = np.array([1, 1, 0.2, 1, 0.1, 0.9, 0.9])
    assert sorted(daily.infer_starters(points, minutes, 74.0, prior).tolist()) == [0, 1, 3, 5, 6]
    assert daily.infer_starters(points, minutes, 1000.0) is None
    assert daily.infer_starters(points[:4], minutes[:4], 68.0) is None
    assert daily.infer_starters(points, minutes, float("nan")) is None


def test_season_methods_prefer_flag_then_bench_then_proxy():
    flags = {2000: 0.0, 2010: 0.0, 2020: 1.0, 2022: 0.0}
    bench = {2000: 0.02, 2010: 1.0, 2020: 1.0, 2022: 0.0}
    assert daily.season_methods(flags, bench) == {
        2000: daily.CHECK_PROXY, 2010: daily.CHECK_BENCH, 2020: daily.CHECK_FLAG, 2022: daily.CHECK_PROXY}


# ---------------------------------------------------------------------------
# Games started (Basketball-Reference)
# ---------------------------------------------------------------------------

def bbref(rows, season=2000, team="TST") -> pd.DataFrame:
    """Basketball-Reference-shaped rows from (player_id, player, g, gs, mp)."""
    out = pd.DataFrame(rows, columns=["player_id", "player", "g", "gs", "mp"])
    out["season"], out["team"] = season, team
    return out


def test_gs_five_is_most_games_started_with_minutes_breaking_ties():
    rows = bbref([("a", "A", 82, 82, 3000), ("b", "B", 82, 80, 2900), ("c", "C", 82, 75, 2500),
                  ("d", "D", 82, 60, 2000), ("e", "E", 82, 40, 1500), ("f", "F", 82, 40, 1900),
                  ("g", "G", 82, 2, 2600)])
    five = daily.pick_gs_five(rows, games=82)
    assert five["player_ids"] == ["a", "b", "c", "d", "f"]
    assert five["fifth"] == ("f", "F", 40) and five["sixth"] == ("e", "E", 40) and five["gap"] == 0


def test_gs_five_needs_min_team_games_and_raises_without_five_eligible():
    rows = bbref([("a", "A", 82, 82, 3000), ("b", "B", 82, 82, 2900), ("c", "C", 82, 82, 2700),
                  ("d", "D", 82, 82, 2300), ("e", "E", daily.MIN_TEAM_GAMES - 1, 19, 700), ("f", "F", 60, 10, 1000)])
    five = daily.pick_gs_five(rows, games=82)
    assert "e" not in five["player_ids"] and five["sixth"] is None
    assert round(five["gap"], 3) == round(10 / 82, 3)
    with pytest.raises(ValueError, match="Fewer than 5"):
        daily.pick_gs_five(rows[rows["player_id"] != "f"], games=82)


def test_bbref_totals_keep_per_team_rows_and_drop_multi_team_totals(tmp_path):
    path = tmp_path / "Player Totals.csv"
    pd.DataFrame({
        "season":    [1998, 1998, 1998, 1998, 1998, 1997],
        "lg":        ["NBA", "NBA", "NBA", "NBA", "ABA", "NBA"],
        "player":    ["Ron Harper", "Rasheed Wallace", "Rasheed Wallace", "Rasheed Wallace", "Someone", "Ron Harper"],
        "player_id": ["harpero01", "wallara01", "wallara01", "wallara01", "someo01", "harpero01"],
        "team":      ["CHI", "2TM", "POR", "DET", "XXX", "CHI"],
        "g": [82, 68, 46, 22, 10, 76], "gs": [82, 66, 45, 21, 0, 74], "mp": [2000, 2500, 1700, 800, 100, 2000],
    }).to_csv(path, index=False, encoding="utf-8")
    out = daily.load_bbref_totals([1998], path)
    assert sorted(zip(out["player_id"], out["team"])) == [("harpero01", "CHI"), ("wallara01", "DET"), ("wallara01", "POR")]
    with pytest.raises(ValueError, match="no rows for seasons"):
        daily.load_bbref_totals([1998, 1999], path)


def test_normalize_name_drops_accents_punctuation_and_suffixes():
    assert daily.normalize_name("J.R. Smith") == daily.normalize_name("JR Smith") == "jr smith"
    assert daily.normalize_name("Toni Kukoč") == daily.normalize_name("Toni Kukoc") == "toni kukoc"
    assert daily.normalize_name("Ömer Aşık") == "omer asik"
    assert daily.normalize_name("Egor Dёmin") == "egor demin"
    assert daily.normalize_name("Pétur Guðmundsson") == "petur gudmundsson"
    assert daily.normalize_name("Marcus Morris Sr.") == daily.normalize_name("Marcus Morris") == "marcus morris"
    assert daily.normalize_name("Shai Gilgeous-Alexander") == "shai gilgeous alexander"
    assert daily.normalize_name("Amar'e Stoudemire") == "amare stoudemire"


def test_name_aliases_are_normalized_on_both_sides():
    for bbref_name, ours in daily.NAME_ALIASES.items():
        assert daily.normalize_name(bbref_name) == bbref_name and daily.normalize_name(ours) == ours
        assert bbref_name != ours


def test_split_name_takes_the_first_word_as_the_first_name():
    assert daily.split_name("J.R. Smith") == ("J.R.", "Smith")
    assert daily.split_name("Nick Van Exel") == ("Nick", "Van Exel")
    assert daily.split_name("Nenê") == ("", "Nenê")
    assert daily.short_name(dict(zip(("firstName", "lastName"), daily.split_name("Gary Payton II")))) == "G. Payton II"


def ours(rows) -> pd.DataFrame:
    """player_team_seasons-shaped rows from (personId, firstName, lastName, games)."""
    return pd.DataFrame(rows, columns=["personId", "firstName", "lastName", "games"])


def test_match_players_by_name_then_alias_then_games():
    rows = bbref([("smithjr01", "J.R. Smith", 77, 77, 2500), ("hilarne01", "Nenê", 70, 70, 2000),
                  ("kukocto01", "Toni Kukoč", 80, 20, 2100), ("jonesch01", "Charles Jones", 53, 45, 1154),
                  ("jonesch02", "Charles Jones", 43, 0, 516), ("ghost01", "Nobody Here", 30, 0, 300)])
    roster = ours([(1, "JR", "Smith", 77), (2, "Nene", "Hilario", 70), (3, "Toni", "Kukoc", 80),
                   (4, "Charles", "Jones", 53), (5, "Charles", "Jones", 43)])
    matched = daily.match_players(rows, roster)
    assert matched.drop("ghost01").to_dict() == {
        "smithjr01": 1, "hilarne01": 2, "kukocto01": 3, "jonesch01": 4, "jonesch02": 5}
    assert np.isnan(matched["ghost01"])


def test_match_players_leaves_ambiguous_and_doubly_claimed_players_unmatched():
    # Two of ours share a name and neither games count fits; two Basketball-Reference rows claim one player.
    rows = bbref([("a1", "Sam Same", 50, 40, 1500), ("b1", "Steve Smith", 60, 60, 2000), ("b2", "Steven Smith", 60, 0, 300)])
    roster = ours([(1, "Sam", "Same", 30), (2, "Sam", "Same", 20), (3, "Steven", "Smith", 60)])
    matched = daily.match_players(rows, roster)
    assert matched.isna().all()


def test_gs_roster_uses_bbref_spelling_and_games_started():
    rows = bbref([("kukocto01", "Toni Kukoč", 80, 20, 2100), ("smithjr01", "J.R. Smith", 77, 77, 2500)])
    roster = ours([(3, "Toni", "Kukoc", 80), (1, "JR", "Smith", 77), (9, "Not", "Matched", 25)])
    out = daily.gs_roster(roster, rows, daily.match_players(rows, roster)).set_index("personId")
    assert [daily.full_name(out.loc[i]) for i in (3, 1, 9)] == ["Toni Kukoč", "J.R. Smith", "Not Matched"]
    assert out.loc[3, "gs"] == 20 and out.loc[1, "gs"] == 77 and np.isnan(out.loc[9, "gs"])


def test_team_abbreviations_by_city_and_name_then_nickname():
    index = pd.DataFrame({"key": ["2006-hornets", "1986-bullets", "2026-clippers"], "season": [2006, 1986, 2026],
                          "city": ["Oklahoma City", "Washington", "LA"], "name": ["Hornets", "Bullets", "Clippers"]})
    abbrevs = pd.DataFrame({
        "season": [2006, 2006, 1986, 1986, 2026, 2026],
        "team": ["New Orleans/Oklahoma City Hornets", "Charlotte Bobcats", "Washington Bullets", "Los Angeles Lakers",
                 "Los Angeles Clippers", "Los Angeles Lakers"],
        "abbreviation": ["NOK", "CHA", "WSB", "LAL", "LAC", "LAL"],
    })
    assert daily.team_abbreviations(index, abbrevs).to_dict() == {
        "2006-hornets": "NOK", "1986-bullets": "WSB", "2026-clippers": "LAC"}


def test_team_abbreviations_raise_on_no_or_several_matches():
    index = pd.DataFrame({"key": ["2000-ghosts"], "season": [2000], "city": ["Nowhere"], "name": ["Ghosts"]})
    abbrevs = pd.DataFrame({"season": [2000], "team": ["Boston Celtics"], "abbreviation": ["BOS"]})
    with pytest.raises(ValueError, match="exactly one"):
        daily.team_abbreviations(index, abbrevs)
    two = pd.DataFrame({"season": [2000, 2000], "team": ["North Ghosts", "South Ghosts"], "abbreviation": ["NGH", "SGH"]})
    with pytest.raises(ValueError, match="exactly one"):
        daily.team_abbreviations(index, two)


def test_override_five_resolves_names_and_rejects_strangers():
    r = roster([(i, 80, 80, 0, 0, 2000) for i in range(1, 7)])
    names = ["P1 Player", "P2 Player", "P3 Player", "P4 Player", "P6 Player"]
    assert daily.override_five(r, names, "2000-testers")["ids"] == [1, 2, 3, 4, 6]
    with pytest.raises(ValueError, match="did not play"):
        daily.override_five(r, names[:4] + ["Someone Else"], "2000-testers")


# ---------------------------------------------------------------------------
# Signature stats
# ---------------------------------------------------------------------------

def test_signature_stats_take_the_top_two_at_or_above_the_80th_percentile():
    lg = league(RPG=np.linspace(0, 10, 100), BPG=np.linspace(0, 2, 100), APG=np.linspace(0, 8, 100))
    p = stint(reb=12 * 80, blk=1.9 * 80, ast=7 * 80)   # RPG above all, BPG 97th, APG 88th
    sig = daily.signature_stats(p, lg)
    assert [s["stat"] for s in sig] == ["RPG", "BPG"]
    assert sig[0]["value"] == 12.0 and sig[1]["value"] == 1.9


def test_signature_stats_fall_back_to_the_best_single_stat():
    lg = league(RPG=np.linspace(0, 10, 100), APG=np.linspace(0, 10, 100))
    sig = daily.signature_stats(stint(reb=5 * 80, ast=6 * 80), lg)
    assert len(sig) == 1 and sig[0]["stat"] == "APG" and sig[0]["pctile"] < daily.SIG_PERCENTILE


def test_shooting_percentages_need_their_attempt_floors():
    lg = league(**{"FG%": np.linspace(0.35, 0.55, 100), "3P%": np.linspace(0.25, 0.42, 100),
                   "3PM": np.linspace(0, 5, 100)})
    few = stint(fgm=4.5 * 80 * 0.6, fga=4.5 * 80, tpm=1.5 * 80 * 0.5, tpa=1.5 * 80)    # 60% and 50%, too few shots
    assert not {"FG%", "3P%"} & {s["stat"] for s in daily.signature_stats(few, lg)}
    many = stint(fgm=10 * 80 * 0.6, fga=10 * 80, tpm=3 * 80 * 0.5, tpa=3 * 80)
    sig = daily.signature_stats(many, lg)
    assert {s["stat"] for s in sig} == {"FG%", "3P%"}
    assert all(len(str(s["value"]).split(".")[1]) <= 3 for s in sig)


def test_percentile_counts_ties_as_half():
    ref = np.array([1.0, 2.0, 2.0, 3.0, np.nan])
    assert daily.percentile_of(2.0, ref) == 0.5
    assert daily.percentile_of(4.0, ref) == 1.0
    assert np.isnan(daily.percentile_of(np.nan, ref))


# ---------------------------------------------------------------------------
# Pool rules
# ---------------------------------------------------------------------------

def test_tiers_follow_win_pct_not_raw_wins():
    # 1998-99 Spurs: 37-13 is .740, a high-win team despite 37 wins; a champion is always marquee.
    assert daily.classify(team(37, 13), champion=False, has_star=False) == (daily.TIER_KNOWN, [daily.REASON_HIGH])
    assert daily.classify(team(37, 13), champion=True, has_star=False)[0] == daily.TIER_MARQUEE
    assert daily.classify(team(62, 20), champion=False, has_star=False) == (daily.TIER_MARQUEE, [daily.REASON_VERY_HIGH])
    assert daily.classify(team(55, 27), champion=False, has_star=False) == (None, [])


def test_star_rule_needs_a_playoff_team_at_the_win_floor():
    assert daily.classify(team(46, 36), champion=False, has_star=True) == (daily.TIER_KNOWN, [daily.REASON_STAR])
    assert daily.classify(team(44, 38), champion=False, has_star=True)[0] is None
    assert daily.classify(team(50, 32, made_playoffs=False), champion=False, has_star=True)[0] is None


def test_star_reasons_use_league_ranks():
    lg = pd.DataFrame({"season": 2000, "personId": range(10), "qualified": True,
                       "ppg": np.arange(10, 0, -1, dtype=float), "RPG": np.arange(10, dtype=float),
                       "APG": [0, 0, 0, 9, 8, 7, 0, 0, 0, 0]})
    leaders = daily.league_leaders(lg)
    assert daily.star_reasons([0, 9], 2000, leaders) == [(0, ["PPG #1"]), (9, ["RPG #1"])]
    assert daily.star_reasons([5], 2000, leaders) == [(5, ["APG #3"])]
    assert daily.star_reasons([6], 2000, leaders) == []


def test_overrides_exclude_then_pin():
    ov = {"pins": {"a": daily.TIER_MARQUEE}, "exclude": ["b"], "starters": {}}
    assert daily.apply_overrides(None, [], "a", ov) == (daily.TIER_MARQUEE, [daily.REASON_PIN])
    assert daily.apply_overrides(daily.TIER_KNOWN, [daily.REASON_HIGH], "b", ov)[0] is None
    assert daily.apply_overrides(daily.TIER_KNOWN, [daily.REASON_HIGH], "c", ov) == (daily.TIER_KNOWN, [daily.REASON_HIGH])


def test_committed_overrides_file_is_valid():
    ov = daily.load_overrides()
    assert set(ov) == {"pins", "exclude", "starters"}
    for key, entry in ov["starters"].items():
        assert len(set(entry["players"])) == 5 and entry.get("note"), key


# ---------------------------------------------------------------------------
# The exported pool
# ---------------------------------------------------------------------------

def _reject_duplicates(pairs):
    keys = [k for k, _ in pairs]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        raise ValueError("duplicate keys: " + str(sorted(dupes)))
    return dict(pairs)


@pytest.fixture(scope="module")
def pool():
    with open(TEAMS_PATH, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=_reject_duplicates)


@pytest.fixture(scope="module")
def index():
    return daily.load_index().set_index("key")


@needs_pool
def test_pool_keys_are_unique_and_all_in_index(pool, index):
    assert pool["teams"]
    assert set(pool["teams"]) <= set(index.index)
    with open(daily.INDEX_PATH, encoding="utf-8") as f:
        assert pool["release"] == json.load(f)["release"]


@needs_pool
def test_every_pool_team_follows_the_rules(pool, index):
    champions = set(pool["champions"].values())
    for key, t in pool["teams"].items():
        row = index.loc[key]
        win_pct = row["wins"] / (row["wins"] + row["losses"])
        assert (t["wins"], t["losses"]) == (row["wins"], row["losses"]), key
        assert t["tier"] in daily.TIERS, key
        assert t["reasons"], key
        assert (daily.REASON_CHAMPION in t["reasons"]) == (key in champions), key
        assert (daily.REASON_VERY_HIGH in t["reasons"]) == (win_pct >= daily.MARQUEE_WIN_PCT), key
        assert (daily.REASON_HIGH in t["reasons"]) == (daily.POOL_WIN_PCT <= win_pct < daily.MARQUEE_WIN_PCT), key
        if daily.REASON_STAR in t["reasons"]:
            assert row["madePlayoffs"] and win_pct >= daily.STAR_TEAM_WIN_PCT, key
        if daily.REASON_PIN not in t["reasons"]:
            marquee = bool({daily.REASON_CHAMPION, daily.REASON_VERY_HIGH} & set(t["reasons"]))
            assert t["tier"] == (daily.TIER_MARQUEE if marquee else daily.TIER_KNOWN), key
        assert t["fiveFrom"] in daily.FIVE_FROM, key
        for field in ("pace", "offRating", "defRating"):
            assert t[field] == row[field], key
        assert t["benchPpg"] >= 0 and 0 < t.get("threeRate", 0.1) < 1, key


@needs_pool
def test_every_high_win_team_is_in_the_pool(pool, index):
    excluded = set(daily.load_overrides()["exclude"])
    high = index[index["wins"] / (index["wins"] + index["losses"]) >= daily.POOL_WIN_PCT].index
    assert set(high) - excluded <= set(pool["teams"])


@needs_pool
def test_champions_match_the_record(pool):
    champions = {int(s): k for s, k in pool["champions"].items()}
    assert set(champions) == set(range(1986, 2027))
    for season, nickname in KNOWN_CHAMPIONS.items():
        assert champions[season] == str(season) + "-" + nickname
    for key in champions.values():
        assert pool["teams"][key]["tier"] == daily.TIER_MARQUEE


@needs_pool
@pytest.mark.parametrize("key,five", sorted(FIXTURE_FIVES.items()))
def test_starting_five_fixtures(pool, key, five):
    assert {s["name"] for s in pool["teams"][key]["starters"]} == five


@needs_pool
@pytest.mark.parametrize("key,name", [
    ("1998-bulls",     "Toni Kukoč"),
    ("2005-spurs",     "Manu Ginóbili"),
    ("2023-nuggets",   "Nikola Jokić"),
    ("2016-cavaliers", "J.R. Smith"),
])
def test_names_keep_basketball_reference_spelling(pool, key, name):
    starter = next(s for s in pool["teams"][key]["starters"] if s["name"] == name)
    assert starter["short"] == name[0] + ". " + name.split(" ", 1)[1]


@needs_pool
def test_every_five_is_games_started_or_an_override(pool):
    overrides = daily.load_overrides()["starters"]
    for key, t in pool["teams"].items():
        assert t["fiveFrom"] == (daily.METHOD_OVERRIDE if key in overrides else daily.METHOD_GS), key


@needs_pool
def test_starters_carry_ppg_and_one_or_two_signature_stats(pool):
    labels = set(daily.SIG_STATS)
    for key, t in pool["teams"].items():
        assert len(t["starters"]) == 5 and len({s["name"] for s in t["starters"]}) == 5, key
        for s in t["starters"]:
            assert set(s) == {"name", "short", "ppg", "sig"}, key
            assert s["name"].strip() == s["name"] and s["short"], key
            assert 0 < s["ppg"] < 45, key + " " + s["name"]
            assert 1 <= len(s["sig"]) <= daily.SIG_MAX, key + " " + s["name"]
            assert len({x["stat"] for x in s["sig"]}) == len(s["sig"])
            for x in s["sig"]:
                assert x["stat"] in labels
                if x["stat"] in daily.PCT_SIG_STATS:
                    assert 0 < x["value"] < 1
                else:
                    assert x["value"] >= 0 and round(x["value"], 1) == x["value"]


@needs_pool
@pytest.mark.parametrize("key,name,expected", [
    ("2000-lakers",   "Shaquille O'Neal", {"RPG"}),
    ("2016-warriors", "Stephen Curry",    {"3PM"}),
    ("2017-warriors", "Stephen Curry",    {"3PM"}),
    ("1996-bulls",    "Dennis Rodman",    {"RPG"}),
    ("1996-bulls",    "Michael Jordan",   {"SPG"}),
])
def test_expected_signature_stats(pool, key, name, expected):
    starter = next(s for s in pool["teams"][key]["starters"] if s["name"] == name)
    stats = {x["stat"] for x in starter["sig"]}
    assert expected <= stats
    if name == "Shaquille O'Neal":
        assert stats - {"RPG"} <= {"BPG", "FG%"}


@needs_pool
def test_pool_never_carries_a_probability_or_margin(pool):
    text = json.dumps(pool).lower()
    for word in ("probab", "margin", "neutral"):
        assert word not in text


@needs_raw
@needs_pool
def test_rebuild_matches_the_committed_pool(tmp_path, monkeypatch, pool):
    out = tmp_path / "teams.json"
    monkeypatch.setattr(daily, "OUTPUT_PATH", out)
    monkeypatch.setattr(daily, "REPORT_PATH", tmp_path / "daily_pool.md")
    daily.main()
    with open(out, encoding="utf-8") as f:
        rebuilt = json.load(f)
    assert {k: v for k, v in rebuilt.items() if k != "generated"} == {k: v for k, v in pool.items() if k != "generated"}
