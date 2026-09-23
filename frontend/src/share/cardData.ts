// Builds share-card data from the same sources the pages use, so a card can
// never disagree with the result it advertises.

import type { BracketResult, TitleOddsResult } from "../tournament";
import type { IndexTeam, OpponentResult } from "../types";
import { formatMargin } from "../lib/margin";
import { seriesWinProbability } from "../lib/series";
import type { CardTeam, MatchupCardData, TournamentCardData } from "./cards";

function cardTeam(team: IndexTeam): CardTeam {
  return {
    season: team.season,
    city: team.city,
    name: team.name,
    record: `${team.wins}-${team.losses}`,
    missedPlayoffs: !team.madePlayoffs,
  };
}

/** `result` is team A's exported opponent entry for team B. */
export function matchupCardData(teamA: IndexTeam, teamB: IndexTeam, result: OpponentResult): MatchupCardData {
  const winner = result.p >= 0.5 ? "a" : "b";
  const winProbability = winner === "a" ? result.p : 1 - result.p;
  return {
    teamA: cardTeam(teamA),
    teamB: cardTeam(teamB),
    winner,
    winProbability,
    seriesProbability: seriesWinProbability(winProbability),
    marginText: formatMargin(Math.abs(result.m)),
  };
}

export function tournamentCardData(
  title: string,
  bracket: BracketResult,
  odds: TitleOddsResult,
  label: (key: string) => string,
  fanLine?: string,
): TournamentCardData {
  const { definition } = bracket;
  const final = bracket.rounds[bracket.rounds.length - 1][0];
  const runnerUp = final.winner === final.top ? final.bottom : final.top;
  const winnerWins = final.winner === final.top ? final.topWins : final.bottomWins;
  const loserWins = final.winner === final.top ? final.bottomWins : final.topWins;
  const topOdds = [...odds.entrants]
    .sort((a, b) => b.titleProbability - a.titleProbability || a.seed - b.seed)
    .slice(0, 4)
    .map((e) => ({ label: label(e.key), probability: e.titleProbability }));
  return {
    title,
    subtitle: `${definition.entrants.length} teams · best-of-${definition.seriesBestOf} · neutral court`,
    champion: label(bracket.champion),
    championSeed: definition.entrants.indexOf(bracket.champion) + 1,
    finalLine:
      definition.seriesBestOf === 1
        ? `Beat ${label(runnerUp)} in the final`
        : `Beat ${label(runnerUp)} ${winnerWins}-${loserWins} in the final`,
    topOdds,
    runs: odds.runs,
    fanLine,
  };
}
