"""
verify_daily_data.py

Checks the Daily Three schedule (docs/product/features/F12-daily-three.md,
Session 2) over its whole history. Exits non-zero on any failure.

Checks
  meta.json       launchDate is a date, lastDay >= 1, engine is known, launched is a boolean
  day files       exactly days/1.json .. days/<lastDay>.json; each has the right n, date
                  (launchDate + n - 1) and a known engine
  games           three per day; only game 3 is featured; game 3 is marquee vs
                  marquee; games 1-2 have a favourite inside FORGIVING_BAND
  keys            every key is in index.json and in the pool (daily/teams.json);
                  a and b are different and in canonical order (lib/slug.ts)
  pairings        no unordered pairing appears twice in the whole history
  team-seasons    no key appears twice within any WINDOW_DAYS consecutive days
  p and m         match a's team file for every unreleased day (all days before
                  launch; after launch, days dated today + FROZEN_LEAD_DAYS on)
  horizon         lastDay's date is at least MIN_DAYS_AHEAD days after today.
                  Below that it fails, as a reminder to extend the schedule

Reads
  frontend/public/data/daily/meta.json, days/*.json, teams.json
  frontend/public/data/index.json, teams/<a>.json

Run from repo root:
    python scripts/verify_daily_data.py
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_daily_schedule import (  # noqa: E402
    DAILY_DIR,
    FEATURED_INDEX,
    FORGIVING_BAND,
    FROZEN_LEAD_DAYS,
    GAMES_PER_DAY,
    INDEX_PATH,
    TEAMS_DIR,
    TIER_MARQUEE,
    WINDOW_DAYS,
    canonical_order,
    day_date,
    in_band,
    load_seasons,
    read_json,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MIN_DAYS_AHEAD = 60
KNOWN_ENGINES  = ("sim-v1",)
DAY_FILE       = re.compile(r"^[1-9][0-9]*\.json$")


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_schedule(daily_dir: Path, today: date, index_path: Path = INDEX_PATH,
                   teams_dir: Path = TEAMS_DIR) -> tuple[list, dict]:
    """Returns (errors, summary). An empty error list means the schedule passes."""
    errors = []
    meta = read_json(daily_dir / "meta.json")
    seasons = load_seasons(index_path)
    pool = read_json(daily_dir / "teams.json")["teams"]

    launch_date = meta.get("launchDate")
    last_day = meta.get("lastDay")
    try:
        launch = date.fromisoformat(launch_date)
    except (TypeError, ValueError):
        return ["meta.json: launchDate is not a date: " + repr(launch_date)], {}
    if not isinstance(last_day, int) or last_day < 1:
        return ["meta.json: lastDay must be a positive integer: " + repr(last_day)], {}
    if meta.get("engine") not in KNOWN_ENGINES:
        errors.append("meta.json: unknown engine " + repr(meta.get("engine")))
    if not isinstance(meta.get("launched"), bool):
        errors.append("meta.json: launched must be true or false")
    launched = bool(meta.get("launched"))

    days_dir = daily_dir / "days"
    names = sorted(p.name for p in days_dir.glob("*.json"))
    expected = {str(n) + ".json" for n in range(1, last_day + 1)}
    for name in names:
        if not DAY_FILE.match(name) or name not in expected:
            errors.append("days/" + name + ": not a day 1.." + str(last_day))
    for name in sorted(expected - set(names), key=lambda s: int(s.split(".")[0])):
        errors.append("days/" + name + ": missing")
    if errors:
        return errors, {}

    cutoff = today + timedelta(days=FROZEN_LEAD_DAYS)
    team_files = {}
    used_pairs = {}
    last_seen = {}
    checked_pm = 0
    for n in range(1, last_day + 1):
        where = "day " + str(n)
        day = read_json(days_dir / (str(n) + ".json"))
        if day.get("n") != n:
            errors.append(where + ": n is " + repr(day.get("n")))
        if day.get("date") != day_date(launch_date, n):
            errors.append(where + ": date " + repr(day.get("date")) + ", expected " + day_date(launch_date, n))
        if day.get("engine") not in KNOWN_ENGINES:
            errors.append(where + ": unknown engine " + repr(day.get("engine")))
        games = day.get("games")
        if not isinstance(games, list) or len(games) != GAMES_PER_DAY:
            errors.append(where + ": needs exactly " + str(GAMES_PER_DAY) + " games")
            continue
        unreleased = (not launched) or date.fromisoformat(day_date(launch_date, n)) >= cutoff

        for i, g in enumerate(games):
            gw = where + " game " + str(i + 1)
            a, b, p, m = g.get("a"), g.get("b"), g.get("p"), g.get("m")
            if g.get("featured") is not (i == FEATURED_INDEX):
                errors.append(gw + ": featured must be " + str(i == FEATURED_INDEX).lower())
            missing = [k for k in (a, b) if k not in seasons or k not in pool]
            if missing:
                errors.append(gw + ": key not in index.json and the pool: " + ", ".join(map(str, missing)))
                continue
            if a == b:
                errors.append(gw + ": a team cannot play itself (" + a + ")")
                continue
            if (a, b) != canonical_order(a, seasons[a], b, seasons[b]):
                errors.append(gw + ": " + a + " vs " + b + " is not in canonical order")
            if not isinstance(p, (int, float)) or not 0 < p < 1 or not isinstance(m, (int, float)):
                errors.append(gw + ": p must be in (0, 1) and m a number")
                continue

            if i == FEATURED_INDEX:
                if pool[a]["tier"] != TIER_MARQUEE or pool[b]["tier"] != TIER_MARQUEE:
                    errors.append(gw + ": the featured game must be marquee vs marquee")
            elif not in_band(p):
                errors.append(gw + ": favourite " + str(max(p, 1 - p)) + " is outside FORGIVING_BAND "
                              + str(FORGIVING_BAND))

            pair = tuple(sorted((a, b)))
            if pair in used_pairs:
                errors.append(gw + ": pairing " + a + " vs " + b + " already played on day " + str(used_pairs[pair]))
            used_pairs[pair] = n

            for k in (a, b):
                if k in last_seen and n - last_seen[k] < WINDOW_DAYS:
                    errors.append(gw + ": " + k + " also plays on day " + str(last_seen[k])
                                  + " (within " + str(WINDOW_DAYS) + " days)")
                last_seen[k] = n

            if unreleased:
                if a not in team_files:
                    team_files[a] = read_json(teams_dir / (a + ".json"))["opponents"]
                entry = team_files[a].get(b)
                if entry is None or entry["p"] != p or entry["m"] != m:
                    errors.append(gw + ": p/m " + str((p, m)) + " differ from teams/" + a + ".json "
                                  + str(None if entry is None else (entry["p"], entry["m"])))
                checked_pm += 1

    last_date = launch + timedelta(days=last_day - 1)
    ahead = (last_date - today).days
    if ahead < MIN_DAYS_AHEAD:
        errors.append("lastDay " + str(last_day) + " is dated " + last_date.isoformat() + ", only "
                      + str(ahead) + " days after today (" + today.isoformat() + "); extend the schedule to at least "
                      + str(MIN_DAYS_AHEAD) + " days ahead: python scripts/build_daily_schedule.py --days N")

    summary = {
        "days": last_day,
        "lastDate": last_date.isoformat(),
        "daysAhead": ahead,
        "pairings": len(used_pairs),
        "teamsUsed": len(last_seen),
        "poolTeams": len(pool),
        "checkedPm": checked_pm,
        "launched": launched,
    }
    return errors, summary


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Verify the Daily Three schedule.")
    parser.add_argument("--today", help="override today's date, YYYY-MM-DD (tests)")
    parser.add_argument("--daily-dir", type=Path, default=DAILY_DIR)
    args = parser.parse_args(argv)
    today = date.fromisoformat(args.today) if args.today else date.today()

    errors, summary = check_schedule(args.daily_dir, today)
    for line in errors[:50]:
        print("FAIL " + line)
    if len(errors) > 50:
        print("... and " + str(len(errors) - 50) + " more")
    if errors:
        print("Daily Three schedule: " + str(len(errors)) + " problem(s)")
        return 1
    print("Days: " + str(summary["days"]) + " (last " + summary["lastDate"] + ", "
          + str(summary["daysAhead"]) + " days ahead)")
    print("Pairings: " + str(summary["pairings"]) + ", pool teams used: " + str(summary["teamsUsed"])
          + " of " + str(summary["poolTeams"]))
    print("p/m checked against team files: " + str(summary["checkedPm"]) + " games"
          + ("" if summary["launched"] else " (not launched: every day)"))
    print("Daily Three schedule OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
