"""
corpus.py

Chunk builders for Ask the Court (F13 Session 1), and the model-input file
behind the "why" decomposition. scripts/build_rag_corpus.py calls these; the
tests call them on small frames.

Every chunk is a dict with the same fields, in this order:

    id        stable, unique: team:<key>, season:<year>, leaders:<list>:<era>,
              method:<slug>
    type      team_card | season_card | leaderboard | method
    title     human-readable title, shown as the citation
    keys      team-season keys the chunk is about (index.json keys)
    seasons   seasons the chunk covers (the year each season ended)
    text      the text that is embedded, keyword-indexed and shown
    release   the simulator release the numbers belong to
    source    where the numbers come from

The hist-v2 classifier is a Pipeline (median imputer, standard scaler, L1
logistic regression) over z-score differences, home minus away. Only two
weights are non-zero, so the scaler folds into an exact linear form:

    logit P(home wins) = intercept + sum_f w_f * (z_home_f - z_away_f)
    w_f       = coef_f / scale_f
    intercept = b - sum_f coef_f * mean_f / scale_f

The imputer never acts, because no served profile has a missing value in a
non-zero feature (checked in build_model_inputs).
"""

import json
import math
import re
from pathlib import Path

import numpy as np
import pandas as pd

from src.rag import textfmt as fmt

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# First season whose advanced stats are the NBA's own (1996-97). Earlier
# seasons are rebuilt from the box score (F11, reports/older_seasons_backtest.md).
FIRST_NBA_ADVANCED_SEASON = 1997

# Stats on a team card: (column, label, formatter, higher_is_better, unit).
# higher_is_better=None means the stat has no good direction (pace).
CARD_STATS = [
    ("regular_net_rating",                               "Net rating",              "signed", True,  " per 100 possessions"),
    ("regular_offensive_rating",                         "Offensive rating",        "rating", True,  " scored per 100 possessions"),
    ("regular_defensive_rating",                         "Defensive rating",        "rating", False, " allowed per 100 possessions, lower is better"),
    ("regular_pace",                                     "Pace",                    "rating", None,  " possessions per 48 minutes"),
    ("regular_true_shooting_percentage",                 "True shooting",           "frac3",  True,  ""),
    ("regular_effective_field_goal_percentage",          "Effective field goal %",  "frac3",  True,  ""),
    ("regular_three_pt_pct",                             "Three-point %",           "frac3",  True,  ""),
    ("regular_opponent_effective_field_goal_percentage", "Opponent effective field goal %", "frac3", False, ", lower is better"),
    ("regular_team_turnover_percentage",                 "Turnover %",              "pct1",   False, " of possessions, lower is better"),
    ("regular_opponent_turnover_percentage",             "Forced turnover %",       "pct1",   True,  " of opponent possessions"),
    ("regular_assist_percentage",                        "Assist %",                "pct1",   True,  " of field goals assisted"),
]
CARD_STAT_COLUMNS = [c[0] for c in CARD_STATS]

FORMATTERS = {"signed": fmt.signed, "rating": fmt.rating, "frac3": fmt.frac3, "pct1": fmt.pct1}

# Leaderboards: (slug, title, column, rank_by, best_first). rank_by "z" ranks by
# the stat's z-score against its own league, "raw" by the value itself.
# best_first=True puts the highest rank_by value first.
LEADERBOARDS = [
    ("net-rating",        "Best net rating",                    "regular_net_rating",                               "z",   True),
    ("offence",           "Best offensive rating",              "regular_offensive_rating",                         "z",   True),
    ("defence",           "Best defensive rating",              "regular_defensive_rating",                         "z",   False),
    ("fastest",           "Fastest pace",                       "regular_pace",                                     "z",   True),
    ("slowest",           "Slowest pace",                       "regular_pace",                                     "z",   False),
    ("true-shooting",     "Best true shooting",                 "regular_true_shooting_percentage",                 "z",   True),
    ("three-point",       "Best three-point %",                 "regular_three_pt_pct",                             "z",   True),
    ("opponent-shooting", "Best defence against shooting (lowest opponent effective field goal %)",
                                                                "regular_opponent_effective_field_goal_percentage", "z",   False),
    ("forced-turnovers",  "Most forced turnovers",              "regular_opponent_turnover_percentage",             "z",   True),
    ("win-pct",           "Best regular-season win %",          "regular_win_pct",                                  "raw", True),
    ("worst-net-rating",  "Worst net rating",                   "regular_net_rating",                               "z",   False),
    ("worst-win-pct",     "Worst regular-season win %",         "regular_win_pct",                                  "raw", False),
]
LEADERBOARD_SIZE = 10

# Eras for leaderboards, by the year a season ended. "the 1990s" is seasons
# 1990-1999 (1989-90 to 1998-99), the same rule the entity linker uses.
ERAS = [
    ("all-time", None, None),
    ("1980s",    1986, 1989),
    ("1990s",    1990, 1999),
    ("2000s",    2000, 2009),
    ("2010s",    2010, 2019),
    ("2020s",    2020, 2026),
]

# Text that must never appear in the corpus (brief: "Never index"). Checked
# by check_corpus and by tests/test_rag_corpus.py.
FORBIDDEN_PATTERNS = [
    r"71\.04",
    r"basketball-reference",
    r"\bbbref\b",
    r"\bsportsbook",
    r"\bodds\b",
    r"\bbet(s|ting)?\b",
    r"\bwager",
    r"accura[^.\n]*\d+(\.\d+)?\s*%",   # an accuracy figure for the model
]
# Disclaimers that may contain a forbidden word. They are removed before the
# check, so the release manifest's own wording can be indexed as it stands.
ALLOWED_PHRASES = [
    "not a forecast or betting advice",
    "log-odds",
]

# Rough token estimate for the report (bge's WordPiece runs near 4 characters
# per token on this text). Session 2 replaces it with the real tokenizer.
CHARS_PER_TOKEN = 4


# ---------------------------------------------------------------------------
# Chunk helpers
# ---------------------------------------------------------------------------

def make_chunk(chunk_id: str, chunk_type: str, title: str, keys: list, seasons: list,
               text: str, release: str, source: str) -> dict:
    return {
        "id":      chunk_id,
        "type":    chunk_type,
        "title":   title,
        "keys":    list(keys),
        "seasons": [int(s) for s in seasons],
        "text":    text.strip(),
        "release": release,
        "source":  source,
    }


def format_stat(kind: str, value: float) -> str:
    return FORMATTERS[kind](value)


def season_ranks(profiles: pd.DataFrame, column: str, higher_is_better: bool | None) -> pd.Series:
    """Rank (1 = best, or fastest for pace) of each team within its season. Ties share the best rank."""
    ascending = higher_is_better is False
    return profiles.groupby("season")[column].rank(method="min", ascending=ascending).astype(int)


def team_title_of(row) -> str:
    return fmt.team_title(row["season"], row["era_city"], row["era_name"])


# ---------------------------------------------------------------------------
# Team cards
# ---------------------------------------------------------------------------

def playoff_sentence(row, champion: bool) -> str:
    label = fmt.season_label(row["season"])
    po = fmt.record(row["playoff_wins"], row["playoff_losses"])
    if champion:
        return "Won the " + label + " NBA championship, going " + po + " in the playoffs."
    if int(row["made_playoffs"]):
        return "Made the " + label + " playoffs and went " + po + " in them; did not win the title."
    if int(row["made_play_in"]):
        return "Reached the " + label + " play-in tournament but not the playoffs."
    return "Missed the " + label + " playoffs."


def build_team_cards(profiles: pd.DataFrame, champions: dict, model_inputs: dict,
                     short_seasons: dict, release: str) -> list[dict]:
    """One team_card chunk per team-season, ordered by key."""
    teams_per_season = profiles.groupby("season")["key"].transform("count")
    record_rank = season_ranks(profiles, "regular_win_pct", True)
    ranks = {col: season_ranks(profiles, col, hib) for col, _, _, hib, _ in CARD_STATS}
    champion_keys = set(champions.values())
    weights = model_inputs["weights"]

    chunks = []
    for i in profiles.sort_values("key").index:
        row = profiles.loc[i]
        season = int(row["season"])
        label = fmt.season_label(season)
        title = team_title_of(row)
        n = int(teams_per_season.loc[i])

        lines = [title + " (" + row["key"] + ")."]
        lines.append("Also written: " + ", ".join(fmt.team_aliases(season, row["era_city"], row["era_name"])) + ".")

        rank = int(record_rank.loc[i])
        regular = ("Regular season " + label + ": " + fmt.record(row["regular_wins"], row["regular_losses"])
                   + " (" + fmt.frac3(row["regular_win_pct"]) + " win %), "
                   + ("the best" if rank == 1 else "the " + fmt.ordinal(rank) + "-best")
                   + " record of " + str(n) + " teams")
        if season in short_seasons:
            regular += ", in a season of " + str(short_seasons[season]) + " games or fewer per team"
        lines.append(regular + ".")
        lines.append(playoff_sentence(row, row["key"] in champion_keys))
        lines.append("Scoring: " + fmt.rating(row["regular_points_per_game"]) + " points per game, "
                     + fmt.rating(row["regular_opponent_points_per_game"]) + " allowed.")

        lines.append("Compared with the " + label + " league. z is the number of standard deviations from that"
                     + " season's league average; the rank is among its " + str(n) + " teams.")
        for col, name, kind, hib, unit in CARD_STATS:
            z = row[col + "_z"]
            rank = ranks[col].loc[i]
            rank_text = fmt.ordinal(rank) + (" fastest" if hib is None else "")
            lines.append("- " + name + ": " + format_stat(kind, row[col]) + unit + " (z " + fmt.signed(z)
                         + ", " + fmt.describe_z(z, hib) + "; " + rank_text + ").")

        if season < FIRST_NBA_ADVANCED_SEASON:
            lines.append("Note: the NBA's own advanced stats start in 1996" + fmt.DASH + "97, so this season's"
                         + " ratings, pace and shooting figures are computed from the box score.")

        inputs = model_inputs["teams"][row["key"]]
        lines.append("What the simulator reads for this team: "
                     + " and ".join(feature_label(f) + " z " + fmt.signed(inputs[f], 2) for f in sorted(weights))
                     + ". Every other stat carries zero weight in " + release + ".")

        chunks.append(make_chunk("team:" + row["key"], "team_card", title, [row["key"]], [season],
                                 "\n".join(lines), release, "team_season_profiles_extended.csv"))
    return chunks


def feature_label(feature: str) -> str:
    """'regular_net_rating_z' -> 'net rating'."""
    return {"regular_net_rating_z": "net rating", "regular_win_pct_z": "win %"}.get(
        feature, feature.removeprefix("regular_").removesuffix("_z").replace("_", " "))


# ---------------------------------------------------------------------------
# Season cards
# ---------------------------------------------------------------------------

def short_season_lengths(profiles: pd.DataFrame, full_length: int = 82) -> dict:
    """{season: most games any team played} for seasons shorter than full_length."""
    most = profiles.groupby("season")["regular_games_played"].max()
    return {int(s): int(g) for s, g in most.items() if g < full_length}


def build_season_cards(profiles: pd.DataFrame, champions: dict, short_seasons: dict,
                       release: str) -> list[dict]:
    """One season_card chunk per season: league averages and the notable teams."""
    titles = {row["key"]: team_title_of(row) for _, row in profiles.iterrows()}
    chunks = []
    for season, group in profiles.groupby("season"):
        season = int(season)
        label = fmt.season_label(season)
        n = len(group)
        best_record = group.sort_values(["regular_win_pct", "key"], ascending=[False, True]).iloc[0]
        best_net = group.sort_values(["regular_net_rating", "key"], ascending=[False, True]).iloc[0]
        worst_net = group.sort_values(["regular_net_rating", "key"], ascending=[True, True]).iloc[0]
        champ = champions.get(season)

        lines = ["The " + label + " NBA season (season " + str(season) + "): " + str(n) + " teams."]
        if season in short_seasons:
            lines.append("A shortened season: no team played more than " + str(short_seasons[season]) + " regular-season games.")
        if champ:
            lines.append("Champion: " + titles[champ] + " (" + champ + ").")
        lines.append("Best record: " + titles[best_record["key"]] + ", "
                     + fmt.record(best_record["regular_wins"], best_record["regular_losses"]) + ".")
        lines.append("Best net rating: " + titles[best_net["key"]] + ", " + fmt.signed(best_net["regular_net_rating"]) + ".")
        lines.append("Worst net rating: " + titles[worst_net["key"]] + ", " + fmt.signed(worst_net["regular_net_rating"]) + ".")
        lines.append("League averages (the mean of the " + str(n) + " teams' figures): "
                     + "offensive rating " + fmt.rating(group["regular_offensive_rating"].mean())
                     + ", pace " + fmt.rating(group["regular_pace"].mean())
                     + ", true shooting " + fmt.frac3(group["regular_true_shooting_percentage"].mean())
                     + ", three-point % " + fmt.frac3(group["regular_three_pt_pct"].mean())
                     + ", " + fmt.rating(group["regular_points_per_game"].mean()) + " points per game.")
        if season < FIRST_NBA_ADVANCED_SEASON:
            lines.append("Ratings and pace for this season are computed from the box score; the NBA's own"
                         + " advanced stats start in 1996" + fmt.DASH + "97.")

        keys = sorted({best_record["key"], best_net["key"], worst_net["key"]} | ({champ} if champ else set()))
        chunks.append(make_chunk("season:" + str(season), "season_card", label + " NBA season", keys, [season],
                                 "\n".join(lines), release, "team_season_profiles_extended.csv"))
    return chunks


# ---------------------------------------------------------------------------
# Leaderboards
# ---------------------------------------------------------------------------

def build_leaderboards(profiles: pd.DataFrame, release: str) -> list[dict]:
    """Top-10 lists per stat and era, ranked against each team's own league."""
    lookup = {c[0]: c for c in CARD_STATS}
    chunks = []
    for slug, title, column, rank_by, best_first in LEADERBOARDS:
        sort_col = column + "_z" if rank_by == "z" else column
        for era, start, end in ERAS:
            group = profiles if start is None else profiles[profiles["season"].between(start, end)]
            if group.empty:
                raise ValueError("No team-seasons in era " + era)
            top = group.sort_values([sort_col, "key"], ascending=[not best_first, True]).head(LEADERBOARD_SIZE)

            first, last = int(group["season"].min()), int(group["season"].max())
            if era == "all-time":
                era_text = "all seasons, " + fmt.season_label(first) + " to " + fmt.season_label(last)
            else:
                era_text = "the " + fmt.decade_label(first, last)
            heading = title + ", " + era_text + "."
            if rank_by == "z":
                heading += (" Ranked by z-score against each team's own league, so teams from different eras"
                            + " compare fairly.")
            lines = [heading]
            kind = lookup[column][2] if column in lookup else "frac3"
            for rank, (_, row) in enumerate(top.iterrows(), start=1):
                entry = (str(rank) + ". " + team_title_of(row) + " (" + row["key"] + "): "
                         + format_stat(kind, row[column]))
                if rank_by == "z":
                    entry += ", z " + fmt.signed(row[sort_col])
                entry += "; record " + fmt.record(row["regular_wins"], row["regular_losses"]) + "."
                lines.append(entry)

            chunks.append(make_chunk("leaders:" + slug + ":" + era, "leaderboard", title + " (" + era + ")",
                                     list(top["key"]), range(first, last + 1), "\n".join(lines), release,
                                     "team_season_profiles_extended.csv"))
    return chunks


# ---------------------------------------------------------------------------
# Method chunks
# ---------------------------------------------------------------------------

def split_markdown_sections(markdown: str) -> list[tuple[str, str]]:
    """
    [(heading, body)] for every '## ' section. Text before the first one is
    ignored. Wrapped lines are joined; blank lines stay paragraph breaks.
    """
    sections = []
    for part in re.split(r"(?m)^## ", markdown.replace("\r\n", "\n"))[1:]:
        heading, _, body = part.partition("\n")
        body = re.sub(r"(?<!\n)\n(?!\n)", " ", body.strip())
        sections.append((heading.strip(), body))
    return sections


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def build_method_chunks(notes_markdown: str, manifest: dict, model_inputs: dict, release: str) -> list[dict]:
    """
    Method chunks from three sources: the curated notes (src/rag/sources/
    method_notes.md), the active release's manifest, and the model's actual
    weights from model_inputs.
    """
    chunks = []
    for heading, body in split_markdown_sections(notes_markdown):
        chunks.append(make_chunk("method:" + slugify(heading), "method", heading, [], [],
                                 heading + ".\n" + body, release, "src/rag/sources/method_notes.md"))

    chunks.append(make_chunk("method:release-description", "method", "About the " + release + " simulator", [], [],
                             "About the " + release + " simulator.\n" + manifest["description"],
                             release, "models/releases/" + release + "/manifest.json"))
    chunks.append(make_chunk("method:release-limitations", "method", "Limitations of the " + release + " simulator",
                             [], [], "Limitations of the " + release + " simulator.\n"
                             + "\n".join("- " + item for item in manifest["limitations"]),
                             release, "models/releases/" + release + "/manifest.json"))

    w = model_inputs["weights"]
    terms = " + ".join(format(w[f], ".3f") + " x (difference in " + feature_label(f) + " z-scores)" for f in sorted(w))
    net, win = w.get("regular_net_rating_z"), w.get("regular_win_pct_z")
    text = ("How the simulator weighs the two teams.\n"
            + "The " + release + " classifier gives non-zero weight to " + str(len(w)) + " inputs: "
            + " and ".join(feature_label(f) for f in sorted(w)) + ", each as a z-score against the team's own league."
            + " Every other stat it was offered carries zero weight.\n"
            + "With one team at home, the home team's log-odds of winning are "
            + format(model_inputs["intercept"], ".3f") + " (home court) + " + terms + ".\n"
            + "The site scores both home orders and averages the two probabilities, so neither team has home court.")
    if net and win:
        text += ("\nOne standard deviation of net rating moves the log-odds about " + format(net / win, ".1f")
                 + " times as much as one standard deviation of win %, so net rating decides most matchups.")
    chunks.append(make_chunk("method:model-weights", "method", "How the simulator weighs the two teams", [], [],
                             text, release, "models/releases/" + release + "/classifier.pkl"))
    return chunks


# ---------------------------------------------------------------------------
# Model inputs (the exact decomposition behind "why")
# ---------------------------------------------------------------------------

def build_model_inputs(release, profiles: pd.DataFrame, home_win_class: int = 1) -> dict:
    """
    Fold the release's imputer/scaler/logistic pipeline into the linear form
    in the module docstring, and collect every team's z-score for each
    non-zero feature.
    """
    clf = release.classifier
    steps = dict(clf.named_steps)
    if set(steps) != {"imputer", "scaler", "clf"}:
        raise ValueError("Expected an imputer -> scaler -> clf pipeline, found steps " + str(list(steps)))
    lr, scaler = steps["clf"], steps["scaler"]
    if list(lr.classes_) != [0, 1] or home_win_class != 1:
        raise ValueError("Expected classes [0, 1] with 1 = home win, found " + str(list(lr.classes_)))

    coef = lr.coef_[0]
    intercept = float(lr.intercept_[0])
    weights = {}
    for col, c, mean, scale in zip(release.columns, coef, scaler.mean_, scaler.scale_):
        if c == 0:
            continue
        if not col.endswith("_diff"):
            raise ValueError("Non-zero weight on a column that is not a difference: " + col)
        feature = col[:-len("_diff")]
        weights[feature] = float(c / scale)
        intercept -= float(c * mean / scale)
    if not weights:
        raise ValueError("The classifier has no non-zero weights.")

    for feature in weights:
        if feature not in profiles.columns:
            raise ValueError("Profiles lack model feature " + feature)
        if profiles[feature].isna().any():
            raise ValueError(feature + " has missing values, so the imputer would act and the fold is not exact.")

    teams = {}
    for _, row in profiles.sort_values("key").iterrows():
        teams[row["key"]] = {f: round(float(row[f]), 6) for f in sorted(weights)}

    return {
        "release":   release.version,
        "formula":   "logit P(home wins) = intercept + sum_f weights[f] * (teams[home][f] - teams[away][f]); "
                     + "neutral p_a = (round(P(a home), 4) + 1 - round(P(b home), 4)) / 2, rounded to 4 decimals",
        "intercept": intercept,
        "weights":   {f: weights[f] for f in sorted(weights)},
        "teams":     teams,
    }


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def logit_contributions(model_inputs: dict, a: str, b: str) -> dict:
    """{feature: w_f * (z_a,f - z_b,f)}: how much each input moves A's log-odds."""
    za, zb = model_inputs["teams"][a], model_inputs["teams"][b]
    return {f: w * (za[f] - zb[f]) for f, w in model_inputs["weights"].items()}


def neutral_p(model_inputs: dict, a: str, b: str) -> float:
    """Team a's neutral-court win probability, rounded as the static export rounds it."""
    s = sum(logit_contributions(model_inputs, a, b).values())
    b0 = model_inputs["intercept"]
    p_ab = round(sigmoid(b0 + s), 4)
    p_ba = round(sigmoid(b0 - s), 4)
    return round((p_ab + (1 - p_ba)) / 2, 4)


def reproduction_check(model_inputs: dict, teams_dir: Path, samples: int, seed: int) -> dict:
    """
    Compare neutral_p with the exported p for `samples` random ordered pairs.
    Returns {"pairs", "max_abs_diff", "mean_abs_diff", "exact"}.
    """
    keys = sorted(model_inputs["teams"])
    rng = np.random.default_rng(seed)
    cache = {}
    diffs = []
    for _ in range(samples):
        a, b = rng.choice(len(keys), size=2, replace=False)
        a, b = keys[a], keys[b]
        if a not in cache:
            with open(teams_dir / (a + ".json"), encoding="utf-8") as f:
                cache[a] = json.load(f)["opponents"]
        diffs.append(abs(neutral_p(model_inputs, a, b) - cache[a][b]["p"]))
    diffs = np.array(diffs)
    return {
        "pairs":         int(samples),
        "max_abs_diff":  float(diffs.max()),
        "mean_abs_diff": float(diffs.mean()),
        "exact":         int((diffs < 1e-9).sum()),
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def check_corpus(chunks: list[dict], index_keys: set) -> None:
    """Raise ValueError on duplicate ids, unknown keys, empty text or forbidden content."""
    ids = [c["id"] for c in chunks]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        raise ValueError("Duplicate chunk ids: " + str(dupes[:10]))
    for c in chunks:
        if not c["text"]:
            raise ValueError("Empty chunk text: " + c["id"])
        unknown = [k for k in c["keys"] if k not in index_keys]
        if unknown:
            raise ValueError("Chunk " + c["id"] + " names keys not in index.json: " + str(unknown))
        checked = c["title"] + "\n" + c["text"]
        for phrase in ALLOWED_PHRASES:
            checked = re.sub(re.escape(phrase), "", checked, flags=re.IGNORECASE)
        for pattern in FORBIDDEN_PATTERNS:
            hit = re.search(pattern, checked, flags=re.IGNORECASE)
            if hit:
                raise ValueError("Chunk " + c["id"] + " contains forbidden text '" + hit.group(0) + "'")


def estimated_tokens(text: str) -> int:
    return max(1, round(len(text) / CHARS_PER_TOKEN))
