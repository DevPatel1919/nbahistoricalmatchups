"""
build_daily_schedule.py

Builds the Daily Three schedule (docs/product/features/F12-daily-three.md,
Session 2): one day file per puzzle number, three cross-era matchups each, plus
meta.json.

Schedule rules:
  game 3          featured: marquee vs marquee, no odds constraint
  games 1-2       any pool teams whose favourite's neutral win probability is
                  inside FORGIVING_BAND
  pairings        an unordered pairing never appears twice in the history
  team-seasons    a key appears at most once in any WINDOW_DAYS consecutive
                  days (so never twice on the same day)

a and b are in the site's canonical order (frontend/src/lib/slug.ts: lower
season first, then alphabetical key). p is a's exported neutral win
probability against b and m is a's exported neutral margin, both read from
a's team file.

Choices are seeded per day ("daily-three:<seed>:<n>") and depend only on the
seed, the pool, the team files and the days before, so a rebuild with the
same inputs is byte-identical, and re-running after some days are frozen
reproduces the days after them. Within a day, teams that have appeared least
so far are preferred, so the pool is used evenly.

Released days are frozen. Once meta.json says "launched": true, the builder
keeps every existing day dated before today + FROZEN_LEAD_DAYS (that covers
UTC+14) exactly as stored, refuses to change the launch date, and only
appends or regenerates later days. Before launch (Q4) every day may be
regenerated; Session 5 passes --launch with the real launch date.

Reads
  frontend/public/data/daily/teams.json   the pool: tiers and keys
  frontend/public/data/index.json         seasons (canonical order), keys
  frontend/public/data/teams/<a>.json     p and m for each pairing
  frontend/public/data/daily/meta.json    launch date, launched flag (if present)
  frontend/public/data/daily/days/*.json  existing days (frozen ones are kept)

Writes
  frontend/public/data/daily/meta.json    { launchDate, lastDay, engine, launched }
  frontend/public/data/daily/days/<n>.json  { n, date, engine, games: [{ a, b, p, m, featured }] }

Run from repo root:
    python scripts/build_daily_schedule.py                         # placeholder launch date, DEFAULT_DAYS days
    python scripts/build_daily_schedule.py --days 730              # extend
    python scripts/build_daily_schedule.py --launch-date 2026-11-01 --launch   # Session 5
"""

from __future__ import annotations

import argparse
import json
import random
from datetime import date, timedelta
from pathlib import Path


# ---------------------------------------------------------------------------
# Paths and constants
# ---------------------------------------------------------------------------

REPO_ROOT   = Path(__file__).resolve().parents[1]
DATA_DIR    = REPO_ROOT / "frontend" / "public" / "data"
INDEX_PATH  = DATA_DIR / "index.json"
TEAMS_DIR   = DATA_DIR / "teams"
DAILY_DIR   = DATA_DIR / "daily"
POOL_PATH   = DAILY_DIR / "teams.json"
META_PATH   = DAILY_DIR / "meta.json"
DAYS_DIR    = DAILY_DIR / "days"

PLACEHOLDER_LAUNCH_DATE = "2026-10-01"   # Q4: the real date is set in Session 5
DEFAULT_DAYS            = 365            # about a year at a time
DEFAULT_SEED            = 20261007
ENGINE                  = "sim-v1"

GAMES_PER_DAY     = 3
FEATURED_INDEX    = 2                    # game 3 is the headliner
FORGIVING_BAND    = (0.55, 0.70)         # favourite's neutral win probability, games 1-2
WINDOW_DAYS       = 7                    # a key at most once in any 7 consecutive days
FROZEN_LEAD_DAYS  = 2                    # once launched, days dated before today + 2 are frozen

TIER_MARQUEE = "marquee"


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

def read_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, value) -> None:
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load_seasons(path: Path = INDEX_PATH) -> dict:
    index = read_json(path)
    seasons = {t["key"]: int(t["season"]) for t in index["teams"]}
    if not seasons:
        raise ValueError("index.json lists no teams: " + str(path))
    return seasons


def load_pool(path: Path = POOL_PATH) -> dict:
    pool = read_json(path)["teams"]
    if not pool:
        raise ValueError("The Daily Three pool is empty: " + str(path))
    return {key: team["tier"] for key, team in pool.items()}


def canonical_order(key_a: str, season_a: int, key_b: str, season_b: int):
    """Mirrors canonicalOrder in frontend/src/lib/slug.ts."""
    if season_a != season_b:
        return (key_a, key_b) if season_a < season_b else (key_b, key_a)
    return (key_a, key_b) if key_a <= key_b else (key_b, key_a)


def load_pairings(keys, seasons: dict, teams_dir: Path = TEAMS_DIR) -> dict:
    """{ (a, b): (p, m) } for every unordered pool pairing, a and b canonical."""
    files = {}
    for key in keys:
        if key not in seasons:
            raise ValueError("Pool key missing from index.json: " + key)
        files[key] = read_json(teams_dir / (key + ".json"))["opponents"]
    pairings = {}
    ordered = sorted(keys)
    for i, x in enumerate(ordered):
        for y in ordered[i + 1:]:
            a, b = canonical_order(x, seasons[x], y, seasons[y])
            entry = files[a].get(b)
            if entry is None:
                raise ValueError("No exported result for " + a + " vs " + b)
            pairings[(a, b)] = (float(entry["p"]), float(entry["m"]))
    return pairings


def in_band(p: float, band=FORGIVING_BAND) -> bool:
    favourite = max(p, 1.0 - p)
    return band[0] <= favourite <= band[1]


def day_date(launch_date: str, n: int) -> str:
    return (date.fromisoformat(launch_date) + timedelta(days=n - 1)).isoformat()


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------

class Scheduler:
    """Walks the days in order, keeping the history every rule needs."""

    def __init__(self, tiers: dict, pairings: dict, seed: int):
        self.tiers     = tiers
        self.pairings  = pairings
        self.seed      = seed
        self.used      = set()                    # unordered pairings already scheduled
        self.recent    = []                       # keys per day, newest last
        self.counts    = {key: 0 for key in tiers}
        self.partners  = {key: [] for key in tiers}
        self.band      = {key: [] for key in tiers}
        for (a, b), (p, _m) in sorted(pairings.items()):
            self.partners[a].append(b)
            self.partners[b].append(a)
            if in_band(p):
                self.band[a].append(b)
                self.band[b].append(a)

    def pair_key(self, x: str, y: str):
        return (x, y) if (x, y) in self.pairings else (y, x)

    def blocked(self) -> set:
        """Keys seen in the last WINDOW_DAYS - 1 days."""
        out = set()
        for keys in self.recent[-(WINDOW_DAYS - 1):]:
            out.update(keys)
        return out

    def record(self, games) -> None:
        keys = []
        for g in games:
            self.used.add((g["a"], g["b"]))
            keys += [g["a"], g["b"]]
            self.counts[g["a"]] += 1
            self.counts[g["b"]] += 1
        self.recent.append(keys)

    def least_used_order(self, rng: random.Random, candidates) -> list:
        """Candidates by appearances so far, shuffled within each level."""
        levels = {}
        for k in sorted(candidates):
            levels.setdefault(self.counts[k], []).append(k)
        out = []
        for count in sorted(levels):
            group = levels[count]
            rng.shuffle(group)
            out += group
        return out

    def pick_game(self, rng: random.Random, blocked: set, featured: bool):
        if featured:
            eligible = {k for k, tier in self.tiers.items() if tier == TIER_MARQUEE and k not in blocked}
            links    = self.partners
        else:
            eligible = {k for k in self.tiers if k not in blocked}
            links    = self.band

        def open_partners(k):
            return [x for x in links[k] if x in eligible and self.pair_key(k, x) not in self.used]

        for first in self.least_used_order(rng, eligible):
            options = open_partners(first)
            if options:
                break
        else:
            raise ValueError("No valid " + ("featured" if featured else "forgiving") + " game left")
        second = self.least_used_order(rng, options)[0]
        a, b   = self.pair_key(first, second)
        p, m   = self.pairings[(a, b)]
        return {"a": a, "b": b, "p": p, "m": m, "featured": featured}

    def build_day(self, n: int) -> list:
        rng     = random.Random("daily-three:" + str(self.seed) + ":" + str(n))
        blocked = self.blocked()
        games   = [None] * GAMES_PER_DAY
        # The featured game draws from the smaller marquee tier, so it goes first.
        for i in [FEATURED_INDEX] + [i for i in range(GAMES_PER_DAY) if i != FEATURED_INDEX]:
            game = self.pick_game(rng, blocked, featured=(i == FEATURED_INDEX))
            blocked.update([game["a"], game["b"]])
            games[i] = game
        return games


def day_file(n: int, launch_date: str, games: list) -> dict:
    return {"n": n, "date": day_date(launch_date, n), "engine": ENGINE, "games": games}


def frozen_days(meta: dict | None, days_dir: Path, today: date) -> list:
    """Existing days that must not change: only after launch, dated before today + lead."""
    if not meta or not meta.get("launched"):
        return []
    cutoff = today + timedelta(days=FROZEN_LEAD_DAYS)
    out = []
    n = 1
    while (days_dir / (str(n) + ".json")).exists():
        day = read_json(days_dir / (str(n) + ".json"))
        if date.fromisoformat(day["date"]) >= cutoff:
            break
        out.append(day)
        n += 1
    return out


def build_schedule(tiers: dict, pairings: dict, launch_date: str, days: int, seed: int, frozen=()) -> list:
    scheduler = Scheduler(tiers, pairings, seed)
    out = []
    for day in frozen:
        scheduler.record(day["games"])
        out.append(day)
    for n in range(len(out) + 1, days + 1):
        games = scheduler.build_day(n)
        scheduler.record(games)
        out.append(day_file(n, launch_date, games))
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Build the Daily Three schedule.")
    parser.add_argument("--launch-date", help="puzzle #1's date, YYYY-MM-DD (default: meta.json's, else the placeholder)")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="total days in the schedule")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--launch", action="store_true", help="mark the schedule launched: released days freeze from now on")
    parser.add_argument("--today", help="override today's date, YYYY-MM-DD (tests)")
    parser.add_argument("--out", type=Path, default=DAILY_DIR, help="output folder (tests)")
    args = parser.parse_args(argv)

    today     = date.fromisoformat(args.today) if args.today else date.today()
    meta_path = args.out / "meta.json"
    days_dir  = args.out / "days"
    old_meta  = read_json(meta_path) if meta_path.exists() else None

    launch_date = args.launch_date or (old_meta or {}).get("launchDate") or PLACEHOLDER_LAUNCH_DATE
    date.fromisoformat(launch_date)
    launched = bool(args.launch or (old_meta or {}).get("launched"))
    if old_meta and old_meta.get("launched") and old_meta["launchDate"] != launch_date:
        raise ValueError("The schedule is launched from " + old_meta["launchDate"]
                         + "; its launch date cannot change to " + launch_date)

    frozen = frozen_days(old_meta, days_dir, today)
    if args.days < len(frozen):
        raise ValueError("--days " + str(args.days) + " would drop " + str(len(frozen) - args.days)
                         + " released day(s)")

    seasons  = load_seasons()
    tiers    = load_pool()
    pairings = load_pairings(tiers.keys(), seasons)
    print("Pool teams: " + str(len(tiers)) + ", pairings: " + str(len(pairings)))

    schedule = build_schedule(tiers, pairings, launch_date, args.days, args.seed, frozen)

    days_dir.mkdir(parents=True, exist_ok=True)
    for day in schedule:
        write_json(days_dir / (str(day["n"]) + ".json"), day)
    for path in days_dir.glob("*.json"):
        if not path.stem.isdigit() or int(path.stem) > len(schedule):
            path.unlink()
    meta = {"launchDate": launch_date, "lastDay": len(schedule), "engine": ENGINE, "launched": launched}
    write_json(meta_path, meta)

    used = {k for day in schedule for g in day["games"] for k in (g["a"], g["b"])}
    print("Frozen days kept: " + str(len(frozen)))
    print("Days: " + str(len(schedule)) + " (" + schedule[0]["date"] + " to " + schedule[-1]["date"] + ")")
    print("Pool teams used: " + str(len(used)) + " of " + str(len(tiers)))
    print("Saved " + str(len(schedule)) + " day files to " + str(days_dir))
    print("Saved " + str(meta_path))


if __name__ == "__main__":
    main()
