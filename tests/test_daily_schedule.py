"""
test_daily_schedule.py

F12 Session 2 tests for scripts/build_daily_schedule.py and
scripts/verify_daily_data.py (Daily Three: the schedule).

They read the committed pool and team files, and build into temporary
folders, so they never touch the committed schedule.

Run from repo root:
    python -m pytest tests/test_daily_schedule.py -v
"""

import json
import shutil
from datetime import date, timedelta

import pytest

from scripts import build_daily_schedule as build
from scripts import verify_daily_data as verify

COMMITTED  = build.DAILY_DIR
SMALL_DAYS = 120
needs_schedule = pytest.mark.skipif(not (COMMITTED / "meta.json").exists(), reason="schedule not built")


def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write(path, value):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def build_into(out, *args):
    build.main(["--out", str(out), *args])
    shutil.copyfile(build.POOL_PATH, out / "teams.json")   # the verifier reads the pool next to the schedule
    return out


@pytest.fixture(scope="module")
def small(tmp_path_factory):
    """A 120-day pre-launch schedule from the placeholder launch date."""
    return build_into(tmp_path_factory.mktemp("small"), "--days", str(SMALL_DAYS))


def errors_for(daily_dir, today=date(2026, 10, 7)):
    errors, _ = verify.check_schedule(daily_dir, today)
    return errors


def tampered(src, tmp_path):
    dst = tmp_path / "daily"
    shutil.copytree(src, dst)
    return dst


# ---------------------------------------------------------------------------
# The committed schedule
# ---------------------------------------------------------------------------

@needs_schedule
def test_committed_schedule_passes_every_rule():
    errors, summary = verify.check_schedule(COMMITTED, date.today())
    assert errors == []
    assert summary["days"] >= 365 - 1
    assert summary["teamsUsed"] == summary["poolTeams"]


@needs_schedule
def test_committed_schedule_is_a_byte_identical_rebuild(tmp_path):
    meta = read(COMMITTED / "meta.json")
    assert meta["launched"] is False
    out = tmp_path / "rebuild"
    build.main(["--out", str(out), "--days", str(meta["lastDay"]), "--launch-date", meta["launchDate"]])
    # Line endings aside: git's autocrlf may check the committed files out with CRLF.
    for name in ["meta.json"] + ["days/" + str(n) + ".json" for n in range(1, meta["lastDay"] + 1)]:
        committed = (COMMITTED / name).read_bytes().replace(b"\r\n", b"\n")
        assert (out / name).read_bytes() == committed, name
    assert len(list((COMMITTED / "days").glob("*.json"))) == meta["lastDay"]


# ---------------------------------------------------------------------------
# The builder
# ---------------------------------------------------------------------------

def test_days_follow_the_rules(small):
    meta = read(small / "meta.json")
    assert meta == {"launchDate": build.PLACEHOLDER_LAUNCH_DATE, "lastDay": SMALL_DAYS, "engine": "sim-v1", "launched": False}
    assert errors_for(small) == []
    pool = read(small / "teams.json")["teams"]
    day = read(small / "days" / "1.json")
    assert [g["featured"] for g in day["games"]] == [False, False, True]
    assert all(pool[day["games"][2][k]]["tier"] == "marquee" for k in ("a", "b"))


def test_extending_keeps_earlier_days(small, tmp_path):
    longer = build_into(tmp_path / "longer", "--days", str(SMALL_DAYS + 20))
    for n in range(1, SMALL_DAYS + 1):
        assert (longer / "days" / (str(n) + ".json")).read_bytes() == (small / "days" / (str(n) + ".json")).read_bytes()
    assert errors_for(longer) == []


def test_shrinking_removes_later_day_files(tmp_path):
    out = build_into(tmp_path / "s", "--days", "20")
    build.main(["--out", str(out), "--days", "10"])
    assert sorted(int(p.stem) for p in (out / "days").glob("*.json")) == list(range(1, 11))


def test_a_different_seed_gives_a_different_schedule(small, tmp_path):
    other = build_into(tmp_path / "other", "--days", str(SMALL_DAYS), "--seed", "7")
    assert errors_for(other) == []
    assert read(other / "days" / "1.json") != read(small / "days" / "1.json")


def test_released_days_are_frozen_after_launch(tmp_path):
    out = build_into(tmp_path / "live", "--days", "30", "--launch", "--launch-date", "2026-10-01", "--today", "2026-09-30")
    assert read(out / "meta.json")["launched"] is True
    # Edit a released day by hand: a rebuild must keep it exactly as stored.
    day3 = read(out / "days" / "3.json")
    day3["games"][0], day3["games"][1] = day3["games"][1], day3["games"][0]
    write(out / "days" / "3.json", day3)
    before = {n: (out / "days" / (str(n) + ".json")).read_bytes() for n in range(1, 31)}

    # On 2026-10-05, days dated before 2026-10-07 (days 1-6) are released.
    build.main(["--out", str(out), "--days", "30", "--seed", "99", "--today", "2026-10-05"])
    after = {n: (out / "days" / (str(n) + ".json")).read_bytes() for n in range(1, 31)}
    assert all(after[n] == before[n] for n in range(1, 7))
    assert any(after[n] != before[n] for n in range(7, 31))


def test_a_launched_schedule_keeps_its_launch_date(tmp_path):
    out = build_into(tmp_path / "live", "--days", "10", "--launch", "--launch-date", "2026-10-01", "--today", "2026-09-30")
    with pytest.raises(ValueError, match="launch date cannot change"):
        build.main(["--out", str(out), "--launch-date", "2026-11-01", "--days", "10", "--today", "2026-10-05"])
    with pytest.raises(ValueError, match="released"):
        build.main(["--out", str(out), "--days", "3", "--today", "2026-10-05"])


def test_before_launch_every_day_may_be_regenerated(tmp_path):
    out = build_into(tmp_path / "pre", "--days", "10", "--launch-date", "2026-10-01")
    build.main(["--out", str(out), "--days", "10", "--launch-date", "2026-11-01", "--today", "2026-10-20"])
    assert read(out / "days" / "1.json")["date"] == "2026-11-01"


def test_canonical_order_matches_slug_ts():
    assert build.canonical_order("2017-warriors", 2017, "1996-bulls", 1996) == ("1996-bulls", "2017-warriors")
    assert build.canonical_order("1996-bulls", 1996, "1996-sonics", 1996) == ("1996-bulls", "1996-sonics")
    assert build.canonical_order("1996-sonics", 1996, "1996-bulls", 1996) == ("1996-bulls", "1996-sonics")


def test_forgiving_band_is_symmetric():
    assert build.in_band(0.55) and build.in_band(0.70) and build.in_band(0.31) and build.in_band(0.45)
    assert not build.in_band(0.54) and not build.in_band(0.71) and not build.in_band(0.5) and not build.in_band(0.2)


# ---------------------------------------------------------------------------
# The verifier catches each broken rule
# ---------------------------------------------------------------------------

def edit_day(daily_dir, n, change):
    path = daily_dir / "days" / (str(n) + ".json")
    day = read(path)
    change(day)
    write(path, day)


def assert_fails(daily_dir, pattern, today=date(2026, 10, 7)):
    errors = errors_for(daily_dir, today)
    assert any(pattern in e for e in errors), errors


def test_verifier_catches_a_repeated_pairing(small, tmp_path):
    d = tampered(small, tmp_path)
    first = read(d / "days" / "1.json")["games"][0]
    edit_day(d, 20, lambda day: day["games"].__setitem__(0, dict(first)))
    assert_fails(d, "already played on day 1")


def test_verifier_catches_a_team_twice_in_seven_days(small, tmp_path):
    d = tampered(small, tmp_path)
    day1 = read(d / "days" / "1.json")["games"]
    edit_day(d, 7, lambda day: day["games"].__setitem__(2, dict(day1[2])))
    assert_fails(d, "within 7 days")


def test_verifier_catches_a_featured_game_that_is_not_marquee(small, tmp_path):
    d = tampered(small, tmp_path)
    pool = read(d / "teams.json")["teams"]
    for n in range(1, SMALL_DAYS + 1):
        games = read(d / "days" / (str(n) + ".json"))["games"]
        if any(pool[games[0][k]]["tier"] != "marquee" for k in ("a", "b")):
            break
    def swap(day):
        g0, g2 = day["games"][0], day["games"][2]
        g0["featured"], g2["featured"] = True, False
        day["games"][0], day["games"][2] = g2, g0
    edit_day(d, n, swap)
    assert_fails(d, "must be marquee vs marquee")


def test_verifier_catches_a_favourite_outside_the_band_and_a_wrong_p(small, tmp_path):
    d = tampered(small, tmp_path)
    edit_day(d, 4, lambda day: day["games"][1].update(p=0.9))
    assert_fails(d, "outside FORGIVING_BAND")
    assert_fails(d, "differ from teams/")


def test_verifier_catches_p_or_m_that_drift_from_the_team_files(small, tmp_path):
    d = tampered(small, tmp_path)
    edit_day(d, 9, lambda day: day["games"][2].update(m=day["games"][2]["m"] + 0.1))
    assert_fails(d, "differ from teams/")


def test_verifier_skips_p_and_m_on_released_days_after_launch(small, tmp_path):
    d = tampered(small, tmp_path)
    meta = read(d / "meta.json")
    meta["launched"] = True
    write(d / "meta.json", meta)
    edit_day(d, 2, lambda day: day["games"][2].update(m=day["games"][2]["m"] + 0.1))
    assert errors_for(d, today=date(2026, 10, 7)) == []      # day 2 (2026-10-02) is released
    edit_day(d, 30, lambda day: day["games"][2].update(m=day["games"][2]["m"] + 0.1))
    assert_fails(d, "day 30 game 3: p/m")


def test_verifier_catches_order_flags_dates_and_engines(small, tmp_path):
    d = tampered(small, tmp_path)
    def swap_sides(day):
        g = day["games"][1]
        g["a"], g["b"] = g["b"], g["a"]
    edit_day(d, 5, swap_sides)
    edit_day(d, 6, lambda day: day["games"][0].update(featured=True))
    edit_day(d, 8, lambda day: day.update(date="2026-01-01"))
    edit_day(d, 10, lambda day: day.update(engine="sim-v9"))
    edit_day(d, 11, lambda day: day["games"][0].update(a="1996-nobodies"))
    errors = errors_for(d)
    for pattern in ["not in canonical order", "day 6 game 1: featured must be false",
                    "day 8: date", "day 10: unknown engine", "day 11 game 1: key not in index.json"]:
        assert any(pattern in e for e in errors), pattern


def test_no_game_pairs_two_teams_from_the_same_season(small):
    seasons = build.load_seasons()
    for n in range(1, SMALL_DAYS + 1):
        for g in read(small / "days" / (str(n) + ".json"))["games"]:
            assert abs(seasons[g["a"]] - seasons[g["b"]]) >= build.MIN_SEASON_GAP
    pairings = build.load_pairings(build.load_pool().keys(), seasons)
    assert all(seasons[a] != seasons[b] for a, b in pairings)


def test_verifier_catches_a_same_season_game(small, tmp_path):
    d = tampered(small, tmp_path)
    pool = read(d / "teams.json")["teams"]
    seasons = build.load_seasons()
    by_season = {}
    for k in sorted(pool):
        by_season.setdefault(seasons[k], []).append(k)
    a, b = next(keys[:2] for keys in by_season.values() if len(keys) >= 2)
    edit_day(d, 12, lambda day: day["games"][0].update(a=a, b=b))
    assert_fails(d, "season(s) apart")


def test_verifier_catches_missing_and_extra_day_files(small, tmp_path):
    d = tampered(small, tmp_path)
    (d / "days" / "17.json").unlink()
    shutil.copyfile(d / "days" / "1.json", d / "days" / (str(SMALL_DAYS + 1) + ".json"))
    assert_fails(d, "days/17.json: missing")
    assert_fails(d, "days/" + str(SMALL_DAYS + 1) + ".json: not a day")


def test_verifier_fails_when_the_schedule_runs_short(small):
    last = date.fromisoformat(build.PLACEHOLDER_LAUNCH_DATE) + timedelta(days=SMALL_DAYS - 1)
    assert errors_for(small, today=last - timedelta(days=verify.MIN_DAYS_AHEAD)) == []
    assert_fails(small, "extend the schedule", today=last - timedelta(days=verify.MIN_DAYS_AHEAD - 1))


def test_verifier_script_exit_codes(small, tmp_path, capsys):
    assert verify.main(["--daily-dir", str(small), "--today", "2026-10-07"]) == 0
    assert verify.main(["--daily-dir", str(small), "--today", "2027-01-01"]) == 1
    assert "Daily Three schedule" in capsys.readouterr().out
