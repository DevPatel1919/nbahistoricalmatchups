"""
export_daily_data.py

Builds the Daily Three matchup pool (docs/product/features/F12-daily-three.md,
Session 1): the great team-seasons the daily game draws from, each with a
starting five and every starter's signature stats.

Pool rules (thresholds are the constants below):
  champion          won that season's Finals                          marquee
  very high win     regular-season win % >= MARQUEE_WIN_PCT            marquee
  high win          win % >= POOL_WIN_PCT                              known
  notable star      a starter in the league's top STAR_PPG_RANK for
                    PPG, or top STAR_BOARD_RANK for RPG or APG, on a
                    playoff team with win % >= STAR_TEAM_WIN_PCT       known
  owner pin         scripts/daily_pool_overrides.json                  as pinned

Win % always, never raw wins: 1999, 2012, 2020 and 2021 were short seasons.

Starting five: the 5 players with the most games started (GS) for the team
that season, from Basketball-Reference's season totals (the Kaggle dataset
sumitrodatta/nba-aba-baa-stats, downloaded by
backend/scripts/import_bbref_dataset.py). Ties go to minutes. Only a traded
player's rows for this team count, never the 2TM/3TM season totals, and a
player needs MIN_TEAM_GAMES games for the team. The overrides file can fix a
five outright.

Each team-season is mapped to its Basketball-Reference abbreviation by its
era-correct city and name (Team Abbrev.csv), falling back to the nickname
alone. Players are matched to PlayerStatistics.csv within the team-season by
normalize_name, then NAME_ALIASES; every starter must match exactly one
player. Cards use Basketball-Reference's spelling (with accents); PPG and
signature stats come from PlayerStatistics.csv.

Cross-checks, reported only (reports/daily_pool.md): the rules this script
used before games started, each scored against the GS five:
  starts         PlayerStatistics.csv's starter flag (startingPosition), set
                 for exactly 5 players a team-game only from 2017-18 on, and
                 not in 2021-22
  bench-points   TeamStatisticsExtended.csv records bench points from 2003-04
                 on (before that the column holds the whole team score), so in
                 each game the starters' points must add up to
                 teamScore - benchPoints. Of the 5-player subsets that do, take
                 the one with the most minutes; then repeat, preferring players
                 the first pass usually started
  minutes-proxy  in each game the team's 5 highest-minute players stand in for
                 its starters
Each ranks players by its count (ties: minutes) as above.

Data rights: Basketball-Reference's data may not be scraped or used publicly
or commercially without Sports Reference's written permission; Kaggle's CC0
label does not clear that (reports/daily_pool.md, HANDOFF's commercial-data
gate).

Signature stats: PPG first, then the top SIG_MAX of RPG, APG, SPG, BPG, 3PM,
FG% and 3P% at or above SIG_PERCENTILE of that season's league (qualified
players: half the season's games and QUALIFY_MPG minutes a game), or the best
single one if none reaches it.

Seasons follow the historical simulator: blank game types are filled from
Games.csv and playoff games take the calendar year they were played in, so
the October 2020 bubble Finals crown the 2020 champion.

Reads
  frontend/public/data/index.json        keys, era-correct names, records, ratings
  data/raw/PlayerStatistics.csv          player box scores (gitignored)
  data/raw/Players.csv                   guard / forward / center flags, for card order
  data/raw/Games.csv                     playoff games (champions), blank game types
  data/raw/TeamStatisticsExtended.csv    team score and bench points per game (cross-check)
  data/raw/bbref/Player Totals.csv       games started per player-team-season (gitignored)
  data/raw/bbref/Team Abbrev.csv         Basketball-Reference team names and abbreviations
  scripts/daily_pool_overrides.json      owner pins, exclusions, fixed fives

Writes
  frontend/public/data/daily/teams.json  the pool (pool teams only)
  reports/daily_pool.md                  champions, pool by tier, every five, cross-checks, close calls

Run from repo root:
    python backend/scripts/import_bbref_dataset.py    # once, into data/raw/bbref/
    python scripts/export_daily_data.py
"""

import itertools
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from backend.scripts.build_team_season_profiles_extended import (
    GAME_TYPE_PLAYOFF,
    GAME_TYPE_REGULAR,
    assign_season_playoffs_by_year,
    fill_missing_game_types,
    game_id_prefix,
)

REPO_ROOT         = Path(__file__).resolve().parents[1]
INDEX_PATH        = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
PLAYERS_PATH      = REPO_ROOT / "data" / "raw" / "PlayerStatistics.csv"
PEOPLE_PATH       = REPO_ROOT / "data" / "raw" / "Players.csv"
GAMES_PATH        = REPO_ROOT / "data" / "raw" / "Games.csv"
TEAM_STATS_PATH   = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
BBREF_TOTALS_PATH = REPO_ROOT / "data" / "raw" / "bbref" / "Player Totals.csv"
BBREF_ABBREV_PATH = REPO_ROOT / "data" / "raw" / "bbref" / "Team Abbrev.csv"
OVERRIDES_PATH    = REPO_ROOT / "scripts" / "daily_pool_overrides.json"
OUTPUT_PATH       = REPO_ROOT / "frontend" / "public" / "data" / "daily" / "teams.json"
REPORT_PATH       = REPO_ROOT / "reports" / "daily_pool.md"

# Pool and tiers
MARQUEE_WIN_PCT   = 0.750   # about 62 wins
POOL_WIN_PCT      = 0.680   # about 56 wins
STAR_PPG_RANK     = 5
STAR_BOARD_RANK   = 3       # RPG or APG
STAR_TEAM_WIN_PCT = 0.550

# Starting five
MIN_TEAM_GAMES     = 20
UNCERTAIN_GAP      = 0.15    # close calls: 5th minus 6th by games started, as a share of team games
MAX_MISSING_GAMES  = 2       # team games index.json counts that PlayerStatistics.csv lacks
REPORT_UNMATCHED   = 8       # report unmatched Basketball-Reference players among each team's top N by GS
REPORT_TOP_SCORERS = 3       # report a team's top N scorers who miss the five

# Cross-checks (the rules used before games started)
FLAG_SEASON_SHARE  = 0.99    # share of team-games flagging exactly 5 starters
BENCH_SEASON_SHARE = 0.90    # share of team-games whose starters bench points can infer
PRIOR_WEIGHT       = 1000.0  # bench-points second pass: usual starters before minutes

# Signature stats
QUALIFY_GAME_SHARE = 0.5    # of the season's games (median team)
QUALIFY_MPG        = 15.0
SIG_PERCENTILE     = 0.80
SIG_MAX            = 2
FG_MIN_FGA         = 5.0    # per game, for FG%
THREE_MIN_3PA      = 2.0    # per game, for 3P%

REGULAR_SEASON_PREFIX = "2"   # NBA game ids: 2 regular season (Cup games included)
BBREF_LEAGUE          = "NBA"
BBREF_MULTI_TEAM      = r"^(\d+TM|TOT)$"   # a traded player's season totals across teams

TIER_MARQUEE = "marquee"
TIER_KNOWN   = "known"
TIERS        = (TIER_MARQUEE, TIER_KNOWN)

REASON_CHAMPION  = "champion"
REASON_VERY_HIGH = "very-high-win"
REASON_HIGH      = "high-win"
REASON_STAR      = "notable-star"
REASON_PIN       = "owner-pin"

METHOD_GS       = "games-started"
METHOD_OVERRIDE = "override"
FIVE_FROM       = (METHOD_GS, METHOD_OVERRIDE)

CHECK_FLAG  = "starts"
CHECK_BENCH = "bench-points"
CHECK_PROXY = "minutes-proxy"

# The player_team_seasons column each cross-check rule ranks by.
CHECK_SCORE = {CHECK_FLAG: "starts", CHECK_BENCH: "inferred", CHECK_PROXY: "top5"}

# Basketball-Reference spellings that normalize_name cannot reconcile with
# PlayerStatistics.csv, both sides normalized. Used only when the exact name
# finds nobody on the team.
NAME_ALIASES = {
    "charles davis":          "charlie davis",
    "charles jones":          "charles r jones",
    "charles pittman":        "charlie pittman",
    "clarence weatherspoon":  "clar weatherspoon",
    "cliff robinson":         "cliff t robinson",
    "danny schayes":          "dan schayes",
    "dave greenwood":         "david greenwood",
    "eddie lee wilkins":      "eddielee wilkins",
    "eugene jeter":           "pooh jeter",
    "fat lever":              "lafayette lever",
    "goga bitadze":           "ga bitadze",
    "ha seung jin":           "seung jin ha",
    "isaac austin":           "ike austin",
    "jeenathan williams":     "nate williams",
    "jeff taylor":            "jeffery taylor",
    "jo jo english":          "jojo english",
    "kiwane lemorris garris": "kiwane garris",
    "kj martin":              "kenyon martin",
    "maurice martin":         "mo martin",
    "melvin turpin":          "mel turpin",
    "michael phelps":         "mike phelps",
    "michael ray richardson": "micheal ray richardson",
    "mike sweetney":          "michael sweetney",
    "nene":                   "nene hilario",
    "pearl washington":       "dwayne washington",
    "pete verhoeven":         "peter verhoeven",
    "rich manning":           "richard manning",
    "rob lock":               "robert lock",
    "ron grandison":          "ronnie grandison",
    "ron holland":            "ronald holland",
    "ronald murray":          "flip murray",
    "stanislav medvedenko":   "slava medvedenko",
    "steve bardo":            "stephen bardo",
    "steve smith":            "steven smith",
    "vitor luiz faverani":    "vitor faverani",
    "wang zhizhi":            "wang zhi zhi",
    "world b free":           "world free",
    "yang hansen":            "hansen yang",
    "yi jianlian":            "jianlian yi",
}

# Letters NFKD does not decompose into ASCII.
_NAME_LETTERS = str.maketrans({"ı": "i", "ð": "d", "Ð": "D", "đ": "d", "Đ": "D", "ø": "o", "Ø": "O",
                               "ł": "l", "Ł": "L", "æ": "ae", "Æ": "AE", "ß": "ss", "ё": "e", "Ё": "E"})
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}

# Raw box-score columns summed per player-team-season.
BOX_COLS = {
    "points":                 "pts",
    "reboundsTotal":          "reb",
    "assists":                "ast",
    "steals":                 "stl",
    "blocks":                 "blk",
    "fieldGoalsMade":         "fgm",
    "fieldGoalsAttempted":    "fga",
    "threePointersMade":      "tpm",
    "threePointersAttempted": "tpa",
}

# Signature-stat candidates, in tie-break order: label -> per-game value.
SIG_STATS = {
    "RPG": lambda p: p["reb"] / p["games"],
    "APG": lambda p: p["ast"] / p["games"],
    "SPG": lambda p: p["stl"] / p["games"],
    "BPG": lambda p: p["blk"] / p["games"],
    "3PM": lambda p: p["tpm"] / p["games"],
    "FG%": lambda p: _ratio(p["fgm"], p["fga"]),
    "3P%": lambda p: _ratio(p["tpm"], p["tpa"]),
}
PCT_SIG_STATS = {"FG%", "3P%"}


def _ratio(num, den):
    num, den = np.asarray(num, dtype=float), np.asarray(den, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_index(path: Path = INDEX_PATH) -> pd.DataFrame:
    with open(path, encoding="utf-8") as f:
        teams = pd.DataFrame(json.load(f)["teams"])
    if teams.empty:
        raise ValueError("index.json lists no teams.")
    if teams["key"].duplicated().any():
        raise ValueError("index.json has duplicate keys: " + str(teams.loc[teams["key"].duplicated(), "key"].tolist()))
    if teams.duplicated(subset=["franchiseId", "season"]).any():
        raise ValueError("index.json has two teams for one franchise-season.")
    teams["games"]   = teams["wins"] + teams["losses"]
    teams["win_pct"] = teams["wins"] / teams["games"]
    return teams


def parse_minutes(values: pd.Series) -> pd.Series:
    """numMinutes is a float, except about 2,000 rows written as "MM:SS"."""
    out = pd.to_numeric(values, errors="coerce")
    clock = values.astype(str).str.extract(r"^(\d+):(\d{1,2})$").astype(float)
    return out.fillna(clock[0] + clock[1] / 60).fillna(0.0)


def load_player_games(index: pd.DataFrame, path: Path = PLAYERS_PATH) -> pd.DataFrame:
    """
    One row per player per regular-season game, for the seasons index.json
    covers, with the team-season key attached. Rows with no minutes (DNPs)
    are dropped.
    """
    cols = ["firstName", "lastName", "personId", "gameId", "gameDateTimeEst", "gameType",
            "playerteamId", "playerteamName", "numMinutes", "startingPosition"] + list(BOX_COLS)
    df = pd.read_csv(path, usecols=cols, low_memory=False, encoding="utf-8")
    print("Player rows read: " + str(len(df)))

    # Regular season by game id, not gameType: the player file leaves gameType
    # blank in parts of 2000-01 and 2021-22, and labels NBA Cup group and
    # knockout games "NBA Emirates Cup" (and similar) although they count in
    # the standings. The Cup final (prefix 6) does not.
    df = df[game_id_prefix(df["gameId"]) == REGULAR_SEASON_PREFIX].copy()
    df["gameType"] = GAME_TYPE_REGULAR
    df["season"]  = assign_season_playoffs_by_year(df["gameDateTimeEst"], df["gameType"])
    df["minutes"] = parse_minutes(df["numMinutes"])
    df = df[df["minutes"] > 0]

    # About half of 2000-01's rows have no playerteamId; their team name still
    # matches index.json's era-correct name for that season.
    keys    = index.set_index(["franchiseId", "season"])["key"]
    by_name = index.set_index(["name", "season"])["key"]
    df["playerteamId"] = pd.to_numeric(df["playerteamId"], errors="coerce").astype("Int64")
    df["key"] = pd.MultiIndex.from_arrays([df["playerteamId"], df["season"]]).map(keys)
    no_id = df["playerteamId"].isna()
    df.loc[no_id, "key"] = pd.MultiIndex.from_arrays([df.loc[no_id, "playerteamName"], df.loc[no_id, "season"]]).map(by_name)
    print("Rows matched by team name (no team id): " + str(int((no_id & df["key"].notna()).sum())))
    df = df[df["key"].notna()].copy()
    if df.duplicated(subset=["gameId", "personId"]).any():
        raise ValueError("A player appears twice in one game in PlayerStatistics.csv.")

    df["started"] = df["startingPosition"].notna()
    for raw in BOX_COLS:
        df[raw] = pd.to_numeric(df[raw], errors="coerce").fillna(0.0)
    df = df.rename(columns=BOX_COLS)
    df["firstName"] = df["firstName"].fillna("").astype(str).str.strip()
    df["lastName"]  = df["lastName"].fillna("").astype(str).str.strip()
    print("Regular-season player-games: " + str(len(df)))
    return df.drop(columns=["numMinutes", "startingPosition", "gameDateTimeEst", "gameType", "playerteamName"])


def load_positions(path: Path = PEOPLE_PATH) -> pd.Series:
    """personId -> a sort weight from 1 (guard) to 3 (center); NaN when unknown."""
    people = pd.read_csv(path, usecols=["personId", "guard", "forward", "center"], encoding="utf-8")
    flags = people[["guard", "forward", "center"]].apply(pd.to_numeric, errors="coerce").fillna(0)
    total = flags.sum(axis=1)
    weight = (flags["guard"] * 1 + flags["forward"] * 2 + flags["center"] * 3) / total.where(total > 0)
    return pd.Series(weight.to_numpy(), index=people["personId"]).groupby(level=0).first()


def load_bbref_totals(seasons, path: Path = BBREF_TOTALS_PATH) -> pd.DataFrame:
    """
    Basketball-Reference's NBA player season totals for the given seasons
    (season = the year it ends), one row per player per team: a traded
    player's 2TM/3TM/... total rows are dropped.
    """
    cols = ["season", "lg", "player", "player_id", "team", "g", "gs", "mp"]
    df = pd.read_csv(path, usecols=cols, encoding="utf-8")
    df = df[(df["lg"] == BBREF_LEAGUE) & df["season"].isin(set(seasons))]
    df = df[~df["team"].astype(str).str.match(BBREF_MULTI_TEAM)].drop(columns="lg").copy()
    if df.empty:
        raise ValueError("No Basketball-Reference NBA rows for the index seasons in " + str(path))
    missing = sorted(set(seasons) - set(df["season"]))
    if missing:
        raise ValueError("Basketball-Reference totals have no rows for seasons " + str(missing))
    for col in ("g", "gs", "mp"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    blank = df[df["gs"].isna() | df["g"].isna()]
    if not blank.empty:
        raise ValueError("Basketball-Reference rows without games or games started: "
                         + str(blank[["season", "team", "player"]].head(10).values.tolist()))
    df["mp"] = df["mp"].fillna(0.0)
    if df.duplicated(subset=["season", "team", "player_id"]).any():
        raise ValueError("Basketball-Reference totals list a player twice for one team-season.")
    print("Basketball-Reference player-team-seasons: " + str(len(df)))
    return df


def load_team_abbrevs(path: Path = BBREF_ABBREV_PATH) -> pd.DataFrame:
    """Basketball-Reference's NBA team names and abbreviations by season."""
    df = pd.read_csv(path, usecols=["season", "lg", "team", "abbreviation"], encoding="utf-8")
    df = df[df["lg"] == BBREF_LEAGUE].drop(columns="lg")
    if df.empty:
        raise ValueError("No NBA rows in " + str(path))
    return df


def load_overrides(path: Path = OVERRIDES_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    out = {
        "pins":     dict(raw.get("pins", {})),
        "exclude":  list(raw.get("exclude", [])),
        "starters": {k: v for k, v in raw.get("starters", {}).items()},
    }
    bad = {k: v for k, v in out["pins"].items() if v not in TIERS}
    if bad:
        raise ValueError("Overrides pin a team to an unknown tier: " + str(bad))
    for key, entry in out["starters"].items():
        if len(entry.get("players", [])) != 5 or len(set(entry["players"])) != 5:
            raise ValueError("Override for " + key + " must name 5 different players.")
    return out


# ---------------------------------------------------------------------------
# Names and team abbreviations
# ---------------------------------------------------------------------------

def normalize_name(name) -> str:
    """
    A spelling-proof key for one name: ASCII letters (NFKD, plus a few letters
    it leaves alone), lowercase, hyphens as spaces, no punctuation, and no
    trailing Jr./Sr./II-IV. "J.R. Smith" and "JR Smith" -> "jr smith";
    "Toni Kukoč" -> "toni kukoc"; "Marcus Morris Sr." -> "marcus morris".
    """
    text = unicodedata.normalize("NFKD", str(name).translate(_NAME_LETTERS))
    text = text.encode("ascii", "ignore").decode("ascii").lower().replace("-", " ")
    words = re.sub(r"[^a-z0-9 ]", "", text).split()
    while len(words) > 2 and words[-1] in _NAME_SUFFIXES:
        words.pop()
    return " ".join(words)


def split_name(name: str) -> tuple:
    """(first, last) from a full name: the first word, then the rest. "Nenê" -> ("", "Nenê")."""
    parts = str(name).strip().split(" ", 1)
    return ("", parts[0]) if len(parts) == 1 else (parts[0], parts[1].strip())


def team_abbreviations(index: pd.DataFrame, abbrevs: pd.DataFrame) -> pd.Series:
    """
    key -> Basketball-Reference abbreviation, by the team's era-correct city
    and name that season, then by its nickname alone (index.json's "Oklahoma
    City Hornets" are Basketball-Reference's "New Orleans/Oklahoma City
    Hornets"). Raises unless each team maps to exactly one abbreviation.
    """
    table = abbrevs.assign(full=abbrevs["team"].map(normalize_name))
    by_season = {s: g for s, g in table.groupby("season")}
    out, bad = {}, []
    for team in index.to_dict("records"):
        season = by_season.get(team["season"], table.iloc[0:0])
        found = season[season["full"] == normalize_name(team["city"] + " " + team["name"])]
        if len(found) != 1:
            nickname = normalize_name(team["name"])
            found = season[season["full"].map(lambda full: full == nickname or full.endswith(" " + nickname))]
        abbrs = sorted(set(found["abbreviation"]))
        if len(abbrs) != 1:
            bad.append((team["key"], abbrs))
            continue
        out[team["key"]] = abbrs[0]
    if bad:
        raise ValueError("Teams that do not map to exactly one Basketball-Reference abbreviation: " + str(bad))
    return pd.Series(out)


# ---------------------------------------------------------------------------
# Champions
# ---------------------------------------------------------------------------

def derive_champions(games: pd.DataFrame, index: pd.DataFrame) -> dict:
    """
    {season: key} from the last playoff game of each season, read from
    Games.csv rows (gameId, gameDateTimeEst, gameType, winner). Playoff games
    take the calendar year they were played in, so the October 2020 bubble
    Finals belong to 2020.
    """
    po = fill_missing_game_types(games)
    po = po[po["gameType"] == GAME_TYPE_PLAYOFF].copy()
    po["season"] = assign_season_playoffs_by_year(po["gameDateTimeEst"], po["gameType"])
    po = po[po["season"].isin(set(index["season"]))]
    po["when"] = pd.to_datetime(po["gameDateTimeEst"], format="mixed")
    last = po.sort_values(["when", "gameId"]).groupby("season").tail(1)

    keys = index.set_index(["franchiseId", "season"])["key"]
    champions = {}
    for season, winner in zip(last["season"], last["winner"]):
        key = keys.get((int(winner), int(season)))
        if key is None:
            raise ValueError("The " + str(season) + " champion (team " + str(winner) + ") is not in index.json.")
        champions[int(season)] = key
    missing = sorted(set(index["season"]) - set(champions))
    if missing:
        raise ValueError("No playoff games found for seasons " + str(missing))
    return champions


# ---------------------------------------------------------------------------
# Player seasons
# ---------------------------------------------------------------------------

def flagged_seasons(player_games: pd.DataFrame) -> dict:
    """{season: share of team-games that flag exactly 5 starters}."""
    per_game = player_games.groupby(["season", "key", "gameId"])["started"].sum()
    return (per_game == 5).groupby(level="season").mean().to_dict()


def add_top5_minutes(player_games: pd.DataFrame) -> pd.DataFrame:
    """Mark each team's 5 highest-minute players in every game (ties: points, then personId)."""
    df = player_games.sort_values(["key", "gameId", "minutes", "pts", "personId"],
                                  ascending=[True, True, False, False, True])
    df["top5"] = df.groupby(["key", "gameId"]).cumcount() < 5
    return df


_COMBOS = {}


def _combos(n: int) -> np.ndarray:
    if n not in _COMBOS:
        _COMBOS[n] = np.array(list(itertools.combinations(range(n), 5)), dtype=np.int64)
    return _COMBOS[n]


def infer_starters(points: np.ndarray, minutes: np.ndarray, target: float, prior: np.ndarray = None):
    """
    Positions of the 5 players whose points add up to target (the team's
    score less its bench points), or None if no 5 do. Among matching
    subsets: the most total prior (when given, weighted by PRIOR_WEIGHT),
    then the most minutes.
    """
    if len(points) < 5 or not np.isfinite(target):
        return None
    c = _combos(len(points))
    match = c[points[c].sum(axis=1) == target]
    if len(match) == 0:
        return None
    score = minutes[match].sum(axis=1)
    if prior is not None:
        score = score + PRIOR_WEIGHT * prior[match].sum(axis=1)
    return match[int(np.argmax(score))]


def load_bench_targets(path: Path = TEAM_STATS_PATH) -> pd.DataFrame:
    """(gameId, franchiseId, target): the starters' points, teamScore - benchPoints, where recorded."""
    box = pd.read_csv(path, usecols=["gameId", "teamId", "teamScore", "benchPoints"], low_memory=False)
    box["franchiseId"] = pd.to_numeric(box["teamId"], errors="coerce")
    box["target"] = pd.to_numeric(box["teamScore"], errors="coerce") - pd.to_numeric(box["benchPoints"], errors="coerce")
    box = box.dropna(subset=["franchiseId", "target"]).drop_duplicates(subset=["gameId", "franchiseId"])
    box["franchiseId"] = box["franchiseId"].astype(int)
    return box[["gameId", "franchiseId", "target"]]


def add_bench_inferred_starts(player_games: pd.DataFrame, targets: pd.DataFrame, index: pd.DataFrame) -> pd.DataFrame:
    """
    Add `inferred` (infer_starters picked the player) and `benchMatched` (the
    team-game had a matching subset) to every player-game. Two passes: the
    first breaks ties by minutes; the second prefers each player's
    first-pass start share on that team, then minutes.
    """
    df = player_games.reset_index(drop=True).copy()
    df["franchiseId"] = df["key"].map(index.set_index("key")["franchiseId"]).astype(int)
    df = df.merge(targets, on=["gameId", "franchiseId"], how="left")
    groups = [idx for idx in df.groupby(["key", "gameId"], sort=False).indices.values()
              if np.isfinite(df["target"].iat[idx[0]])]
    points, minutes, target = df["pts"].to_numpy(float), df["minutes"].to_numpy(float), df["target"].to_numpy(float)

    def run(prior):
        started = np.zeros(len(df), dtype=bool)
        matched = np.zeros(len(df), dtype=bool)
        for idx in groups:
            best = infer_starters(points[idx], minutes[idx], target[idx[0]], None if prior is None else prior[idx])
            if best is not None:
                started[idx[best]] = True
                matched[idx] = True
        return started, matched

    first, _ = run(None)
    df["inferred"] = first
    by_player = df.groupby(["key", "personId"])
    share = (by_player["inferred"].transform("sum") / by_player["gameId"].transform("nunique")).to_numpy(float)
    df["inferred"], df["benchMatched"] = run(share)
    return df.drop(columns=["franchiseId", "target"])


def bench_seasons(player_games: pd.DataFrame) -> dict:
    """{season: share of team-games whose starters the bench points could infer}."""
    per_game = player_games.groupby(["season", "key", "gameId"])["benchMatched"].first()
    return per_game.groupby(level="season").mean().to_dict()


def player_team_seasons(player_games: pd.DataFrame) -> pd.DataFrame:
    """One row per player per team-season: games, starts (flagged, inferred, top-5 minutes), minutes, box totals."""
    df = player_games if "top5" in player_games.columns else add_top5_minutes(player_games)
    if "inferred" not in df.columns:
        df = df.assign(inferred=False)
    agg = {"games": ("gameId", "nunique"), "starts": ("started", "sum"), "inferred": ("inferred", "sum"),
           "top5": ("top5", "sum"), "minutes": ("minutes", "sum"),
           "firstName": ("firstName", "last"), "lastName": ("lastName", "last")}
    agg.update({c: (c, "sum") for c in BOX_COLS.values()})
    out = df.sort_values("gameId").groupby(["season", "key", "personId"]).agg(**agg).reset_index()
    for col in ("starts", "inferred", "top5"):
        out[col] = out[col].astype(int)
    return out


def team_games(player_games: pd.DataFrame) -> pd.Series:
    """key -> regular-season games the team played, from the player rows."""
    return player_games.groupby("key")["gameId"].nunique()


def league_player_seasons(player_games: pd.DataFrame) -> pd.DataFrame:
    """
    One row per player per season across all their teams, flagged
    `qualified` when they played QUALIFY_GAME_SHARE of the season's games
    (the median team's count) at QUALIFY_MPG minutes a game. This is the
    league the signature stats and the star rule compare against.
    """
    agg = {"games": ("gameId", "nunique"), "minutes": ("minutes", "sum")}
    agg.update({c: (c, "sum") for c in BOX_COLS.values()})
    out = player_games.groupby(["season", "personId"]).agg(**agg).reset_index()
    season_games = player_games.groupby(["season", "key"])["gameId"].nunique().groupby(level="season").median()
    out["qualified"] = ((out["games"] >= QUALIFY_GAME_SHARE * out["season"].map(season_games))
                        & (out["minutes"] / out["games"] >= QUALIFY_MPG))
    out["ppg"] = out["pts"] / out["games"]
    for label, fn in SIG_STATS.items():
        out[label] = fn(out)
    out.loc[out["fga"] / out["games"] < FG_MIN_FGA, "FG%"] = np.nan
    out.loc[out["tpa"] / out["games"] < THREE_MIN_3PA, "3P%"] = np.nan
    return out


# ---------------------------------------------------------------------------
# Starting fives
# ---------------------------------------------------------------------------

def rank_by_games_started(bbref: pd.DataFrame, min_games: int = MIN_TEAM_GAMES) -> pd.DataFrame:
    """
    One team-season's Basketball-Reference rows (one per player for this
    team), players with min_games or more first by games started; ties by
    minutes, then player_id.
    """
    eligible = bbref[bbref["g"] >= min_games]
    return eligible.sort_values(["gs", "mp", "player_id"], ascending=[False, False, True])


def pick_gs_five(bbref: pd.DataFrame, games: int, min_games: int = MIN_TEAM_GAMES) -> dict:
    """
    The starting five for one team-season by games started. Returns
    Basketball-Reference player_ids, and the 5th and 6th players (player_id,
    name, GS); gap is (5th GS - 6th GS) / team games.
    """
    ranked = rank_by_games_started(bbref, min_games)
    if len(ranked) < 5:
        raise ValueError("Fewer than 5 players with " + str(min_games) + "+ games for "
                         + str(bbref["team"].iloc[0] if len(bbref) else "an empty roster")
                         + (" in " + str(int(bbref["season"].iloc[0])) if len(bbref) else ""))
    fifth = ranked.iloc[4]
    sixth = ranked.iloc[5] if len(ranked) > 5 else None
    return {
        "player_ids": ranked["player_id"].iloc[:5].tolist(),
        "gap":        float((fifth["gs"] - (sixth["gs"] if sixth is not None else 0)) / games),
        "fifth":      (fifth["player_id"], fifth["player"], int(fifth["gs"])),
        "sixth":      (sixth["player_id"], sixth["player"], int(sixth["gs"])) if sixth is not None else None,
    }


def match_players(bbref: pd.DataFrame, roster: pd.DataFrame) -> pd.Series:
    """
    player_id -> personId for one team-season's Basketball-Reference rows
    against its PlayerStatistics.csv players (player_team_seasons rows): by
    normalize_name, then NAME_ALIASES. Two players with one name (the 1989
    Bullets' two Charles Joneses) are told apart by games for the team. A row
    that finds nobody, or no single player, or a player another row also
    claims, maps to NaN.
    """
    ours = {}
    for pid, first, last, games in zip(roster["personId"], roster["firstName"], roster["lastName"], roster["games"]):
        ours.setdefault(normalize_name(first + " " + last), []).append((pid, games))
    out = {}
    for player_id, player, g in zip(bbref["player_id"], bbref["player"], bbref["g"]):
        name = normalize_name(player)
        found = ours.get(name) or ours.get(NAME_ALIASES.get(name), [])
        if len(found) > 1:
            found = [c for c in found if c[1] == g]
        out[player_id] = float(found[0][0]) if len(found) == 1 else np.nan
    matched = pd.Series(out, dtype=float)
    claimed = matched.dropna()
    matched[claimed[claimed.duplicated(keep=False)].index] = np.nan
    return matched


def rank_starters(roster: pd.DataFrame, method: str, min_games: int = MIN_TEAM_GAMES) -> pd.DataFrame:
    """
    Cross-checks: a team-season's eligible players (min_games or more), best
    starter candidates first by the rule's count (CHECK_SCORE); ties by total
    minutes, then personId.
    """
    eligible = roster[roster["games"] >= min_games].copy()
    eligible["score"] = eligible[CHECK_SCORE[method]]
    return eligible.sort_values(["score", "minutes", "personId"], ascending=[False, False, True])


def pick_five(roster: pd.DataFrame, method: str, games: int, min_games: int = MIN_TEAM_GAMES) -> dict:
    """
    Cross-checks: the five one of the earlier rules gives for a team-season
    (rows of player_team_seasons). Returns personIds and how close the 6th
    player came: gap is (5th score - 6th score) / team games.
    """
    ranked = rank_starters(roster, method, min_games)
    if len(ranked) < 5:
        raise ValueError("Fewer than 5 players with " + str(min_games) + "+ games for "
                         + str(roster["key"].iloc[0] if len(roster) else "an empty roster"))
    fifth = ranked.iloc[4]
    sixth = ranked.iloc[5] if len(ranked) > 5 else None
    gap = (fifth["score"] - (sixth["score"] if sixth is not None else 0)) / games
    return {
        "ids":    ranked["personId"].iloc[:5].tolist(),
        "method": method,
        "gap":    float(gap),
        "fifth":  int(fifth["personId"]),
        "sixth":  int(sixth["personId"]) if sixth is not None else None,
    }


def full_name(row) -> str:
    return (row["firstName"] + " " + row["lastName"]).strip()


def short_name(row) -> str:
    """"Michael Jordan" -> "M. Jordan"; suffixes stay ("G. Payton II")."""
    if not row["firstName"]:
        return row["lastName"]
    return row["firstName"][0] + ". " + row["lastName"]


def override_five(roster: pd.DataFrame, names: list, key: str) -> dict:
    """Resolve an overrides-file five by full name against the team's players."""
    by_name = {full_name(r): r["personId"] for _, r in roster.iterrows()}
    unknown = [n for n in names if n not in by_name]
    if unknown:
        raise ValueError("Override for " + key + " names players who did not play for it: " + str(unknown))
    return {"ids": [by_name[n] for n in names], "method": METHOD_OVERRIDE}


def gs_roster(roster: pd.DataFrame, bbref: pd.DataFrame, matched: pd.Series) -> pd.DataFrame:
    """
    The team's player_team_seasons rows with Basketball-Reference's spelling
    (firstName, lastName) and games started (gs) for every matched player.
    Unmatched players keep PlayerStatistics.csv's spelling and no gs.
    """
    pairs = matched.dropna()
    by_person = bbref.set_index("player_id").loc[pairs.index].assign(personId=pairs.to_numpy()).set_index("personId")
    out = roster.copy()
    hit = out["personId"].isin(by_person.index)
    names = out.loc[hit, "personId"].map(by_person["player"]).map(split_name)
    out.loc[hit, "firstName"] = [first for first, _ in names]
    out.loc[hit, "lastName"]  = [last for _, last in names]
    out["gs"] = out["personId"].map(by_person["gs"])
    return out


# ---------------------------------------------------------------------------
# Signature stats
# ---------------------------------------------------------------------------

def percentile_of(value: float, reference: np.ndarray) -> float:
    """Share of reference below value, counting ties as half."""
    ref = reference[~np.isnan(reference)]
    if np.isnan(value) or len(ref) == 0:
        return float("nan")
    return float(((ref < value).sum() + 0.5 * (ref == value).sum()) / len(ref))


def signature_stats(player: pd.Series, league: pd.DataFrame) -> list:
    """
    Up to SIG_MAX [{stat, value, pctile}] for one starter's team stint
    (player_team_seasons row), measured against the qualified league
    player-seasons of the same season. FG% and 3P% need FG_MIN_FGA and
    THREE_MIN_3PA attempts a game.
    """
    qualified = league[(league["season"] == player["season"]) & league["qualified"]]
    stint = pd.DataFrame([player])
    found = []
    for order, (label, fn) in enumerate(SIG_STATS.items()):
        value = float(np.asarray(fn(stint), dtype=float)[0])
        if label == "FG%" and player["fga"] / player["games"] < FG_MIN_FGA:
            continue
        if label == "3P%" and player["tpa"] / player["games"] < THREE_MIN_3PA:
            continue
        pct = percentile_of(value, qualified[label].to_numpy(dtype=float))
        if not np.isnan(pct):
            found.append((pct, -order, label, value))
    found.sort(reverse=True)
    top = [f for f in found if f[0] >= SIG_PERCENTILE][:SIG_MAX] or found[:1]
    return [{"stat": label, "value": round(value, 3 if label in PCT_SIG_STATS else 1), "pctile": round(pct, 3)}
            for pct, _, label, value in top]


# ---------------------------------------------------------------------------
# Pool
# ---------------------------------------------------------------------------

def league_leaders(league: pd.DataFrame) -> pd.DataFrame:
    """Per qualified player-season, their league rank in PPG, RPG and APG (1 = best)."""
    q = league[league["qualified"]].copy()
    for stat in ("ppg", "RPG", "APG"):
        q[stat + "_rank"] = q.groupby("season")[stat].rank(ascending=False, method="min")
    return q[["season", "personId", "ppg_rank", "RPG_rank", "APG_rank"]]


def star_reasons(five_ids: list, season: int, leaders: pd.DataFrame) -> list:
    """Descriptions of every starter who leads the league closely enough to make the team notable."""
    rows = leaders[(leaders["season"] == season) & leaders["personId"].isin(five_ids)]
    found = []
    for _, r in rows.iterrows():
        bits = []
        if r["ppg_rank"] <= STAR_PPG_RANK:
            bits.append("PPG #" + str(int(r["ppg_rank"])))
        if r["RPG_rank"] <= STAR_BOARD_RANK:
            bits.append("RPG #" + str(int(r["RPG_rank"])))
        if r["APG_rank"] <= STAR_BOARD_RANK:
            bits.append("APG #" + str(int(r["APG_rank"])))
        if bits:
            found.append((r["personId"], bits))
    return found


def describe_stars(stars: list, roster: pd.DataFrame) -> str:
    """"Michael Jordan PPG #1; ..." for star_reasons' output, by the roster's spelling."""
    people = roster.set_index("personId")
    return "; ".join(full_name(people.loc[pid]) + " " + ", ".join(bits) for pid, bits in stars)


def classify(team: dict, champion: bool, has_star: bool) -> tuple:
    """(tier or None, reasons) from the pool rules, before overrides."""
    reasons = []
    if champion:
        reasons.append(REASON_CHAMPION)
    if team["win_pct"] >= MARQUEE_WIN_PCT:
        reasons.append(REASON_VERY_HIGH)
    elif team["win_pct"] >= POOL_WIN_PCT:
        reasons.append(REASON_HIGH)
    if has_star and team["madePlayoffs"] and team["win_pct"] >= STAR_TEAM_WIN_PCT:
        reasons.append(REASON_STAR)
    if REASON_CHAMPION in reasons or REASON_VERY_HIGH in reasons:
        return TIER_MARQUEE, reasons
    return (TIER_KNOWN if reasons else None), reasons


def apply_overrides(tier, reasons: list, key: str, overrides: dict) -> tuple:
    if key in overrides["exclude"]:
        return None, reasons
    if key in overrides["pins"]:
        return overrides["pins"][key], reasons + [REASON_PIN]
    return tier, reasons


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def season_methods(flags: dict, bench: dict) -> dict:
    """
    {season: the rule the first version of this script used for it}: the
    flag, then bench points, then the minutes proxy. Kept for the report's
    cross-checks.
    """
    out = {}
    for season in sorted(set(flags) | set(bench)):
        if flags.get(season, 0) >= FLAG_SEASON_SHARE:
            out[season] = CHECK_FLAG
        elif bench.get(season, 0) >= BENCH_SEASON_SHARE:
            out[season] = CHECK_BENCH
        else:
            out[season] = CHECK_PROXY
    return out


def build_pool(index, player_games, bbref, abbrevs, champions, overrides, positions) -> dict:
    """player_games must carry add_bench_inferred_starts' columns."""
    flags     = flagged_seasons(player_games)
    bench     = bench_seasons(player_games)
    methods   = season_methods(flags, bench)
    rosters   = player_team_seasons(add_top5_minutes(player_games))
    league    = league_player_seasons(player_games)
    leaders   = league_leaders(league)
    n_games   = team_games(player_games)
    abbr      = team_abbreviations(index, abbrevs)

    unknown = (set(overrides["pins"]) | set(overrides["exclude"]) | set(overrides["starters"])) - set(index["key"])
    if unknown:
        raise ValueError("Overrides name keys that are not in index.json: " + str(sorted(unknown)))

    champion_keys = set(champions.values())
    teams, details, checks, gaps, unmatched = {}, {}, [], [], []
    by_key   = {k: g for k, g in rosters.groupby("key")}
    by_bbref = {k: g for k, g in bbref.groupby(["season", "team"])}

    for team in index.sort_values(["season", "key"]).to_dict("records"):
        key, season = team["key"], int(team["season"])
        roster = by_key.get(key)
        if roster is None:
            raise ValueError("No player rows for " + key)
        rows = by_bbref.get((season, abbr[key]))
        if rows is None:
            raise ValueError("No Basketball-Reference rows for " + key + " (" + abbr[key] + ")")
        games = int(n_games[key])
        if games != team["games"]:
            if abs(games - team["games"]) > MAX_MISSING_GAMES:
                raise ValueError(key + ": " + str(games) + " games in PlayerStatistics.csv, "
                                 + str(team["games"]) + " in index.json.")
            gaps.append((key, games, int(team["games"])))

        matched = match_players(rows, roster)
        top = rows.sort_values(["gs", "mp", "player_id"], ascending=[False, False, True]).head(REPORT_UNMATCHED)
        for r in top[top["player_id"].map(matched).isna()].to_dict("records"):
            unmatched.append((key, r["player"], int(r["g"]), int(r["gs"])))

        gs_pick = pick_gs_five(rows, games)
        lost = [p for p in gs_pick["player_ids"] if np.isnan(matched[p])]
        if lost:
            names = rows.set_index("player_id").loc[lost, "player"].tolist()
            raise ValueError(key + ": starters " + str(names) + " match no single player in PlayerStatistics.csv; "
                             "add them to NAME_ALIASES.")
        auto = dict(gs_pick, ids=[matched[p] for p in gs_pick["player_ids"]], method=METHOD_GS)
        roster = gs_roster(roster, rows, matched)

        # The earlier rules, each scored against games started.
        check = {"key": key, "season": season, "previous": methods[season], "gs_ids": auto["ids"]}
        for method in (CHECK_FLAG, CHECK_BENCH, CHECK_PROXY):
            if method == CHECK_FLAG and flags.get(season, 0) < FLAG_SEASON_SHARE:
                continue
            if method == CHECK_BENCH and bench.get(season, 0) < BENCH_SEASON_SHARE:
                continue
            ids = pick_five(roster, method, games)["ids"]
            check[method] = len(set(auto["ids"]) - set(ids))
            check[method + "_ids"] = ids
        checks.append(check)

        five = override_five(roster, overrides["starters"][key]["players"], key) if key in overrides["starters"] else auto
        stars = star_reasons(five["ids"], season, leaders)
        tier, reasons = classify(team, key in champion_keys, bool(stars))
        tier, reasons = apply_overrides(tier, reasons, key, overrides)

        # Pool membership under the first version's five: the star rule depends on the five.
        prev_ids   = five["ids"] if key in overrides["starters"] else check[methods[season] + "_ids"]
        prev_stars = star_reasons(prev_ids, season, leaders)
        prev_tier  = apply_overrides(classify(team, key in champion_keys, bool(prev_stars))[0], [], key, overrides)[0]
        check.update({"in_pool": tier is not None, "prev_in_pool": prev_tier is not None,
                      "stars": describe_stars(stars, roster), "prev_stars": describe_stars(prev_stars, roster)})
        if tier is None:
            continue

        teams[key], details[key] = build_team_entry(team, roster, five, games, league, positions, tier, reasons)
        details[key].update({"auto": auto, "stars": stars, "roster": roster})

    missing = set(overrides["starters"]) - set(teams)
    if missing:
        raise ValueError("Overrides fix fives for teams outside the pool: " + str(sorted(missing)))
    return {"teams": teams, "details": details, "flags": flags, "bench": bench, "methods": methods,
            "checks": checks, "champions": champions, "gaps": gaps, "unmatched": unmatched}


def build_team_entry(team, roster, five, games, league, positions, tier, reasons) -> tuple:
    rows = roster.set_index("personId").loc[five["ids"]].reset_index()
    rows["ppg"] = rows["pts"] / rows["games"]
    rows["pos"] = rows["personId"].map(positions).fillna(2.0)
    rows = rows.sort_values(["pos", "ppg"], ascending=[True, False])

    starters = []
    for _, p in rows.iterrows():
        sig = signature_stats(p, league)
        starters.append({
            "name":  full_name(p),
            "short": short_name(p),
            "ppg":   round(float(p["ppg"]), 1),
            "sig":   [{"stat": s["stat"], "value": s["value"]} for s in sig],
            "_pctile": [s["pctile"] for s in sig],
            "_games":  int(p["games"]),
            "_gs":     None if pd.isna(p["gs"]) else int(p["gs"]),
        })

    team_pts  = float(roster["pts"].sum())
    bench_ppg = max(0.0, (team_pts - float(rows["pts"].sum())) / games)
    three_rate = float(roster["tpa"].sum() / roster["fga"].sum()) if roster["fga"].sum() > 0 else None
    entry = {
        "tier":      tier,
        "reasons":   reasons,
        "fiveFrom":  five["method"],
        "wins":      int(team["wins"]),
        "losses":    int(team["losses"]),
        "pace":      team["pace"],
        "offRating": team["offRating"],
        "defRating": team["defRating"],
        "threeRate": round(three_rate, 3) if three_rate is not None else None,
        "benchPpg":  round(bench_ppg, 1),
        "starters":  [{k: v for k, v in s.items() if not k.startswith("_")} for s in starters],
    }
    if entry["threeRate"] is None:
        del entry["threeRate"]
    return entry, {"method": five["method"], "ids": list(rows["personId"]), "starters": starters, "team": team}


def validate_pool(pool: dict, index: pd.DataFrame) -> None:
    teams = pool["teams"]
    if not teams:
        raise ValueError("The pool is empty.")
    missing = set(teams) - set(index["key"])
    if missing:
        raise ValueError("Pool keys not in index.json: " + str(sorted(missing)))
    for key, t in teams.items():
        if t["tier"] not in TIERS:
            raise ValueError(key + " has tier " + str(t["tier"]))
        if t["fiveFrom"] not in FIVE_FROM:
            raise ValueError(key + " has fiveFrom " + str(t["fiveFrom"]))
        if len(t["starters"]) != 5 or len({s["name"] for s in t["starters"]}) != 5:
            raise ValueError(key + " does not have 5 different starters.")
        for s in t["starters"]:
            if not 1 <= len(s["sig"]) <= SIG_MAX:
                raise ValueError(key + ": " + s["name"] + " has " + str(len(s["sig"])) + " signature stats.")
    for season, key in pool["champions"].items():
        if key not in teams:
            print("Note: champion " + key + " is not in the pool (excluded by override).")


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_teams_json(pool: dict, index_release: dict, path: Path = OUTPUT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated": date.today().isoformat(),
        "release":   index_release,
        "champions": {str(s): k for s, k in sorted(pool["champions"].items())},
        "teams":     pool["teams"],
    }
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")


def era_name(team: dict) -> str:
    season = int(team["season"])
    return str(season - 1) + "–" + str(season)[2:] + " " + team["city"] + " " + team["name"]


def fmt_sig(s: dict) -> str:
    value = ("%.3f" % s["value"]).lstrip("0") if s["stat"] in PCT_SIG_STATS else "%.1f" % s["value"]
    return value + " " + s["stat"]


def agreement_table(checks: pd.DataFrame, add) -> None:
    """Rows: how many GS starters each earlier rule misses; columns: the rules."""
    cols = [m for m in (CHECK_FLAG, CHECK_BENCH, CHECK_PROXY) if m in checks.columns]
    n = {m: int(checks[m].notna().sum()) for m in cols}
    add("| Starters different | " + " | ".join(
        {CHECK_FLAG: "Starter flag", CHECK_BENCH: "Bench-points inference", CHECK_PROXY: "Minutes proxy"}[m]
        + " (" + str(n[m]) + ")" for m in cols) + " |")
    add("|---|" + "---|" * len(cols))
    for wrong, label in ((0, "0 (same five)"), (1, "1"), (2, "2"), (3, "3 or more")):
        cells = []
        for m in cols:
            k = int((checks[m] >= wrong).sum()) if wrong == 3 else int((checks[m] == wrong).sum())
            cells.append(str(k) + " (" + "{:.0%}".format(k / n[m]) + ")" if n[m] else "—")
        add("| " + label + " | " + " | ".join(cells) + " |")
    add("")


def write_report(pool: dict, index: pd.DataFrame, path: Path = REPORT_PATH) -> None:
    teams, details, methods = pool["teams"], pool["details"], pool["methods"]
    idx = index.set_index("key")
    lines = []
    add = lines.append

    def label(season):
        return str(season - 1) + "–" + str(season)[2:]

    def names(key, ids):
        roster = details[key]["roster"].set_index("personId")
        return ", ".join(full_name(roster.loc[i]) for i in ids)

    def with_gs(key, ids):
        roster = details[key]["roster"].set_index("personId")
        return ", ".join(full_name(roster.loc[i]) + " ("
                         + ("—" if pd.isna(roster.loc[i, "gs"]) else str(int(roster.loc[i, "gs"]))) + ")" for i in ids)

    tier_counts = {t: sum(1 for v in teams.values() if v["tier"] == t) for t in TIERS}
    checks = pd.DataFrame(pool["checks"])
    pool_checks = checks[checks["key"].isin(teams)]
    marquee_pairs = tier_counts[TIER_MARQUEE] * (tier_counts[TIER_MARQUEE] - 1) // 2
    overridden = [k for k in teams if details[k]["method"] == METHOD_OVERRIDE]

    add("# Daily Three: matchup pool (F12 Session 1)")
    add("")
    add("Generated by `scripts/export_daily_data.py` on " + date.today().isoformat()
        + ". Data: `frontend/public/data/daily/teams.json`. Every threshold is a constant at the top of the script; "
        "owner fixes go in `scripts/daily_pool_overrides.json`.")
    add("")
    add("## Summary")
    add("")
    add("| | Teams |")
    add("|---|---|")
    add("| Pool | " + str(len(teams)) + " |")
    add("| Marquee (champions, win % ≥ " + ("%.3f" % MARQUEE_WIN_PCT).lstrip("0") + ") | " + str(tier_counts[TIER_MARQUEE]) + " |")
    add("| Known | " + str(tier_counts[TIER_KNOWN]) + " |")
    add("| Known through the notable-star rule alone | "
        + str(sum(1 for t in teams.values() if t["reasons"] == [REASON_STAR])) + " |")
    add("| Five from games started | " + str(sum(1 for k in teams if details[k]["method"] == METHOD_GS)) + " |")
    add("| Five fixed in the overrides file | " + str(len(overridden)) + " |")
    add("")
    add("Possible pairings: " + "{:,}".format(len(teams) * (len(teams) - 1) // 2) + ". Featured (marquee vs marquee) "
        "pairings: " + "{:,}".format(marquee_pairs) + ", about " + str(marquee_pairs // 365)
        + " years of one featured game a day before any pairing would have to repeat.")
    add("")

    # -- Data rights -----------------------------------------------------------------
    add("## Data rights: owner to accept before launch")
    add("")
    add("The starting fives come from games started in the Kaggle dataset `sumitrodatta/nba-aba-baa-stats` "
        "(\"NBA Stats (1947-present)\"), which is **scraped from Basketball-Reference**. Sports Reference's terms "
        "of use forbid scraping its sites and any public or commercial use of the data without its written "
        "permission. Kaggle's CC0 label is the uploader's and does not clear Sports Reference's rights.")
    add("")
    add("- `teams.json` publishes no Basketball-Reference number. The choice of each five and the spelling of the "
        "names (with accents) come from it; PPG and signature stats come from the existing `PlayerStatistics.csv`.")
    add("- This joins the existing commercial-data question (`docs/product/HANDOFF.md`, \"Commercial-data gate\", "
        "F00). It is stricter: the terms cover public use, not only commercial use, and Daily Three is public.")
    add("- The owner must accept this, or get permission, before Daily Three launches (Session 5).")
    add("")

    # -- Starter evidence ------------------------------------------------------------
    add("## Who started? Games started (Q2)")
    add("")
    add("Each team's five is the 5 players with the most **games started** (GS) for it that season in "
        "Basketball-Reference's season totals (`data/raw/bbref/Player Totals.csv`). Ties go to minutes, a player "
        "needs " + str(MIN_TEAM_GAMES) + " games for the team, and a traded player counts only their rows for this "
        "team, never the 2TM/3TM season totals. GS is recorded for every season in the pool, 1985–86 to 2025–26.")
    add("")
    add("- **Teams** map to Basketball-Reference abbreviations by era-correct city and name (`Team Abbrev.csv`), "
        "or by nickname alone where the city differs (the 2005–06 and 2006–07 Oklahoma City Hornets, the 2025–26 "
        "LA Clippers). All " + str(len(index)) + " team-seasons map to exactly one.")
    add("- **Players** match `PlayerStatistics.csv` within the team-season by name: accents and punctuation "
        "dropped, Jr./Sr./II–IV ignored, then " + str(len(NAME_ALIASES)) + " aliases in `NAME_ALIASES` for "
        "nicknames and other spellings (\"Nenê\" / \"Nene Hilario\", \"Fat Lever\" / \"Lafayette Lever\", "
        "\"Yi Jianlian\" / \"Jianlian Yi\"). Every starter must match exactly one player, or the script stops.")
    unmatched = pool["unmatched"]
    add("- **Unmatched players** among each team's top " + str(REPORT_UNMATCHED) + " by GS, over all "
        + str(len(index)) + " team-seasons: " + (str(len(unmatched)) + ". None of them is a starter." if unmatched else "none.")
        + " They are missing from `PlayerStatistics.csv`, so they cannot carry stats.")
    if unmatched:
        add("")
        add("| Team | Player | Games | GS |")
        add("|---|---|---|---|")
        for key, player, g, gs in unmatched:
            add("| `" + key + "` | " + player + " | " + str(g) + " | " + str(gs) + " |")
    add("")

    # -- Cross-checks ----------------------------------------------------------------
    add("## Cross-checks: the earlier rules against games started")
    add("")
    add("The first version of this PR picked fives with three rules, each season taking the first it supported. "
        "They now only check games started:")
    add("")
    add("- **Starter flag**: `PlayerStatistics.csv`'s `startingPosition`, set for exactly 5 players a team-game "
        "only from 2017–18 on, and not in 2021–22 (from 1996–97 to 2016–17 it is filled for about 9 players a "
        "team-game; before that and in 2021–22 it is blank).")
    add("- **Bench-points inference**: in each game the starters' points must add up to the team's score less "
        "its bench points (`TeamStatisticsExtended.csv`, usable from 2003–04; from 1996–97 to 2002–03 its "
        "`benchPoints` holds the whole team score).")
    add("- **Minutes proxy**: the 5 highest-minute players in each game stand in for the starters.")
    add("")
    add("| Seasons | Flag share | Bench share | First version's rule |")
    add("|---|---|---|---|")
    for run in season_runs(methods):
        def share(d):
            vals = [d.get(s, 0) for s in run]
            lo, hi = min(vals), max(vals)
            return "{:.0%}".format(lo) if round(lo, 2) == round(hi, 2) else "{:.0%}".format(lo) + "–" + "{:.0%}".format(hi)
        span = label(run[0]) if len(run) == 1 else label(run[0]) + " to " + label(run[-1])
        add("| " + span + " | " + share(pool["flags"]) + " | " + share(pool["bench"]) + " | " + methods[run[0]] + " |")
    add("")
    add("**Every team-season** (" + str(len(checks)) + "), wherever each rule can run:")
    add("")
    agreement_table(checks, add)
    add("**Pool teams** (" + str(len(pool_checks)) + "):")
    add("")
    agreement_table(pool_checks, add)

    add("**Against the first version's own fives.** Pool teams by the rule the first version used for them, "
        "before overrides:")
    add("")
    add("| First version's rule | Pool teams | Same five as games started |")
    add("|---|---|---|")
    for m in (CHECK_FLAG, CHECK_BENCH, CHECK_PROXY):
        sub = pool_checks[pool_checks["previous"] == m]
        same = int((sub[m] == 0).sum())
        add("| " + m + " | " + str(len(sub)) + " | " + str(same) + " (" + ("{:.0%}".format(same / len(sub)) if len(sub) else "—") + ") |")
    add("")
    for m in (CHECK_FLAG, CHECK_BENCH):
        diff = pool_checks[(pool_checks["previous"] == m) & (pool_checks[m] > 0)]
        if diff.empty:
            continue
        add("Pool teams where the " + {CHECK_FLAG: "starter flag", CHECK_BENCH: "bench-points inference"}[m]
            + " and games started disagree (GS in brackets):")
        add("")
        for _, r in diff.iterrows():
            add("- `" + r["key"] + "`: games started take " + with_gs(r["key"], [i for i in r["gs_ids"] if i not in r[m + "_ids"]])
                + "; the " + m + " rule took " + with_gs(r["key"], [i for i in r[m + "_ids"] if i not in r["gs_ids"]]) + ".")
        add("")

    # -- Changed fives ---------------------------------------------------------------
    changed = pool_checks[pool_checks.apply(lambda r: r[r["previous"]] > 0, axis=1)]
    add("## Fives that changed from the first version")
    add("")
    add("Pool teams whose games-started five differs from the five the first version's rule gave: "
        + str(len(changed)) + " teams, compared by player, not spelling. GS in brackets. ✔ marks a five the "
        "overrides file fixes, so its card did not change.")
    if "1996-bulls" in set(changed["key"]):
        add("")
        add("The first version fixed `1996-bulls` in the overrides file to Harper, Jordan, Pippen, Rodman and "
            "Longley. Games started give that five, so the override is gone and the card is unchanged.")
    add("")
    add("| Team | First version's rule | In | Out | Fixed |")
    add("|---|---|---|---|---|")
    for _, r in changed.iterrows():
        m = r["previous"]
        add("| `" + r["key"] + "` | " + m + " | " + with_gs(r["key"], [i for i in r["gs_ids"] if i not in r[m + "_ids"]])
            + " | " + with_gs(r["key"], [i for i in r[m + "_ids"] if i not in r["gs_ids"]])
            + " | " + ("✔" if r["key"] in overridden else "") + " |")
    add("")
    moved = checks[checks["in_pool"] != checks["prev_in_pool"]]
    add(("**The pool.** The notable-star rule looks at the five, so a new five can move a team in or out. "
        + ("Left the pool: " + "; ".join("`" + r["key"] + "` (its old five's " + r["prev_stars"] + ")"
                                         for _, r in moved[moved["prev_in_pool"]].iterrows()) + ". "
           if moved["prev_in_pool"].any() else "")
        + ("Joined: " + "; ".join("`" + r["key"] + "` (" + r["stars"] + ")"
                                  for _, r in moved[moved["in_pool"]].iterrows()) + ". "
           if moved["in_pool"].any() else "")
        + ("No team moved." if moved.empty else "")).rstrip())
    add("")

    # -- Close calls -----------------------------------------------------------------
    close = [k for k in teams if details[k]["auto"]["gap"] < UNCERTAIN_GAP]
    add("## Close calls")
    add("")
    add("Pool teams where the 6th player's games started came within " + "{:.0%}".format(UNCERTAIN_GAP)
        + " of the team's games of the 5th's: usually a mid-season lineup change or an injury. " + str(len(close))
        + " of " + str(len(teams)) + ". A 0% gap is a tie in games started, broken by minutes.")
    add("")
    add("| Team | 5th (GS) | 6th (GS) | Gap | Fixed |")
    add("|---|---|---|---|---|")
    for key in close:
        auto = details[key]["auto"]
        fifth, sixth = auto["fifth"], auto["sixth"]
        add("| `" + key + "` | " + fifth[1] + " (" + str(fifth[2]) + ") | "
            + (sixth[1] + " (" + str(sixth[2]) + ")" if sixth is not None else "—") + " | "
            + "{:.0%}".format(auto["gap"]) + " | " + ("✔" if key in overridden else "") + " |")
    add("")

    # -- Scorers outside the five ----------------------------------------------------
    add("## Leading scorers outside the five")
    add("")
    add("Pool teams where one of the team's top " + str(REPORT_TOP_SCORERS) + " scorers (PPG, " + str(MIN_TEAM_GAMES)
        + "+ games) is not in the five. Usually injuries or a bench scorer; the five stays as games started give it "
        "unless the owner fixes it. The 1997–98 Bulls are the famous case: Toni Kukoč started more games than an "
        "injured Scottie Pippen.")
    add("")
    add("| Team | Scorer: PPG, games, GS | Fewest GS in the five |")
    add("|---|---|---|")
    for key in teams:
        d = details[key]
        roster = d["roster"]
        eligible = roster[roster["games"] >= MIN_TEAM_GAMES].assign(ppg=lambda r: r["pts"] / r["games"])
        top = eligible.sort_values(["ppg", "personId"], ascending=[False, True]).head(REPORT_TOP_SCORERS)
        out = top[~top["personId"].isin(d["ids"])]
        if out.empty:
            continue
        five = roster[roster["personId"].isin(d["ids"])]
        low = five.sort_values(["gs", "personId"]).iloc[0]
        add("| `" + key + "` | " + "; ".join(full_name(p) + ": " + "%.1f" % p["ppg"] + ", " + str(int(p["games"])) + " g, "
                                            + ("—" if pd.isna(p["gs"]) else str(int(p["gs"]))) + " GS" for _, p in out.iterrows())
            + " | " + full_name(low) + " (" + ("—" if pd.isna(low["gs"]) else str(int(low["gs"]))) + ") |")
    add("")

    # -- Overrides -------------------------------------------------------------------
    add("## Overrides in use")
    add("")
    used = False
    for key in teams:
        d = details[key]
        if d["method"] == METHOD_OVERRIDE:
            used = True
            note = pool_override_note(key)
            add("- `" + key + "`: five fixed to " + names(key, d["ids"]) + ". Games started gave "
                + with_gs(key, d["auto"]["ids"]) + "." + (" " + note if note else ""))
        if REASON_PIN in teams[key]["reasons"]:
            used = True
            add("- `" + key + "`: pinned to " + teams[key]["tier"] + ".")
    if not used:
        add("None.")
    add("")

    # -- Data notes ------------------------------------------------------------------
    pool_gaps = [g for g in pool["gaps"] if g[0] in teams]
    accented = sorted({s["name"] for t in teams.values() for s in t["starters"] if not s["name"].isascii()})
    add("## Data notes")
    add("")
    add("- **Missing games.** " + str(len(pool["gaps"])) + " team-seasons have up to " + str(MAX_MISSING_GAMES)
        + " fewer games in the player file than `index.json` counts, " + str(len(pool_gaps)) + " of them in the pool"
        + (": " + ", ".join("`" + k + "` (" + str(a) + " of " + str(b) + ")" for k, a, b in pool_gaps) if pool_gaps else "")
        + ". Per-game stats use the games the player file has.")
    add("- **Names** use Basketball-Reference's spelling, in UTF-8 (\"J.R. Smith\", \"Toni Kukoč\"). Pool starters "
        "with non-ASCII letters: " + (", ".join(accented) if accented else "none") + ".")
    add("- **Regular season** is every game whose id starts with 2, including NBA Cup group and knockout games "
        "(they count in the standings) and not the Cup final. About half of 2000–01's player rows have no team "
        "id; they are matched by team name.")
    add("- **Signature stats are league-relative.** A 1980s guard's 0.3 threes a game can clear the "
        + "{:.0%}".format(SIG_PERCENTILE) + " bar because few players shot threes then.")
    add("")

    # -- Champions -------------------------------------------------------------------
    add("## Champions by season (check by eye)")
    add("")
    add("From the last playoff game of each season in `Games.csv`. Playoff games take the calendar year they "
        "were played in, so the October 2020 bubble Finals give 2019–20 to the Lakers.")
    add("")
    add("| Season | Champion | Record |")
    add("|---|---|---|")
    for season, key in sorted(pool["champions"].items()):
        t = idx.loc[key]
        add("| " + label(season) + " | " + t["city"] + " " + t["name"] + " (`" + key + "`) | "
            + str(int(t["wins"])) + "–" + str(int(t["losses"])) + " |")
    add("")

    # -- Pool by tier ----------------------------------------------------------------
    for tier in TIERS:
        keys = [k for k in teams if teams[k]["tier"] == tier]
        add("## " + tier.capitalize() + " tier (" + str(len(keys)) + ")")
        add("")
        add("| Team | Record | Win % | Reasons | Five from |")
        add("|---|---|---|---|---|")
        for key in keys:
            t, d = teams[key], details[key]
            reasons = list(t["reasons"])
            if REASON_STAR in reasons:
                roster = d["roster"].set_index("personId")
                stars = "; ".join(full_name(roster.loc[pid]) + " " + ", ".join(bits) for pid, bits in d["stars"])
                reasons[reasons.index(REASON_STAR)] = REASON_STAR + " (" + stars + ")"
            add("| " + era_name(d["team"]) + " (`" + key + "`) | " + str(t["wins"]) + "–" + str(t["losses"])
                + " | " + ("%.3f" % d["team"]["win_pct"]).lstrip("0") + " | " + ", ".join(reasons)
                + " | " + d["method"] + " |")
        add("")

    # -- Every five ------------------------------------------------------------------
    add("## Every starting five")
    add("")
    add("Ordered guards to centers (`Players.csv` flags), then by PPG. Each starter shows PPG and up to "
        + str(SIG_MAX) + " signature stats with their league percentile, games for the team, and games started "
        "(GS). Bench is the team's points per game not scored by these five; 3PA rate is the team's threes per shot.")
    add("")
    for key in sorted(teams, key=lambda k: (idx.loc[k, "season"], k)):
        t, d = teams[key], details[key]
        add("### " + era_name(d["team"]) + " · " + str(t["wins"]) + "–" + str(t["losses"]) + " · " + t["tier"]
            + " · five from " + d["method"])
        add("")
        for s in d["starters"]:
            sig = ", ".join(fmt_sig(x) + " (" + "{:.0%}".format(p) + ")" for x, p in zip(s["sig"], s["_pctile"]))
            add("- " + s["name"] + ": " + "%.1f" % s["ppg"] + " PPG, " + sig + " · " + str(s["_games"]) + " g, "
                + ("—" if s["_gs"] is None else str(s["_gs"])) + " GS")
        add("- Bench: " + "%.1f" % t["benchPpg"] + " PPG"
            + (" · 3PA rate " + ("%.3f" % t["threeRate"]).lstrip("0") if "threeRate" in t else ""))
        add("")

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def pool_override_note(key: str) -> str:
    try:
        return load_overrides()["starters"].get(key, {}).get("note", "")
    except (OSError, ValueError):
        return ""


def season_runs(methods: dict) -> list:
    """Consecutive seasons that share a rule."""
    runs = []
    for season in sorted(methods):
        if runs and methods[runs[-1][-1]] == methods[season] and runs[-1][-1] == season - 1:
            runs[-1].append(season)
        else:
            runs.append([season])
    return runs


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    with open(INDEX_PATH, encoding="utf-8") as f:
        release = json.load(f)["release"]
    index     = load_index()
    overrides = load_overrides()
    print("Index teams: " + str(len(index)))

    games = pd.read_csv(GAMES_PATH, usecols=["gameId", "gameDateTimeEst", "gameType", "winner"], low_memory=False)
    champions = derive_champions(games, index)
    print("Champions: " + str(len(champions)))

    bbref   = load_bbref_totals(sorted(set(index["season"])))
    abbrevs = load_team_abbrevs()
    player_games = add_bench_inferred_starts(load_player_games(index), load_bench_targets(), index)
    pool = build_pool(index, player_games, bbref, abbrevs, champions, overrides, load_positions())
    validate_pool(pool, index)

    write_teams_json(pool, release, OUTPUT_PATH)
    write_report(pool, index, REPORT_PATH)

    tiers = pd.Series([t["tier"] for t in pool["teams"].values()]).value_counts().to_dict()
    print("Pool: " + str(len(pool["teams"])) + " teams " + str(tiers))
    checks = pd.DataFrame(pool["checks"])
    checks = checks[checks["key"].isin(pool["teams"])]
    for method in (CHECK_FLAG, CHECK_BENCH, CHECK_PROXY):
        sub = checks[checks["previous"] == method]
        print("Pool teams the first version gave to " + method + ": " + str(len(sub))
              + ", same five as games started: " + str(int((sub[method] == 0).sum())))
    print("Unmatched players in a top " + str(REPORT_UNMATCHED) + " by GS: " + str(len(pool["unmatched"])))
    print("Saved: " + str(OUTPUT_PATH))
    print("Saved: " + str(REPORT_PATH))


if __name__ == "__main__":
    main()
