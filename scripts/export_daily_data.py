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

Starting five. PlayerStatistics.csv marks starters (startingPosition) only
from 2017-18 on, and not in 2021-22; in 1996-97 to 2016-17 the column is
filled for about 9 players per team-game, so it is not a starter flag there,
and before that it is blank. Each season uses the first method it supports:
  starts         the flag: at least FLAG_SEASON_SHARE of team-games flag
                 exactly 5 players. The five with the most starts
  bench-points   TeamStatisticsExtended.csv records bench points from
                 2003-04 on (before that the column holds the whole team
                 score), so in each game the starters' points must add
                 up to teamScore - benchPoints. Of the 5-player subsets that
                 do, take the one with the most minutes; then repeat,
                 preferring players the first pass usually started. The five
                 with the most inferred starts. Checked against the flag in
                 2017-18 on (reports/daily_pool.md)
  minutes-proxy  in each game the team's 5 highest-minute players stand in
                 for its starters; the five with the most such games
Ties go to total minutes. Only games played for that team count, and a player
needs MIN_TEAM_GAMES of them. The overrides file can fix a five outright.

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
  data/raw/TeamStatisticsExtended.csv    team score and bench points per game (usable 2003-04 on)
  scripts/daily_pool_overrides.json      owner pins, exclusions, fixed fives

Writes
  frontend/public/data/daily/teams.json  the pool (pool teams only)
  reports/daily_pool.md                  champions, pool by tier, every five, uncertain fives

Run from repo root:
    python scripts/export_daily_data.py
"""

import itertools
import json
import sys
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

REPO_ROOT      = Path(__file__).resolve().parents[1]
INDEX_PATH     = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
PLAYERS_PATH   = REPO_ROOT / "data" / "raw" / "PlayerStatistics.csv"
PEOPLE_PATH    = REPO_ROOT / "data" / "raw" / "Players.csv"
GAMES_PATH     = REPO_ROOT / "data" / "raw" / "Games.csv"
TEAM_STATS_PATH = REPO_ROOT / "data" / "raw" / "TeamStatisticsExtended.csv"
OVERRIDES_PATH = REPO_ROOT / "scripts" / "daily_pool_overrides.json"
OUTPUT_PATH    = REPO_ROOT / "frontend" / "public" / "data" / "daily" / "teams.json"
REPORT_PATH    = REPO_ROOT / "reports" / "daily_pool.md"

# Pool and tiers
MARQUEE_WIN_PCT   = 0.750   # about 62 wins
POOL_WIN_PCT      = 0.680   # about 56 wins
STAR_PPG_RANK     = 5
STAR_BOARD_RANK   = 3       # RPG or APG
STAR_TEAM_WIN_PCT = 0.550

# Starting five
MIN_TEAM_GAMES    = 20
FLAG_SEASON_SHARE  = 0.99    # share of team-games flagging exactly 5 starters
BENCH_SEASON_SHARE = 0.90    # share of team-games whose starters bench points can infer
PRIOR_WEIGHT       = 1000.0  # bench-points second pass: usual starters before minutes
UNCERTAIN_GAP     = 0.15    # proxy fives: 5th minus 6th place, as a share of team games
MAX_MISSING_GAMES = 2       # team games index.json counts that PlayerStatistics.csv lacks

# Signature stats
QUALIFY_GAME_SHARE = 0.5    # of the season's games (median team)
QUALIFY_MPG        = 15.0
SIG_PERCENTILE     = 0.80
SIG_MAX            = 2
FG_MIN_FGA         = 5.0    # per game, for FG%
THREE_MIN_3PA      = 2.0    # per game, for 3P%

REGULAR_SEASON_PREFIX = "2"   # NBA game ids: 2 regular season (Cup games included)

TIER_MARQUEE = "marquee"
TIER_KNOWN   = "known"
TIERS        = (TIER_MARQUEE, TIER_KNOWN)

REASON_CHAMPION  = "champion"
REASON_VERY_HIGH = "very-high-win"
REASON_HIGH      = "high-win"
REASON_STAR      = "notable-star"
REASON_PIN       = "owner-pin"

METHOD_FLAG     = "starts"
METHOD_BENCH    = "bench-points"
METHOD_PROXY    = "minutes-proxy"
METHOD_OVERRIDE = "override"

# The player_team_seasons column each method ranks by.
METHOD_SCORE = {METHOD_FLAG: "starts", METHOD_BENCH: "inferred", METHOD_PROXY: "top5"}

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

def rank_starters(roster: pd.DataFrame, method: str, min_games: int = MIN_TEAM_GAMES) -> pd.DataFrame:
    """
    A team-season's eligible players (min_games or more), best starter
    candidates first by the method's count (METHOD_SCORE); ties by total
    minutes, then personId.
    """
    eligible = roster[roster["games"] >= min_games].copy()
    eligible["score"] = eligible[METHOD_SCORE[method]]
    return eligible.sort_values(["score", "minutes", "personId"], ascending=[False, False, True])


def pick_five(roster: pd.DataFrame, method: str, games: int, min_games: int = MIN_TEAM_GAMES) -> dict:
    """
    The starting five for one team-season (rows of player_team_seasons).
    Returns personIds, the method, and how close the 6th player came: gap is
    (5th score - 6th score) / team games.
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
    by_name = {full_name(r): int(r["personId"]) for _, r in roster.iterrows()}
    unknown = [n for n in names if n not in by_name]
    if unknown:
        raise ValueError("Override for " + key + " names players who did not play for it: " + str(unknown))
    return {"ids": [by_name[n] for n in names], "method": METHOD_OVERRIDE, "gap": None, "fifth": None, "sixth": None}


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
            found.append((int(r["personId"]), bits))
    return found


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
    """{season: the first starting-five method the season supports}."""
    out = {}
    for season in sorted(set(flags) | set(bench)):
        if flags.get(season, 0) >= FLAG_SEASON_SHARE:
            out[season] = METHOD_FLAG
        elif bench.get(season, 0) >= BENCH_SEASON_SHARE:
            out[season] = METHOD_BENCH
        else:
            out[season] = METHOD_PROXY
    return out


def build_pool(index, player_games, champions, overrides, positions) -> dict:
    """player_games must carry add_bench_inferred_starts' columns."""
    flags     = flagged_seasons(player_games)
    bench     = bench_seasons(player_games)
    methods   = season_methods(flags, bench)
    rosters   = player_team_seasons(add_top5_minutes(player_games))
    league    = league_player_seasons(player_games)
    leaders   = league_leaders(league)
    n_games   = team_games(player_games)

    unknown = (set(overrides["pins"]) | set(overrides["exclude"]) | set(overrides["starters"])) - set(index["key"])
    if unknown:
        raise ValueError("Overrides name keys that are not in index.json: " + str(sorted(unknown)))

    champion_keys = set(champions.values())
    teams, details, checks, gaps = {}, {}, [], []
    by_key = {k: g for k, g in rosters.groupby("key")}

    for team in index.sort_values(["season", "key"]).to_dict("records"):
        key, season = team["key"], int(team["season"])
        roster = by_key.get(key)
        if roster is None:
            raise ValueError("No player rows for " + key)
        games = int(n_games[key])
        if games != team["games"]:
            if abs(games - team["games"]) > MAX_MISSING_GAMES:
                raise ValueError(key + ": " + str(games) + " games in PlayerStatistics.csv, "
                                 + str(team["games"]) + " in index.json.")
            gaps.append((key, games, int(team["games"])))

        auto = pick_five(roster, methods[season], games)
        if methods[season] == METHOD_FLAG:
            # The flag is the truth here, so both other methods can be checked against it.
            check = {"key": key, "season": season, "flag_ids": auto["ids"]}
            for method in (METHOD_BENCH, METHOD_PROXY):
                if method == METHOD_BENCH and bench.get(season, 0) < BENCH_SEASON_SHARE:
                    continue
                ids = pick_five(roster, method, games)["ids"]
                check[method] = len(set(auto["ids"]) - set(ids))
                check[method + "_ids"] = ids
            checks.append(check)

        five = override_five(roster, overrides["starters"][key]["players"], key) if key in overrides["starters"] else auto
        stars = star_reasons(five["ids"], season, leaders)
        tier, reasons = classify(team, key in champion_keys, bool(stars))
        tier, reasons = apply_overrides(tier, reasons, key, overrides)
        if tier is None:
            continue

        teams[key], details[key] = build_team_entry(team, roster, five, games, league, positions, tier, reasons)
        details[key].update({"auto": auto, "stars": stars, "roster": roster})

    missing = set(overrides["starters"]) - set(teams)
    if missing:
        raise ValueError("Overrides fix fives for teams outside the pool: " + str(sorted(missing)))
    return {"teams": teams, "details": details, "flags": flags, "bench": bench, "methods": methods,
            "checks": checks, "champions": champions, "gaps": gaps}


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
            "_count":  {m: int(p[col]) for m, col in METHOD_SCORE.items()},
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
    return entry, {"method": five["method"], "starters": starters, "team": team}


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


def write_report(pool: dict, index: pd.DataFrame, path: Path = REPORT_PATH) -> None:
    teams, details, methods = pool["teams"], pool["details"], pool["methods"]
    idx = index.set_index("key")
    lines = []
    add = lines.append

    def label(season):
        return str(season - 1) + "–" + str(season)[2:]

    def names(key, ids):
        roster = details[key]["roster"].set_index("personId") if key in details else None
        return ", ".join(full_name(roster.loc[i]) for i in ids)

    tier_counts = {t: sum(1 for v in teams.values() if v["tier"] == t) for t in TIERS}
    by_method = {m: [k for k in teams if details[k]["auto"]["method"] == m] for m in METHOD_SCORE}
    checks = pd.DataFrame(pool["checks"])
    marquee_pairs = tier_counts[TIER_MARQUEE] * (tier_counts[TIER_MARQUEE] - 1) // 2

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
    add("| Five from the starter flag | " + str(len(by_method[METHOD_FLAG])) + " |")
    add("| Five from bench-points inference | " + str(len(by_method[METHOD_BENCH])) + " |")
    add("| Five from the minutes proxy | " + str(len(by_method[METHOD_PROXY])) + " |")
    add("| Five fixed in the overrides file | " + str(sum(1 for k in teams if details[k]["method"] == METHOD_OVERRIDE)) + " |")
    add("")
    add("Possible pairings: " + "{:,}".format(len(teams) * (len(teams) - 1) // 2) + ". Featured (marquee vs marquee) "
        "pairings: " + "{:,}".format(marquee_pairs) + ", about " + str(marquee_pairs // 365)
        + " years of one featured game a day before any pairing would have to repeat.")
    add("")

    # -- Starter evidence ----------------------------------------------------------
    add("## Who started? The evidence (Q2)")
    add("")
    add("`PlayerStatistics.csv` has one starter column, `startingPosition` (G, F or C). It has no other position "
        "column; `Players.csv` has guard, forward and center flags, used here only to order each card. Every "
        "season from 1985–86 to 2025–26 is present.")
    add("")
    add("- **Flag share**: team-games that flag exactly 5 starters. From 1996–97 to 2016–17 the column is filled "
        "for about 9 players per team-game, so it is not a starter flag there.")
    add("- **Bench share**: team-games where `TeamStatisticsExtended.csv` records bench points and a 5-player "
        "subset's points add up to the team score minus them. From 1996–97 to 2002–03 the file's `benchPoints` "
        "holds the team's whole score (a 108-point Lakers game records 108 bench points), so it cannot be used.")
    add("")
    add("| Seasons | Flag share | Bench share | Five from |")
    add("|---|---|---|---|")
    for run in season_runs(methods):
        def share(d):
            vals = [d.get(s, 0) for s in run]
            lo, hi = min(vals), max(vals)
            return "{:.0%}".format(lo) if round(lo, 2) == round(hi, 2) else "{:.0%}".format(lo) + "–" + "{:.0%}".format(hi)
        span = label(run[0]) if len(run) == 1 else label(run[0]) + " to " + label(run[-1])
        add("| " + span + " | " + share(pool["flags"]) + " | " + share(pool["bench"]) + " | " + methods[run[0]] + " |")
    add("")
    add("Each season uses the first method it supports: the flag (at least " + "{:.0%}".format(FLAG_SEASON_SHARE)
        + " flag share), then bench points (at least " + "{:.0%}".format(BENCH_SEASON_SHARE)
        + " bench share), then the minutes proxy.")
    add("")
    add("**Bench-points inference.** In each game the starters' points must add up to the team's score less "
        "its bench points. Usually several 5-player subsets do; the first pass takes the one with the most "
        "minutes, the second prefers players the first pass usually started (then minutes). The season's five "
        "are the five with the most inferred starts.")
    add("")
    if not checks.empty:
        add("**Checked against the real flag.** In the flagged seasons every method can run, so each one can be "
            "scored against the real starters, over every team (not only the pool):")
        add("")
        add("| Starters wrong | Bench-points inference | Minutes proxy (the brief's rule) |")
        add("|---|---|---|")
        cols = [m for m in (METHOD_BENCH, METHOD_PROXY) if m in checks.columns]
        n = {m: int(checks[m].notna().sum()) for m in cols}
        for wrong in range(0, int(max(checks[c].max() for c in cols)) + 1):
            cells = []
            for m in (METHOD_BENCH, METHOD_PROXY):
                if m not in cols:
                    cells.append("—")
                    continue
                k = int((checks[m] == wrong).sum())
                cells.append(str(k) + " (" + "{:.0%}".format(k / n[m]) + ")")
            add("| " + str(wrong) + " | " + " | ".join(cells) + " |")
        add("")
        if METHOD_BENCH in cols:
            exact = {m: (checks[m] == 0).mean() for m in cols}
            add("Bench points get the whole five right for " + "{:.0%}".format(exact[METHOD_BENCH])
                + " of team-seasons, the minutes proxy for " + "{:.0%}".format(exact[METHOD_PROXY])
                + ". The proxy's misses are what the brief predicted: a heavy-minute sixth man in place of a "
                "low-minute starter.")
            add("")
        wrong_pool = checks[checks["key"].isin(teams)]
        if METHOD_BENCH in cols:
            wrong_pool = wrong_pool[wrong_pool[METHOD_BENCH] > 0]
            if not wrong_pool.empty:
                add("Pool teams in flagged seasons where bench points would have been wrong (they use the flag):")
                add("")
                for _, r in wrong_pool.iterrows():
                    add("- `" + r["key"] + "`: " + names(r["key"], [i for i in r[METHOD_BENCH + "_ids"] if i not in r["flag_ids"]])
                        + " instead of " + names(r["key"], [i for i in r["flag_ids"] if i not in r[METHOD_BENCH + "_ids"]]))
                add("")

    # -- The proxy seasons -----------------------------------------------------------
    add("## Proxy fives to check by eye (the owner decides Q2)")
    add("")
    proxy_spans = ", ".join(label(r[0]) if len(r) == 1 else label(r[0]) + " to " + label(r[-1])
                            for r in season_runs(methods) if methods[r[0]] == METHOD_PROXY)
    add("These pool teams play in seasons with neither a flag nor usable bench points (" + proxy_spans + "), "
        "so their five come from the minutes proxy, which picks the real five about "
        + ("{:.0%}".format((checks[METHOD_PROXY] == 0).mean()) if not checks.empty else "?")
        + " of the time. The 6th column is the next player by games in the team's top 5 for minutes. ✔ marks a "
        "five fixed in the overrides file.")
    add("")
    add("| Team | Proxy five | 6th | Fixed |")
    add("|---|---|---|---|")
    for key in by_method[METHOD_PROXY]:
        auto = details[key]["auto"]
        sixth = names(key, [auto["sixth"]]) if auto["sixth"] is not None else "—"
        add("| `" + key + "` | " + names(key, auto["ids"]) + " | " + sixth + " | "
            + ("✔ " + names(key, [i for i in teams_ids(teams[key], details[key])]) if details[key]["method"] == METHOD_OVERRIDE else "")
            + " |")
    add("")

    uncertain = [k for k in by_method[METHOD_BENCH] if details[k]["auto"]["gap"] < UNCERTAIN_GAP]
    add("## Close calls among the bench-points fives")
    add("")
    add("Bench-points pool teams where the 6th player's inferred starts came within " + "{:.0%}".format(UNCERTAIN_GAP)
        + " of the team's games of the 5th: usually a mid-season lineup change. " + str(len(uncertain)) + " of "
        + str(len(by_method[METHOD_BENCH])) + ".")
    add("")
    add("| Team | 5th (inferred starts) | 6th | Gap | Fixed |")
    add("|---|---|---|---|---|")
    for key in uncertain:
        auto = details[key]["auto"]
        roster = details[key]["roster"].set_index("personId")
        fifth = roster.loc[auto["fifth"]]
        sixth = roster.loc[auto["sixth"]] if auto["sixth"] is not None else None
        add("| `" + key + "` | " + full_name(fifth) + " (" + str(int(fifth["inferred"])) + ") | "
            + (full_name(sixth) + " (" + str(int(sixth["inferred"])) + ")" if sixth is not None else "—") + " | "
            + "{:.0%}".format(auto["gap"]) + " | " + ("✔" if details[key]["method"] == METHOD_OVERRIDE else "") + " |")
    add("")

    # -- Overrides -----------------------------------------------------------------
    add("## Overrides in use")
    add("")
    used = False
    for key in teams:
        d = details[key]
        if d["method"] == METHOD_OVERRIDE:
            used = True
            note = pool_override_note(key)
            add("- `" + key + "`: five fixed to " + names(key, teams_ids(teams[key], d)) + ". The "
                + d["auto"]["method"] + " rule gave " + names(key, d["auto"]["ids"]) + "." + (" " + note if note else ""))
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
    add("- **Names** are written as the source spells them, in UTF-8. The source mostly drops accents (\"Toni Kukoc\", "
        "\"Manu Ginobili\", \"Nikola Jokic\") and writes some initials without dots (\"JR Smith\"). Pool starters "
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
        + str(SIG_MAX) + " signature stats with their league percentile, games for the team, and the count the "
        "five was chosen by (starts, inferred starts, or games in the team's top 5 by minutes). Bench is the "
        "team's points per game not scored by these five; 3PA rate is the team's threes per shot.")
    add("")
    count_word = {METHOD_FLAG: "starts", METHOD_BENCH: "inferred starts", METHOD_PROXY: "top-5 games"}
    for key in sorted(teams, key=lambda k: (idx.loc[k, "season"], k)):
        t, d = teams[key], details[key]
        method = d["auto"]["method"]
        add("### " + era_name(d["team"]) + " · " + str(t["wins"]) + "–" + str(t["losses"]) + " · " + t["tier"]
            + " · five from " + d["method"])
        add("")
        for s in d["starters"]:
            sig = ", ".join(fmt_sig(x) + " (" + "{:.0%}".format(p) + ")" for x, p in zip(s["sig"], s["_pctile"]))
            add("- " + s["name"] + ": " + "%.1f" % s["ppg"] + " PPG, " + sig + " · " + str(s["_games"]) + " g, "
                + str(s["_count"][method]) + " " + count_word[method])
        add("- Bench: " + "%.1f" % t["benchPpg"] + " PPG"
            + (" · 3PA rate " + ("%.3f" % t["threeRate"]).lstrip("0") if "threeRate" in t else ""))
        add("")

    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def teams_ids(team: dict, detail: dict) -> list:
    """personIds of a pool team's exported five, in card order."""
    roster = detail["roster"]
    by_name = {full_name(r): int(r["personId"]) for _, r in roster.iterrows()}
    return [by_name[s["name"]] for s in team["starters"]]


def pool_override_note(key: str) -> str:
    try:
        return load_overrides()["starters"].get(key, {}).get("note", "")
    except (OSError, ValueError):
        return ""


def season_runs(methods: dict) -> list:
    """Consecutive seasons that share a starting-five method."""
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

    player_games = add_bench_inferred_starts(load_player_games(index), load_bench_targets(), index)
    pool = build_pool(index, player_games, champions, overrides, load_positions())
    validate_pool(pool, index)

    write_teams_json(pool, release, OUTPUT_PATH)
    write_report(pool, index, REPORT_PATH)

    tiers = pd.Series([t["tier"] for t in pool["teams"].values()]).value_counts().to_dict()
    print("Pool: " + str(len(pool["teams"])) + " teams " + str(tiers))
    for method in (METHOD_FLAG, METHOD_BENCH, METHOD_PROXY):
        seasons = sorted(s for s, m in pool["methods"].items() if m == method)
        print("Seasons using " + method + ": " + str(seasons))
    print("Saved: " + str(OUTPUT_PATH))
    print("Saved: " + str(REPORT_PATH))


if __name__ == "__main__":
    main()
