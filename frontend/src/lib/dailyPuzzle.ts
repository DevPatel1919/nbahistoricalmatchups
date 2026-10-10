// Assembles today's Daily Three puzzle for the page (F12 Session 3): the day
// file's games, each team's card (index.json for the era-correct name, the
// pool for the record and starting five), and each game's simulated result.
//
// The results are computed when the puzzle loads but stay out of the UI until
// lock-in. Each game is simulated with the engine its day file pins, never
// meta.json's (Session 2 record).

import { simulateGame, type SimGame } from "../daily/sim";
import type { DailyDay, DailyGame, DailyPool, Side, Starter } from "../daily/types";
import type { ShareTeam } from "../daily/share";
import type { IndexTeam } from "../types";

export type CardTeam = {
  key: string;
  season: number;
  city: string;
  name: string;
  wins: number;
  losses: number;
  starters: Starter[];
};

export type PuzzleGame = {
  /** 0..2; the featured game is 2. */
  index: number;
  game: DailyGame;
  teams: [CardTeam, CardTeam];
  sim: SimGame;
};

export type Puzzle = { n: number; date: string; games: PuzzleGame[] };

export function buildPuzzle(day: DailyDay, pool: DailyPool, indexTeams: IndexTeam[]): Puzzle {
  const byKey = new Map(indexTeams.map((t) => [t.key, t]));
  const card = (key: string): CardTeam => {
    const team = byKey.get(key);
    const entry = pool.teams[key];
    if (!team || !entry) throw new Error(`Daily Three has no team data for ${key}`);
    return {
      key,
      season: team.season,
      city: team.city,
      name: team.name,
      wins: entry.wins,
      losses: entry.losses,
      starters: entry.starters,
    };
  };
  const games = day.games.map((game, index): PuzzleGame => {
    const teamA = pool.teams[game.a];
    const teamB = pool.teams[game.b];
    if (!teamA || !teamB) throw new Error(`Daily Three has no pool entry for game ${index + 1}`);
    return {
      index,
      game,
      teams: [card(game.a), card(game.b)],
      sim: simulateGame({ engine: day.engine, n: day.n, gameIndex: index, game, teamA, teamB }),
    };
  });
  return { n: day.n, date: day.date, games };
}

export function puzzleWinners(puzzle: Puzzle): Side[] {
  return puzzle.games.map((g) => g.sim.winner);
}

/** The share text's team names: season and era-correct nickname. */
export function shareTeams(puzzle: Puzzle): Record<string, ShareTeam> {
  const teams: Record<string, ShareTeam> = {};
  for (const g of puzzle.games) for (const t of g.teams) teams[t.key] = { season: t.season, name: t.name };
  return teams;
}
