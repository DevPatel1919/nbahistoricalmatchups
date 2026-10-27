"""
tools.py

The tools for Ask the Court (F13 Session 4): exact numbers and the model's
real arithmetic, looked up instead of generated. They are pure functions over
committed files, so the Worker (worker/src/ask/tools.ts, Session 5) can
reproduce them; tests/fixtures/rag/tools.json pins both.

    get_team_season(key)   a team card's numbers (data/rag/facts.json and
                           the two model inputs from data/rag/model_inputs.json)
    get_season(season)     league averages, the champion, the best and worst teams
    get_matchup(a, b)      the exported p and m (frontend/public/data/teams/<a>.json,
                           never recomputed for display) and the decomposition of
                           the model's lean into its two inputs

Each tool's result is also rendered as one fact line ([F1], [F2]...) for the
generator, and the three suggested questions on a result page have template
answers built only from those facts: no model call (the brief's "Fallback").

Numbers in facts are display strings written by src/rag/textfmt.py, the same
functions the cards use, so the grounding check sees the same digits in a
fact and in its card.
"""

import json
from functools import lru_cache
from pathlib import Path

from src.rag import textfmt as fmt
from src.rag.corpus import feature_label, logit_contributions

REPO_ROOT         = Path(__file__).resolve().parents[2]
FACTS_PATH        = REPO_ROOT / "data" / "rag" / "facts.json"
MODEL_INPUTS_PATH = REPO_ROOT / "data" / "rag" / "model_inputs.json"
TEAMS_DIR         = REPO_ROOT / "frontend" / "public" / "data" / "teams"

# Stats in a team fact: (slug, label, unit, rank word). The order is the card's.
FACT_STATS = [
    ("net_rating",            "net rating",                      " per 100 possessions", ""),
    ("offensive_rating",      "offensive rating",                "",                     ""),
    ("defensive_rating",      "defensive rating",                ", lower is better",    ""),
    ("pace",                  "pace",                            "",                     " fastest"),
    ("true_shooting",         "true shooting",                   "",                     ""),
    ("effective_fg",          "effective field goal %",          "",                     ""),
    ("three_point",           "three-point %",                   "",                     ""),
    ("opponent_effective_fg", "opponent effective field goal %", ", lower is better",    ""),
    ("turnovers",             "turnover %",                      ", lower is better",    ""),
    ("forced_turnovers",      "forced turnover %",               "",                     ""),
    ("assists",               "assist %",                        "",                     ""),
]

SUGGESTED = ("why", "defence", "limits")


class UnknownEntity(KeyError):
    pass


def approx_margin(m: float) -> str:
    """The margin in words, never precise (model-integrity gate): 6.9 -> 'about 7 points'."""
    points = int(abs(float(m)) + 0.5)
    if points == 0:
        return "less than a point"
    return "about " + str(points) + (" point" if points == 1 else " points")


def percent(p: float) -> str:
    """An exported probability as the site shows it: 0.5558 -> '55.6%'."""
    return fmt.pct1(p)


def possessive(title: str) -> str:
    """'1985–86 Boston Celtics' -> "1985–86 Boston Celtics'"; '... Heat' -> "... Heat's"."""
    return title + ("'" if title.endswith("s") else "'s")


def share_text(share: float) -> str:
    """One input's share of the model's lean, in whole percent: 0.6384 -> '64%'."""
    return str(int(float(share) * 100 + 0.5)) + "%"


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

class Tools:
    def __init__(self, facts: dict, model_inputs: dict, teams_dir: Path = TEAMS_DIR):
        if facts["release"] != model_inputs["release"]:
            raise ValueError("facts.json is for " + facts["release"] + " but model_inputs.json for "
                             + model_inputs["release"] + ". Rebuild data/rag/.")
        self.facts = facts
        self.model_inputs = model_inputs
        self.teams_dir = teams_dir

    @classmethod
    def from_files(cls) -> "Tools":
        with open(FACTS_PATH, encoding="utf-8") as f:
            facts = json.load(f)
        with open(MODEL_INPUTS_PATH, encoding="utf-8") as f:
            model_inputs = json.load(f)
        return cls(facts, model_inputs)

    @lru_cache(maxsize=256)
    def opponents(self, key: str) -> dict:
        path = self.teams_dir / (key + ".json")
        if not path.exists():
            raise UnknownEntity(key)
        with open(path, encoding="utf-8") as f:
            return json.load(f)["opponents"]

    def get_team_season(self, key: str) -> dict:
        if key not in self.facts["teams"]:
            raise UnknownEntity(key)
        t = self.facts["teams"][key]
        inputs = self.model_inputs["teams"][key]
        return {
            "key":          key,
            "title":        t["title"],
            "season":       t["season"],
            "label":        fmt.season_label(t["season"]),
            "teams":        t["teams"],
            "record":       t["record"],
            "win_pct":      t["win_pct"],
            "record_rank":  t["record_rank"],
            "playoffs":     t["playoffs"],
            "champion":     t["champion"],
            "points":       t["points"],
            "allowed":      t["allowed"],
            "box_score":    t["box_score"],
            "stats":        {slug: {"value": v, "z": z, "rank": r} for slug, (v, z, r) in t["stats"].items()},
            "model_inputs": {feature_label(f): fmt.signed(inputs[f], 2) for f in sorted(self.model_inputs["weights"])},
        }

    def get_season(self, season: int) -> dict:
        s = self.facts["seasons"].get(str(int(season)))
        if s is None:
            raise UnknownEntity(str(season))
        title = lambda key: self.facts["teams"][key]["title"]
        return {
            "season":       int(season),
            "label":        fmt.season_label(season),
            "teams":        s["teams"],
            "champion":     {"key": s["champion"], "title": title(s["champion"])} if s["champion"] else None,
            "best_record":  {"key": s["best_record"][0], "title": title(s["best_record"][0]), "record": s["best_record"][1]},
            "best_net":     {"key": s["best_net"][0], "title": title(s["best_net"][0]), "net_rating": s["best_net"][1]},
            "worst_net":    {"key": s["worst_net"][0], "title": title(s["worst_net"][0]), "net_rating": s["worst_net"][1]},
            "averages":     dict(s["averages"]),
            "short_season": s["short_season"],
            "box_score":    s["box_score"],
        }

    def get_matchup(self, a: str, b: str) -> dict:
        """
        Team a against team b on a neutral court. p and m are the exported
        values for a. The decomposition splits the model's score for a into
        its two inputs: each part is weight x (z_a - z_b), and the parts add
        up to the score that, with the home-court intercept, gives p.
        """
        if a == b:
            raise ValueError("A matchup needs two different team-seasons.")
        opp = self.opponents(a)
        if b not in opp:
            raise UnknownEntity(b)
        p, m = float(opp[b]["p"]), float(opp[b]["m"])
        favoured = a if p > 0.5 else b if p < 0.5 else None
        other = None if favoured is None else (b if favoured == a else a)
        contributions = logit_contributions(self.model_inputs, a, b)
        total = sum(abs(c) for c in contributions.values())
        parts = []
        for feature in sorted(contributions, key=lambda f: -abs(contributions[f])):
            c = contributions[feature]
            parts.append({
                "feature":      feature,
                "label":        feature_label(feature),
                "weight":       round(self.model_inputs["weights"][feature], 6),
                "z_a":          fmt.signed(self.model_inputs["teams"][a][feature], 2),
                "z_b":          fmt.signed(self.model_inputs["teams"][b][feature], 2),
                "contribution": round(c, 6),
                "favours":      a if c > 0 else b if c < 0 else None,
                "share":        round(abs(c) / total, 4) if total else 0.0,
            })
        return {
            "a": a, "b": b, "p": p, "m": m,
            "p_a": percent(p), "p_b": percent(1 - p),
            "favoured": favoured, "other": other,
            "margin": approx_margin(m),
            "score": round(sum(contributions.values()), 6),
            "parts": parts,
        }

    # -----------------------------------------------------------------------
    # Fact lines
    # -----------------------------------------------------------------------

    def team_fact(self, key: str) -> str:
        t = self.get_team_season(key)
        n = str(t["teams"])
        rank = "the best" if t["record_rank"] == 1 else "the " + fmt.ordinal(t["record_rank"]) + "-best"
        parts = [t["title"] + " (" + key + "): " + t["record"] + " (" + t["win_pct"] + " win %), " + rank
                 + " record of " + n + " teams. " + t["playoffs"]
                 + " " + t["points"] + " points per game, " + t["allowed"] + " allowed."]
        stats = []
        for slug, label, unit, rank_word in FACT_STATS:
            s = t["stats"][slug]
            stats.append(label + " " + s["value"] + unit + " (z " + s["z"] + ", " + fmt.ordinal(s["rank"]) + rank_word
                         + " of " + n + ")")
        parts.append("Against its " + t["label"] + " league: " + "; ".join(stats) + ".")
        parts.append("The simulator reads " + " and ".join(f + " z " + z for f, z in t["model_inputs"].items()) + ".")
        if t["box_score"]:
            parts.append("Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats"
                         + " start in 1996" + fmt.DASH + "97).")
        return " ".join(parts)

    def season_fact(self, season: int) -> str:
        s = self.get_season(season)
        a = s["averages"]
        parts = ["The " + s["label"] + " season (" + str(s["teams"]) + " teams):"]
        if s["short_season"]:
            parts.append("a shortened season of at most " + str(s["short_season"]) + " games per team;")
        if s["champion"]:
            parts.append("champion " + s["champion"]["title"] + ";")
        parts.append("best record " + s["best_record"]["title"] + ", " + s["best_record"]["record"] + ";"
                     + " best net rating " + s["best_net"]["title"] + ", " + s["best_net"]["net_rating"] + ";"
                     + " worst net rating " + s["worst_net"]["title"] + ", " + s["worst_net"]["net_rating"] + ".")
        parts.append("League averages: offensive rating " + a["offensive_rating"] + ", pace " + a["pace"]
                     + ", true shooting " + a["true_shooting"] + ", three-point % " + a["three_point"] + ", "
                     + a["points"] + " points per game.")
        if s["box_score"]:
            parts.append("Ratings and pace this season are computed from the box score.")
        return " ".join(parts)

    def matchup_facts(self, a: str, b: str) -> list[str]:
        """Two lines: the result, and why."""
        mu = self.get_matchup(a, b)
        title = {k: self.facts["teams"][k]["title"] for k in (a, b)}
        if mu["favoured"] is None:
            result = ("On a neutral court the simulator rates the " + title[a] + " and the " + title[b]
                      + " even: a 50.0% chance each, " + mu["margin"] + " apart.")
        else:
            fav, oth = mu["favoured"], mu["other"]
            p_fav, p_oth = (mu["p_a"], mu["p_b"]) if fav == a else (mu["p_b"], mu["p_a"])
            result = ("On a neutral court the simulator gives the " + title[fav] + " a " + p_fav + " chance against the "
                      + title[oth] + " (" + p_oth + " for the " + title[oth] + "), with an estimated margin of "
                      + mu["margin"] + ".")
        result += " It is an estimate for a matchup that never happened."
        whys = []
        for part in mu["parts"]:
            line = (part["label"] + " (z " + part["z_a"] + " for the " + title[a] + ", " + part["z_b"] + " for the "
                    + title[b] + ")")
            if part["favours"] is None:
                line += " favours neither team"
            else:
                line += (" accounts for " + share_text(part["share"]) + " of the model's lean and favours the "
                         + title[part["favours"]])
            whys.append(line)
        why = ("Why: the simulator reads two numbers per team, each as a z-score against the team's own league. "
               + "; ".join(whys) + ". Every other stat carries zero weight.")
        return [result, why]


# ---------------------------------------------------------------------------
# Template answers (no model)
# ---------------------------------------------------------------------------

def template_answer(tools: Tools, kind: str, a: str, b: str) -> dict:
    """
    The answer to a suggested question on the a-vs-b result page, built only
    from tool facts. Returns {facts, text}; every number in text is in a
    fact it cites, so the grounding check passes by construction.
    """
    if kind not in SUGGESTED:
        raise ValueError("Unknown suggested question: " + kind)
    title = {k: tools.facts["teams"][k]["title"] for k in (a, b)}

    if kind == "why":
        facts = tools.matchup_facts(a, b)
        mu = tools.get_matchup(a, b)
        if mu["favoured"] is None:
            lines = ["The simulator rates the " + title[a] + " and the " + title[b] + " even on a neutral court [F1]."]
        else:
            fav = mu["favoured"]
            p_fav = mu["p_a"] if fav == a else mu["p_b"]
            lines = ["The simulator favours the " + title[fav] + ": it gives them a " + p_fav
                     + " chance on a neutral court, with an estimated margin of " + mu["margin"] + " [F1]."]
        lines.append("It reads only two numbers per team, net rating and win %, each against the team's own league [F2].")
        for part in mu["parts"]:
            if part["favours"] is None:
                continue
            lines.append(part["label"].capitalize() + " (z " + part["z_a"] + " for the " + title[a] + ", " + part["z_b"]
                         + " for the " + title[b] + ") accounts for "
                         + share_text(part["share"]) + " of its lean and favours the "
                         + title[part["favours"]] + " [F2].")
        lines.append("This is an estimate for a matchup that never happened [F1].")
        return {"facts": facts, "text": " ".join(lines)}

    if kind == "defence":
        facts = [tools.team_fact(a), tools.team_fact(b)]
        ta, tb = tools.get_team_season(a), tools.get_team_season(b)
        lines = []
        for label, t in (("[F1]", ta), ("[F2]", tb)):
            d, o = t["stats"]["defensive_rating"], t["stats"]["opponent_effective_fg"]
            lines.append("The " + t["title"] + " allowed " + d["value"] + " points per 100 possessions (z " + d["z"] + ", "
                         + fmt.ordinal(d["rank"]) + " of " + str(t["teams"]) + " that season) and held opponents to a "
                         + o["value"] + " effective field goal % (z " + o["z"] + ") " + label + ".")
        za, zb = float(ta["stats"]["defensive_rating"]["z"]), float(tb["stats"]["defensive_rating"]["z"])
        if za == zb:
            verdict = "Relative to their own leagues, their defences were about equally good [F1] [F2]."
        else:
            better = ta if za < zb else tb
            verdict = ("Relative to their own leagues, the " + better["title"] + " had the better defence: a lower z on"
                       + " defensive rating is better [F1] [F2].")
        lines.insert(0, verdict)
        lines.append("Raw ratings from different eras aren't directly comparable, so the comparison uses each team's z-score.")
        for label, t in (("[F1]", ta), ("[F2]", tb)):
            if t["box_score"]:
                lines.append("The " + possessive(t["title"]) + " ratings are computed from the box score " + label + ".")
        return {"facts": facts, "text": " ".join(lines)}

    # limits
    facts = ["Limitations of the " + tools.facts["release"] + " simulator: " + " ".join(tools.facts["limitations"])]
    lines = ["The simulator reads only two numbers per team, net rating and win %, each against its own league;"
             " every other stat carries zero weight [F1].",
             "It doesn't account for rosters, injuries or rest: team strength comes from full-season averages [F1].",
             "Results are for a neutral court, and the margin is approximate; typical error on real games was about 11"
             " points [F1].",
             "Cross-era matchups never happened, so these results can't be checked against real games [F1]."]
    older = [t for t in (a, b) if tools.facts["teams"][t]["box_score"]]
    for key in older:
        facts.append(tools.team_fact(key))
        lines.append("The " + possessive(title[key]) + " ratings are computed from the box score, because the NBA's own advanced"
                     " stats start in 1996" + fmt.DASH + "97 [F" + str(len(facts)) + "].")
    return {"facts": facts, "text": " ".join(lines)}
