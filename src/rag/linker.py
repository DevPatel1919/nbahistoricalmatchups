"""
linker.py

Entity linking for Ask the Court (F13 Session 2): finds the team-seasons,
seasons and decades a question is about, so retrieval can filter on them and
the tools can look up exact numbers.

    "'96 Bulls", "96 bulls", "1995-96 Bulls", "Bulls 1996", "the 1996 Chicago
    Bulls"                                    -> 1996-bulls
    "the Sonics in 1996"                      -> 1996-supersonics
    "the 90s", "1990s", "the nineties"        -> seasons 1990-1999
    "the 1999 season", "in 2003-04"           -> seasons 1999, 2004
    "the Bulls" (no year)                     -> franchise "Bulls", no key

A season is keyed by the year it ended. Names are era-correct, from
index.json, so "1996 Bullets" links and "1996 Wizards" does not (the Wizards
start in 1997-98). The Worker's linker (Session 5) must pass the same
fixtures: tests/fixtures/rag/linker.json.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parents[2]
INDEX_PATH = REPO_ROOT / "frontend" / "public" / "data" / "index.json"

MIN_SEASON = 1986
MAX_SEASON = 2026

# Informal nicknames -> the index name they mean.
NICKNAME_ALIASES = {
    "sixers":       "76ers",
    "blazers":      "trail blazers",
    "sonics":       "supersonics",
    "cavs":         "cavaliers",
    "mavs":         "mavericks",
    "wolves":       "timberwolves",
    "t-wolves":     "timberwolves",
    "dubs":         "warriors",
    "pels":         "pelicans",
    "grizz":        "grizzlies",
}

# Decades -> the seasons they cover (the year each season ended).
DECADES = {1980: (1986, 1989), 1990: (1990, 1999), 2000: (2000, 2009), 2010: (2010, 2019), 2020: (2020, 2026)}
DECADE_WORDS = {"eighties": 1980, "nineties": 1990}

# Words allowed between a year and the nickname it belongs to, besides the
# team's own city words.
BRIDGE_BEFORE = {"the", "season", "seasons"}
BRIDGE_AFTER  = {"of", "in", "from", "the", "season", "during"}


@dataclass
class Link:
    keys: list = field(default_factory=list)          # team-season keys, in order of appearance
    seasons: list = field(default_factory=list)       # seasons named without a team
    season_range: tuple | None = None                 # a decade, as (first, last)
    franchises: list = field(default_factory=list)    # nicknames named without a year (index spelling)
    unresolved: list = field(default_factory=list)    # "<nickname> <season>" pairs with no such team-season

    def as_dict(self) -> dict:
        return {"keys": self.keys, "seasons": self.seasons,
                "range": list(self.season_range) if self.season_range else None,
                "franchises": self.franchises, "unresolved": self.unresolved}


def expand_two_digit(token: str) -> int | None:
    """'98' -> 1998, '17' -> 2017; None if neither is a season the site covers (as frontend/src/lib/search.ts)."""
    n = int(token)
    for year in (1900 + n, 2000 + n):
        if MIN_SEASON <= year <= MAX_SEASON:
            return year
    return None


def normalize(text: str) -> str:
    text = text.lower()
    text = text.replace("’", "'").replace("‘", "'").replace("`", "'")
    text = text.replace("–", "-").replace("—", "-")
    return text


# ---------------------------------------------------------------------------
# Linker
# ---------------------------------------------------------------------------

class Linker:
    def __init__(self, teams: list[dict]):
        self.by_name_season = {(t["name"].lower(), int(t["season"])): t["key"] for t in teams}
        self.names = sorted({t["name"].lower() for t in teams})
        self.display = {t["name"].lower(): t["name"] for t in teams}
        self.city_words = {}
        for t in teams:
            words = set(re.findall(r"[a-z]+", t["city"].lower()))
            self.city_words.setdefault(t["name"].lower(), set()).update(words)
        spellings = sorted(set(self.names) | set(NICKNAME_ALIASES), key=len, reverse=True)
        self.name_pattern = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(s) for s in spellings) + r")(?![a-z])")

    @classmethod
    def from_index(cls, path: Path = INDEX_PATH) -> "Linker":
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f)["teams"])

    # -- year expressions --------------------------------------------------

    @staticmethod
    def find_years(text: str) -> list[dict]:
        """Every season expression, as {start, end, season, two_digit}. Decades are excluded."""
        found, taken = [], []

        def free(s, e):
            return all(e <= a or s >= b for a, b in taken)

        # 1995-96, 1995-1996, 95-96
        for m in re.finditer(r"(?<![\d'])'?(\d{2}|\d{4})\s*-\s*(\d{2}|\d{4})(?![\d])", text):
            first, second = m.group(1), m.group(2)
            start_year = int(first) if len(first) == 4 else expand_two_digit(first)
            if start_year is None:
                continue
            end_year = start_year + 1
            if int(second) not in (end_year, end_year % 100):
                continue
            if MIN_SEASON <= end_year <= MAX_SEASON:
                found.append({"start": m.start(), "end": m.end(), "season": end_year, "two_digit": False})
                taken.append((m.start(), m.end()))
        # 1996
        for m in re.finditer(r"(?<![\d'])(\d{4})(?![\d]|s\b|'s)", text):
            year = int(m.group(1))
            if MIN_SEASON <= year <= MAX_SEASON and free(m.start(), m.end()):
                found.append({"start": m.start(), "end": m.end(), "season": year, "two_digit": False})
                taken.append((m.start(), m.end()))
        # '96 (apostrophe) and 96 (bare, only usable right next to a nickname)
        for m in re.finditer(r"(?<![\d])('?)(\d{2})(?![\d]|s\b|'s|%)", text):
            year = expand_two_digit(m.group(2))
            if year is not None and free(m.start(), m.end()):
                found.append({"start": m.start(), "end": m.end(), "season": year, "two_digit": m.group(1) != "'"})
                taken.append((m.start(), m.end()))
        return sorted(found, key=lambda y: y["start"])

    @staticmethod
    def find_decade(text: str) -> tuple | None:
        m = re.search(r"(?<![\d])'?(\d{2}|\d{4})'?s\b", text)
        if m:
            value = int(m.group(1))
            decade = value if len(m.group(1)) == 4 else (1900 + value if value >= 80 else 2000 + value)
            if decade in DECADES:
                return DECADES[decade]
        for word, decade in DECADE_WORDS.items():
            if re.search(r"\b" + word + r"\b", text):
                return DECADES[decade]
        return None

    # -- binding -----------------------------------------------------------

    def bridge_ok(self, gap: str, allowed: set, name) -> bool:
        """True if gap holds only allowed words, the team's city words, spaces and commas."""
        if re.search(r"[^a-z\s,']", gap):
            return False
        city = self.city_words.get(name, set()) if isinstance(name, str) else set()
        words = re.findall(r"[a-z]+", gap)
        return len(words) <= 4 and all(w in allowed or w in city for w in words)

    def link(self, question: str) -> Link:
        text = normalize(question)
        years = self.find_years(text)
        used = set()
        result = Link()

        for m in self.name_pattern.finditer(text):
            spelled = m.group(1)
            name = NICKNAME_ALIASES.get(spelled, spelled)
            bound = None
            # The nearest unused year before the nickname: "'96 Bulls", "1996 Chicago Bulls",
            # "1995-96 Bulls". A bare "96" may only be followed by city words.
            before = [i for i, y in enumerate(years) if i not in used and y["end"] <= m.start()]
            if before:
                i = before[-1]
                gap = text[years[i]["end"]:m.start()]
                allowed = set() if years[i]["two_digit"] else BRIDGE_BEFORE
                if self.bridge_ok(gap, allowed, name):
                    bound = i
            # Else the nearest unused year after it: "Bulls 1996", "Bulls of 1995-96", "Bulls 98".
            if bound is None:
                after = [i for i, y in enumerate(years) if i not in used and y["start"] >= m.end()]
                if after:
                    i = after[0]
                    gap = text[m.end():years[i]["start"]]
                    ok = not gap.strip() if years[i]["two_digit"] else self.bridge_ok(gap, BRIDGE_AFTER, set())
                    if ok:
                        bound = i
            if bound is None:
                label = self.display[name]
                if label not in result.franchises:
                    result.franchises.append(label)
                continue
            used.add(bound)
            season = years[bound]["season"]
            key = self.by_name_season.get((name, season))
            if key is None:
                result.unresolved.append(self.display[name] + " " + str(season))
            elif key not in result.keys:
                result.keys.append(key)

        # Franchises later given a year elsewhere are not ambiguous.
        linked_names = {k.split("-", 1)[1] for k in result.keys}
        result.franchises = [f for f in result.franchises if f.lower().replace(" ", "-") not in linked_names]
        result.seasons = sorted({y["season"] for i, y in enumerate(years) if i not in used and not y["two_digit"]})
        result.season_range = self.find_decade(text)
        return result
