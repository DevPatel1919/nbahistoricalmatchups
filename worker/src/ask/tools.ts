// The tools for Ask the Court (F13): the port of src/rag/tools.py. Exact numbers
// and the model's real arithmetic, looked up rather than generated.
// tests/fixtures/rag/tools.json pins both implementations.

import { DASH, ordinal, pct1, rounded, seasonLabel, signed } from "./textfmt";

type StatRow = [value: string, z: string, rank: number];
export type TeamFacts = {
  title: string;
  season: number;
  teams: number;
  record: string;
  win_pct: string;
  record_rank: number;
  playoffs: string;
  champion: boolean;
  points: string;
  allowed: string;
  box_score: boolean;
  stats: Record<string, StatRow>;
};
export type SeasonFacts = {
  teams: number;
  champion: string | null;
  best_record: [string, string];
  best_net: [string, string];
  worst_net: [string, string];
  averages: Record<string, string>;
  short_season: number | null;
  box_score: boolean;
};
export type Facts = {
  release: string;
  limitations: string[];
  teams: Record<string, TeamFacts>;
  seasons: Record<string, SeasonFacts>;
};
export type ModelInputs = {
  release: string;
  intercept: number;
  weights: Record<string, number>;
  teams: Record<string, Record<string, number>>;
};
export type Opponents = Record<string, { p: number; m: number }>;

const FACT_STATS: [slug: string, label: string, unit: string, rankWord: string][] = [
  ["net_rating", "net rating", " per 100 possessions", ""],
  ["offensive_rating", "offensive rating", "", ""],
  ["defensive_rating", "defensive rating", ", lower is better", ""],
  ["pace", "pace", "", " fastest"],
  ["true_shooting", "true shooting", "", ""],
  ["effective_fg", "effective field goal %", "", ""],
  ["three_point", "three-point %", "", ""],
  ["opponent_effective_fg", "opponent effective field goal %", ", lower is better", ""],
  ["turnovers", "turnover %", ", lower is better", ""],
  ["forced_turnovers", "forced turnover %", "", ""],
  ["assists", "assist %", "", ""],
];

export const SUGGESTED = ["why", "defence", "limits"] as const;
export type Suggested = (typeof SUGGESTED)[number];

export class UnknownEntity extends Error {}

function featureLabel(feature: string): string {
  if (feature === "regular_net_rating_z") return "net rating";
  if (feature === "regular_win_pct_z") return "win %";
  return feature.replace(/^regular_/, "").replace(/_z$/, "").replaceAll("_", " ");
}

function approxMargin(m: number): string {
  const points = Math.floor(Math.abs(m) + 0.5);
  if (points === 0) return "less than a point";
  return "about " + points + (points === 1 ? " point" : " points");
}

function possessive(title: string): string {
  return title + (title.endsWith("s") ? "'" : "'s");
}

function shareText(share: number): string {
  return Math.floor(share * 100 + 0.5) + "%";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export class Tools {
  readonly facts: Facts;
  readonly modelInputs: ModelInputs;
  private readonly opponents: (key: string) => Promise<Opponents>;

  constructor(facts: Facts, modelInputs: ModelInputs, opponents: (key: string) => Promise<Opponents>) {
    this.facts = facts;
    this.modelInputs = modelInputs;
    this.opponents = opponents;
    if (facts.release !== modelInputs.release) throw new Error("facts and model inputs are for different releases");
  }

  getTeamSeason(key: string) {
    const t = this.facts.teams[key];
    if (!t) throw new UnknownEntity(key);
    const inputs = this.modelInputs.teams[key];
    const features = Object.keys(this.modelInputs.weights).sort();
    return {
      ...t,
      key,
      label: seasonLabel(t.season),
      model_inputs: features.map((f): [string, string] => [featureLabel(f), signed(inputs[f], 2)]),
    };
  }

  getSeason(season: number) {
    const s = this.facts.seasons[String(season)];
    if (!s) throw new UnknownEntity(String(season));
    const title = (key: string) => this.facts.teams[key].title;
    return {
      ...s,
      season,
      label: seasonLabel(season),
      champion: s.champion ? { key: s.champion, title: title(s.champion) } : null,
      best_record: { key: s.best_record[0], title: title(s.best_record[0]), record: s.best_record[1] },
      best_net: { key: s.best_net[0], title: title(s.best_net[0]), net_rating: s.best_net[1] },
      worst_net: { key: s.worst_net[0], title: title(s.worst_net[0]), net_rating: s.worst_net[1] },
    };
  }

  /** Team a against team b on a neutral court: the exported p and m, and the model's lean split into its inputs. */
  async getMatchup(a: string, b: string) {
    if (a === b) throw new Error("A matchup needs two different team-seasons.");
    if (!this.facts.teams[a]) throw new UnknownEntity(a);
    const entry = (await this.opponents(a))[b];
    if (!entry) throw new UnknownEntity(b);
    const { p, m } = entry;
    const favoured = p > 0.5 ? a : p < 0.5 ? b : null;
    const other = favoured === null ? null : favoured === a ? b : a;
    const weights = this.modelInputs.weights;
    const za = this.modelInputs.teams[a];
    const zb = this.modelInputs.teams[b];
    const contributions = Object.keys(weights).map((f) => ({ feature: f, c: weights[f] * (za[f] - zb[f]) }));
    const total = contributions.reduce((sum, x) => sum + Math.abs(x.c), 0);
    const ordered = [...contributions].sort((x, y) => Math.abs(y.c) - Math.abs(x.c));
    const parts = ordered.map(({ feature, c }) => ({
      feature,
      label: featureLabel(feature),
      weight: rounded(weights[feature], 6),
      z_a: signed(za[feature], 2),
      z_b: signed(zb[feature], 2),
      contribution: rounded(c, 6),
      favours: c > 0 ? a : c < 0 ? b : null,
      share: total ? rounded(Math.abs(c) / total, 4) : 0,
    }));
    return {
      a,
      b,
      p,
      m,
      p_a: pct1(p),
      p_b: pct1(1 - p),
      favoured,
      other,
      margin: approxMargin(m),
      score: rounded(
        contributions.reduce((sum, x) => sum + x.c, 0),
        6,
      ),
      parts,
    };
  }

  teamFact(key: string): string {
    const t = this.getTeamSeason(key);
    const n = String(t.teams);
    const rank = t.record_rank === 1 ? "the best" : "the " + ordinal(t.record_rank) + "-best";
    const parts = [
      t.title + " (" + key + "): " + t.record + " (" + t.win_pct + " win %), " + rank + " record of " + n + " teams. " +
        t.playoffs + " " + t.points + " points per game, " + t.allowed + " allowed.",
    ];
    const stats = FACT_STATS.map(([slug, label, unit, rankWord]) => {
      const [value, z, r] = t.stats[slug];
      return label + " " + value + unit + " (z " + z + ", " + ordinal(r) + rankWord + " of " + n + ")";
    });
    parts.push("Against its " + t.label + " league: " + stats.join("; ") + ".");
    parts.push("The simulator reads " + t.model_inputs.map(([f, z]) => f + " z " + z).join(" and ") + ".");
    if (t.box_score) {
      parts.push("Its ratings, pace and shooting are computed from the box score (the NBA's own advanced stats start in 1996" + DASH + "97).");
    }
    return parts.join(" ");
  }

  seasonFact(season: number): string {
    const s = this.getSeason(season);
    const a = s.averages;
    const parts = ["The " + s.label + " season (" + s.teams + " teams):"];
    if (s.short_season) parts.push("a shortened season of at most " + s.short_season + " games per team;");
    if (s.champion) parts.push("champion " + s.champion.title + ";");
    parts.push(
      "best record " + s.best_record.title + ", " + s.best_record.record + "; best net rating " + s.best_net.title + ", " +
        s.best_net.net_rating + "; worst net rating " + s.worst_net.title + ", " + s.worst_net.net_rating + ".",
    );
    parts.push(
      "League averages: offensive rating " + a.offensive_rating + ", pace " + a.pace + ", true shooting " + a.true_shooting +
        ", three-point % " + a.three_point + ", " + a.points + " points per game.",
    );
    if (s.box_score) parts.push("Ratings and pace this season are computed from the box score.");
    return parts.join(" ");
  }

  /** Two lines: the result, and why. */
  async matchupFacts(a: string, b: string): Promise<string[]> {
    const mu = await this.getMatchup(a, b);
    const title: Record<string, string> = { [a]: this.facts.teams[a].title, [b]: this.facts.teams[b].title };
    let result: string;
    if (mu.favoured === null) {
      result = "On a neutral court the simulator rates the " + title[a] + " and the " + title[b] + " even: a 50.0% chance each, " + mu.margin + " apart.";
    } else {
      const fav = mu.favoured;
      const oth = mu.other as string;
      const [pFav, pOth] = fav === a ? [mu.p_a, mu.p_b] : [mu.p_b, mu.p_a];
      result = "On a neutral court the simulator gives the " + title[fav] + " a " + pFav + " chance against the " + title[oth] +
        " (" + pOth + " for the " + title[oth] + "), with an estimated margin of " + mu.margin + ".";
    }
    result += " It is an estimate for a matchup that never happened.";
    const whys = mu.parts.map((part) => {
      let line = part.label + " (z " + part.z_a + " for the " + title[a] + ", " + part.z_b + " for the " + title[b] + ")";
      if (part.favours === null) line += " favours neither team";
      else line += " accounts for " + shareText(part.share) + " of the model's lean and favours the " + title[part.favours];
      return line;
    });
    const why = "Why: the simulator reads two numbers per team, each as a z-score against the team's own league. " +
      whys.join("; ") + ". Every other stat carries zero weight.";
    return [result, why];
  }
}

/** The answer to a suggested question on the a-vs-b page, built only from tool facts: no model call. */
export async function templateAnswer(tools: Tools, kind: Suggested, a: string, b: string): Promise<{ facts: string[]; text: string }> {
  const title: Record<string, string> = { [a]: tools.facts.teams[a].title, [b]: tools.facts.teams[b].title };

  if (kind === "why") {
    const facts = await tools.matchupFacts(a, b);
    const mu = await tools.getMatchup(a, b);
    const lines: string[] = [];
    if (mu.favoured === null) {
      lines.push("The simulator rates the " + title[a] + " and the " + title[b] + " even on a neutral court [F1].");
    } else {
      const fav = mu.favoured;
      const pFav = fav === a ? mu.p_a : mu.p_b;
      lines.push("The simulator favours the " + title[fav] + ": it gives them a " + pFav + " chance on a neutral court, with an estimated margin of " + mu.margin + " [F1].");
    }
    lines.push("It reads only two numbers per team, net rating and win %, each against the team's own league [F2].");
    for (const part of mu.parts) {
      if (part.favours === null) continue;
      lines.push(capitalize(part.label) + " (z " + part.z_a + " for the " + title[a] + ", " + part.z_b + " for the " + title[b] +
        ") accounts for " + shareText(part.share) + " of its lean and favours the " + title[part.favours] + " [F2].");
    }
    lines.push("This is an estimate for a matchup that never happened [F1].");
    return { facts, text: lines.join(" ") };
  }

  if (kind === "defence") {
    const facts = [tools.teamFact(a), tools.teamFact(b)];
    const ta = tools.getTeamSeason(a);
    const tb = tools.getTeamSeason(b);
    const lines: string[] = [];
    for (const [label, t] of [["[F1]", ta], ["[F2]", tb]] as const) {
      const d = t.stats.defensive_rating;
      const o = t.stats.opponent_effective_fg;
      lines.push("The " + t.title + " allowed " + d[0] + " points per 100 possessions (z " + d[1] + ", " + ordinal(d[2]) + " of " + t.teams +
        " that season) and held opponents to a " + o[0] + " effective field goal % (z " + o[1] + ") " + label + ".");
    }
    const za = Number(ta.stats.defensive_rating[1]);
    const zb = Number(tb.stats.defensive_rating[1]);
    let verdict: string;
    if (za === zb) {
      verdict = "Relative to their own leagues, their defences were about equally good [F1] [F2].";
    } else {
      const better = za < zb ? ta : tb;
      verdict = "Relative to their own leagues, the " + better.title + " had the better defence: a lower z on defensive rating is better [F1] [F2].";
    }
    lines.unshift(verdict);
    lines.push("Raw ratings from different eras aren't directly comparable, so the comparison uses each team's z-score.");
    for (const [label, t] of [["[F1]", ta], ["[F2]", tb]] as const) {
      if (t.box_score) lines.push("The " + possessive(t.title) + " ratings are computed from the box score " + label + ".");
    }
    return { facts, text: lines.join(" ") };
  }

  const facts = ["Limitations of the " + tools.facts.release + " simulator: " + tools.facts.limitations.join(" ")];
  const lines = [
    "The simulator reads only two numbers per team, net rating and win %, each against its own league; every other stat carries zero weight [F1].",
    "It doesn't account for rosters, injuries or rest: team strength comes from full-season averages [F1].",
    "Results are for a neutral court, and the margin is approximate; typical error on real games was about 11 points [F1].",
    "Cross-era matchups never happened, so these results can't be checked against real games [F1].",
  ];
  for (const key of [a, b]) {
    if (tools.facts.teams[key].box_score) {
      facts.push(tools.teamFact(key));
      lines.push("The " + possessive(title[key]) + " ratings are computed from the box score, because the NBA's own advanced stats start in 1996" + DASH + "97 [F" + facts.length + "].");
    }
  }
  return { facts, text: lines.join(" ") };
}


