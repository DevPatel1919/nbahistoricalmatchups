// Picker search: a single box where "bulls 98", "98 bulls" and
// "2017 warriors" all match. Matches against season, city and nickname;
// exact nickname matches rank first.

import type { IndexTeam } from "../types";

const MIN_SEASON = 1998;
const MAX_SEASON = 2026;

/** Expand a bare 2-digit year token ("98", "17") to the one in-range season it can mean. */
function expandYearToken(token: string): number | null {
  if (!/^\d{2}$/.test(token)) return null;
  const n = Number(token);
  const as1900 = 1900 + n;
  const as2000 = 2000 + n;
  if (as1900 >= MIN_SEASON && as1900 <= MAX_SEASON) return as1900;
  if (as2000 >= MIN_SEASON && as2000 <= MAX_SEASON) return as2000;
  return null;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Score one token against one team. Returns null if the token matches nothing. */
function scoreToken(team: IndexTeam, token: string): number | null {
  // Season, either as a full 4-digit year or a bare 2-digit shorthand.
  if (/^\d{4}$/.test(token)) {
    if (Number(token) === team.season) return 100;
  } else {
    const expanded = expandYearToken(token);
    if (expanded !== null && expanded === team.season) return 100;
  }

  const nickname = team.name.toLowerCase();
  const nicknameSlug = nickname.replace(/\s+/g, "-");
  if (token === nickname || token === nicknameSlug) return 90;

  const city = team.city.toLowerCase();
  if (city === token) return 60;

  if (nickname.includes(token)) return 40;
  if (city.split(/\s+/).some((word) => word.startsWith(token))) return 20;
  if (city.includes(token)) return 10;

  return null;
}

export interface SearchResult {
  team: IndexTeam;
  score: number;
}

export function searchTeams(teams: IndexTeam[], query: string, limit = 30): IndexTeam[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const results: SearchResult[] = [];
  for (const team of teams) {
    let total = 0;
    let matchedAll = true;
    for (const token of tokens) {
      const s = scoreToken(team, token);
      if (s === null) {
        matchedAll = false;
        break;
      }
      total += s;
    }
    if (matchedAll) {
      results.push({ team, score: total });
    }
  }

  results.sort((a, b) => b.score - a.score || a.team.season - b.team.season);
  return results.slice(0, limit).map((r) => r.team);
}
