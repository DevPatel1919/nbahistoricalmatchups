"""
textfmt.py

Formatting for Ask the Court (F13). Every number a corpus chunk shows is
written by one of these functions, and the grounding check (Session 4) reads
answers with the same rules, so a number the model copies from a chunk always
matches. Change a format here, never inline.

Seasons are keyed by the year they ended: season 1996 is "1995–96". Ranges and
records use an en dash (U+2013), as the site does.
"""

import math

DASH = "–"


# ---------------------------------------------------------------------------
# Seasons and teams
# ---------------------------------------------------------------------------

def season_label(season: int) -> str:
    """1996 -> '1995–96', 2000 -> '1999–00' (frontend/src/lib/dailyFormat.ts seasonLabel)."""
    season = int(season)
    return str(season - 1) + DASH + str(season % 100).zfill(2)


def team_title(season: int, city: str, name: str) -> str:
    """'1995–96 Chicago Bulls'."""
    return season_label(season) + " " + city + " " + name


def short_label(season: int, name: str) -> str:
    """'96 Bulls (the share-text style)."""
    return "'" + str(int(season) % 100).zfill(2) + " " + name


def team_aliases(season: int, city: str, name: str) -> list[str]:
    """
    Spellings a person might type for one team-season. They go into the
    chunk text so keyword search finds them; the entity linker (Session 2)
    resolves the same forms.
    """
    season = int(season)
    yy = str(season % 100).zfill(2)
    return [
        "'" + yy + " " + name,
        yy + " " + name,
        str(season) + " " + name,
        name + " " + str(season),
        str(season - 1) + "-" + yy + " " + name,
        city + " " + name + " " + str(season),
    ]


def decade_label(start: int, end: int) -> str:
    """Seasons 1990..1999 -> '1990s (1989–90 to 1998–99)'."""
    return str(start) + "s (" + season_label(start) + " to " + season_label(end) + ")"


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

def record(wins: int, losses: int) -> str:
    """72, 10 -> '72–10'."""
    return str(int(wins)) + DASH + str(int(losses))


def frac3(x: float) -> str:
    """Shooting and win fractions: 0.8780 -> '.878', 1.0 -> '1.000'."""
    s = format(round(float(x), 3), ".3f")
    return s[1:] if s.startswith("0.") else s


def rating(x: float) -> str:
    """Offensive/defensive rating and pace: one decimal, '115.2'."""
    return format(round(float(x), 1), ".1f")


def signed(x: float, digits: int = 1) -> str:
    """Net rating and z-scores: '+13.4', '-2.0'. Zero shows as '+0.0'."""
    v = round(float(x), digits)
    if v == 0:
        v = 0.0
    return ("+" if v >= 0 else "") + format(v, "." + str(digits) + "f")


def pct1(x: float) -> str:
    """A fraction as a percentage with one decimal: 0.1342 -> '13.4%'."""
    return format(round(float(x) * 100, 1), ".1f") + "%"


def ordinal(n: int) -> str:
    """1 -> '1st', 22 -> '22nd', 13 -> '13th'."""
    n = int(n)
    if 10 <= n % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return str(n) + suffix


def describe_z(z: float, higher_is_better: bool | None) -> str:
    """
    The direction of a z-score in words, from the team's point of view:
    'better than average', 'worse than average' or 'average'.

    higher_is_better=False (defensive rating, opponent eFG%, turnover %)
    flips the sign, so a low defensive rating reads as 'better'. None (pace)
    reads as 'faster'/'slower'.
    """
    if z is None or (isinstance(z, float) and math.isnan(z)):
        return "not available"
    if round(float(z), 1) == 0:
        return "average"
    if higher_is_better is None:
        word = "faster" if z > 0 else "slower"
    else:
        word = "better" if (z > 0) == higher_is_better else "worse"
    return word + " than average"
