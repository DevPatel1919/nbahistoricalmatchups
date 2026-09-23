// Local persistence of a fan's progress through one tournament (F04).
//
// Keyed by the encoded definition, so each seeded story has its own picks and
// reveal state. Nothing here leaves the browser: personal picks are never put
// in a URL. Storage can be unavailable (private mode, blocked site data), so
// every access is guarded and the page works without it.

import { isValidPicks, type Picks } from "./bracket";

export interface TournamentProgress {
  started: boolean;
  picks: Picks;
  /** Rounds of the model bracket revealed so far (0 = none). */
  revealed: number;
  /** Set once bracket_predictions_completed has been reported. */
  completionTracked: boolean;
}

const PREFIX = "ct:tournament:v1:";

export function loadProgress(code: string, entrants: readonly string[]): TournamentProgress | null {
  try {
    const raw = localStorage.getItem(PREFIX + code);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<TournamentProgress>;
    if (!isValidPicks(entrants, data.picks)) return null;
    const revealed = Number.isInteger(data.revealed) ? Math.max(0, Math.min(data.revealed!, data.picks.length)) : 0;
    return {
      started: data.started === true,
      picks: data.picks,
      revealed,
      completionTracked: data.completionTracked === true,
    };
  } catch {
    return null;
  }
}

export function saveProgress(code: string, progress: TournamentProgress): void {
  try {
    localStorage.setItem(PREFIX + code, JSON.stringify(progress));
  } catch {
    // Storage full or blocked: the tournament still works for this visit.
  }
}

export function clearProgress(code: string): void {
  try {
    localStorage.removeItem(PREFIX + code);
  } catch {
    // Nothing to clear.
  }
}
