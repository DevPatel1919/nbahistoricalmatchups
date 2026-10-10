// The Daily Three share text (F12). Q5, decided by the owner on 2026-10-10:
// each line names the simulated winner and the final score, and its square
// says whether the sharer was right. The text never carries the model's
// probability or its margin m: the score is one simulated game's.
//
//   Daily Three #12 · 2/3
//   🟩 '96 Bulls beat '89 Pistons 104–92
//   🟥 '14 Spurs beat '01 Lakers 101–97
//   🟩 '17 Warriors beat '96 Bulls 112–108 ⭐
//   🔥 12  🎯 5
//   courtofalltime.win/daily
//
// The winner comes first in each line, so the day file's canonical order
// (lib/slug.ts) holds only for the order of the games.

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
  /** Each game's simulated final, [a, b] (SimGame.final). */
  finals: [number, number][];
  playStreak: number;
  hotStreak: number;
};

/** "'96 Bulls" for the 1995-96 Bulls. */
export function shortTeamLabel(team: ShareTeam): string {
  return `'${String(team.season % 100).padStart(2, "0")} ${team.name}`;
}

export function buildShareText({ n, games, teams, record, finals, playStreak, hotStreak }: ShareInput): string {
  if (finals.length !== games.length) throw new Error("A share text needs every game's final");
  const right = correctness(record);
  const label = (key: string) => {
    const team = teams[key];
    if (!team) throw new Error(`No team named for ${key}`);
    return shortTeamLabel(team);
  };
  const lines = games.map((g, i) => {
    const won = record.winners[i];
    const [winner, loser] = won === 0 ? [g.a, g.b] : [g.b, g.a];
    const score = `${finals[i][won]}–${finals[i][1 - won]}`;
    return `${right[i] ? "🟩" : "🟥"} ${label(winner)} beat ${label(loser)} ${score}${g.featured ? " ⭐" : ""}`;
  });
  return [
    `Daily Three #${n} · ${dayScore(record)}/${games.length}`,
    ...lines,
    `🔥 ${playStreak}  🎯 ${hotStreak}`,
    SHARE_URL,
  ].join("\n");
}
