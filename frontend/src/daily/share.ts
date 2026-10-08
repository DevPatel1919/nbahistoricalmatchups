// The Daily Three share text (F12). Spoiler-free (Q5): each square says
// whether the sharer was right, never who won, and the text never carries a
// probability or a margin.
//
//   Daily Three #12 · 2/3
//   🟩 '96 Bulls vs '89 Pistons
//   🟥 '01 Lakers vs '14 Spurs
//   🟩 '96 Bulls vs '17 Warriors ⭐
//   🔥 12  🎯 5
//   courtofalltime.win/daily
//
// Teams in a line keep the day file's order, which is canonicalOrder in
// lib/slug.ts (the verifier checks it).

import { correctness, dayScore, type DayRecord } from "./stats";
import type { DailyGame } from "./types";

export const SHARE_URL = "courtofalltime.win/daily";

/** Season and era-correct name, as in index.json. */
export type ShareTeam = { season: number; name: string };

export type ShareInput = {
  n: number;
  games: Pick<DailyGame, "a" | "b" | "featured">[];
  teams: Record<string, ShareTeam>;
  record: DayRecord;
  playStreak: number;
  hotStreak: number;
};

/** "'96 Bulls" for the 1995-96 Bulls. */
export function shortTeamLabel(team: ShareTeam): string {
  return `'${String(team.season % 100).padStart(2, "0")} ${team.name}`;
}

export function buildShareText({ n, games, teams, record, playStreak, hotStreak }: ShareInput): string {
  const right = correctness(record);
  const label = (key: string) => {
    const team = teams[key];
    if (!team) throw new Error(`No team named for ${key}`);
    return shortTeamLabel(team);
  };
  const lines = games.map(
    (g, i) => `${right[i] ? "🟩" : "🟥"} ${label(g.a)} vs ${label(g.b)}${g.featured ? " ⭐" : ""}`,
  );
  return [
    `Daily Three #${n} · ${dayScore(record)}/${games.length}`,
    ...lines,
    `🔥 ${playStreak}  🎯 ${hotStreak}`,
    SHARE_URL,
  ].join("\n");
}
