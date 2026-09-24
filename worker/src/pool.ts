// The puzzle pool in KV, loaded from the generator's artifacts by
// scripts/build-pool-kv.mjs. Answers live only here and in D1 results.
//
// Keys (v = POOL_VERSION):
//   pool:<v>:puzzle:<puzzleId>            -> StoredPuzzle
//   pool:<v>:index:sim:<era|all>:<band>   -> string[] of puzzle ids
//   pool:<v>:index:ranked:<era|all>       -> string[] of puzzle ids

import type { Band, EraKey, PuzzleAnswer, PuzzleView, TeamSnapshot } from "../../frontend/src/duel";
import { ApiError } from "./http";

export type StoredAnswer = PuzzleAnswer & {
  modelInSample: boolean;
  band: Band | "extreme";
  partition: "sim" | "ranked";
};

export type StoredPuzzle = { view: PuzzleView; answer: StoredAnswer };

export function puzzleKey(version: string, id: string): string {
  return "pool:" + version + ":puzzle:" + id;
}

export function simIndexKey(version: string, era: EraKey | "all", band: Band): string {
  return "pool:" + version + ":index:sim:" + era + ":" + band;
}

export function rankedIndexKey(version: string, era: EraKey | "all"): string {
  return "pool:" + version + ":index:ranked:" + era;
}

export async function readIndex(kv: KVNamespace, key: string): Promise<string[]> {
  const ids = await kv.get<string[]>(key, { type: "json", cacheTtl: 300 });
  if (!Array.isArray(ids) || ids.length === 0) throw new ApiError("pool_unavailable");
  return ids;
}

export async function readPuzzles(kv: KVNamespace, version: string, ids: readonly string[]): Promise<StoredPuzzle[]> {
  const puzzles = await Promise.all(
    ids.map((id) => kv.get<StoredPuzzle>(puzzleKey(version, id), { type: "json", cacheTtl: 300 })),
  );
  if (puzzles.some((p) => !p)) throw new ApiError("pool_unavailable");
  return puzzles as StoredPuzzle[];
}

function toTeamSnapshot(t: TeamSnapshot): TeamSnapshot {
  return {
    city: t.city,
    name: t.name,
    winsEntering: t.winsEntering,
    lossesEntering: t.lossesEntering,
    restDays: t.restDays,
    backToBack: t.backToBack,
    last10NetRating: t.last10NetRating,
    last10WinPct: t.last10WinPct,
    missingRotationStrength: t.missingRotationStrength,
  };
}

/** Copies only the whitelisted pre-lock fields, so nothing extra can ride along. */
export function toPuzzleView(p: StoredPuzzle): PuzzleView {
  return {
    puzzleId: p.view.puzzleId,
    era: p.view.era,
    isPlayoffGame: p.view.isPlayoffGame,
    home: toTeamSnapshot(p.view.home),
    away: toTeamSnapshot(p.view.away),
  };
}
