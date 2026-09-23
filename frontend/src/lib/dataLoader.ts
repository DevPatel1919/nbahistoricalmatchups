// Loads the precomputed static data. index.json is small and loads on first
// paint; a team's own matchup file is only fetched once that team is chosen
// (see docs/frontend-handoff.md, "Requirements").

import type { IndexData, IndexTeam, TeamFile } from "../types";

const DATA_BASE = `${import.meta.env.BASE_URL}data/`;

let indexPromise: Promise<IndexData> | null = null;
const teamFileCache = new Map<string, Promise<TeamFile>>();

export function loadIndex(): Promise<IndexData> {
  if (!indexPromise) {
    indexPromise = fetch(`${DATA_BASE}index.json`).then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to load index.json: ${res.status}`);
      }
      return res.json() as Promise<IndexData>;
    });
  }
  return indexPromise;
}

export function loadTeamFile(key: string): Promise<TeamFile> {
  let cached = teamFileCache.get(key);
  if (!cached) {
    cached = fetch(`${DATA_BASE}teams/${key}.json`).then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to load team file for "${key}": ${res.status}`);
      }
      return res.json() as Promise<TeamFile>;
    });
    teamFileCache.set(key, cached);
  }
  return cached;
}

export function findTeam(teams: IndexTeam[], key: string): IndexTeam | undefined {
  return teams.find((t) => t.key === key);
}

export function randomTeamKey(teams: IndexTeam[], exclude?: string): string {
  let pick = teams[Math.floor(Math.random() * teams.length)];
  while (exclude && teams.length > 1 && pick.key === exclude) {
    pick = teams[Math.floor(Math.random() * teams.length)];
  }
  return pick.key;
}
