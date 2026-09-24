// Loads a tournament for display: decodes a shared code (or the curated
// Champions definition when there is none), fetches the entrants' team files,
// and plays the seeded story. Shared by the tournament page and its share card.

import {
  buildMatchupTable,
  decodeTournament,
  encodeTournament,
  runBracket,
  validateDefinition,
  type BracketResult,
  type MatchupTable,
  type TournamentDefinition,
} from "../tournament";
import { CHAMPIONS, CURATED_TOURNAMENTS, type CuratedTournament } from "../data/curated-tournaments";
import type { IndexTeam } from "../types";
import { loadIndex, loadTeamFile } from "./dataLoader";

export interface EntrantInfo {
  team: IndexTeam;
  seed: number;
}

export interface LoadedTournament {
  code: string;
  definition: TournamentDefinition;
  curated: CuratedTournament | null;
  entrants: Map<string, EntrantInfo>;
  table: MatchupTable;
  bracket: BracketResult;
}

export type TournamentLoad =
  | ({ kind: "ready" } & LoadedTournament)
  /** The definition is unusable; `code` is the engine error code. */
  | { kind: "invalid"; code: string; message: string };

function curatedFor(code: string): CuratedTournament | null {
  return (
    CURATED_TOURNAMENTS.find((t) => {
      const encoded = encodeTournament(t.definition);
      return encoded.ok && encoded.value === code;
    }) ?? null
  );
}

/** Rejects only when the data itself fails to load (network, missing file). */
export async function loadTournament(code: string | undefined): Promise<TournamentLoad> {
  const index = await loadIndex();
  const known = new Set(index.teams.map((t) => t.key));
  const decoded = code === undefined ? validateDefinition(CHAMPIONS.definition, known) : decodeTournament(code, known);
  if (!decoded.ok) return { kind: "invalid", code: decoded.error.code, message: decoded.error.message };
  const definition = decoded.value;
  const encoded = encodeTournament(definition);
  if (!encoded.ok) return { kind: "invalid", code: encoded.error.code, message: encoded.error.message };

  const files = await Promise.all(definition.entrants.map((key) => loadTeamFile(key)));
  const table = buildMatchupTable(files);
  if (!table.ok) return { kind: "invalid", code: table.error.code, message: table.error.message };
  const bracket = runBracket(definition, table.value);
  if (!bracket.ok) return { kind: "invalid", code: bracket.error.code, message: bracket.error.message };

  const byKey = new Map<string, IndexTeam>(index.teams.map((t) => [t.key, t]));
  const entrants = new Map<string, EntrantInfo>(
    definition.entrants.map((key, i) => [key, { team: byKey.get(key)!, seed: i + 1 }]),
  );
  return {
    kind: "ready",
    code: encoded.value,
    definition,
    curated: curatedFor(encoded.value),
    entrants,
    table: table.value,
    bracket: bracket.value,
  };
}
