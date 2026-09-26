// Display text for duel puzzles and results. Pure, so it is unit-tested.

import {
  CONFIDENCE_PROBABILITY,
  pointsFor,
  type Confidence,
  type DuelResult,
  type EraKey,
  type LeaderboardKind,
  type MatchSummary,
  type PlayMode,
  type RatingChange,
  type TeamSnapshot,
} from "../duel";

export const ERA_LABELS: Record<EraKey, string> = {
  "1998-2004": "1998–2004",
  "2005-2011": "2005–2011",
  "2012-2016": "2012–2016",
  "2017-2021": "2017–2021",
  "2022-2026": "2022–2026",
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  lean: "Lean",
  confident: "Confident",
  lock: "Lock",
};

/** Signed points with a true minus sign: "+19", "−21", "0". */
export function formatPoints(points: number): string {
  if (points > 0) return "+" + points;
  if (points < 0) return "−" + Math.abs(points);
  return "0";
}

/** Points a tier wins when right and loses when wrong, e.g. [19, -21]. */
export function tierStakes(confidence: Confidence): [number, number] {
  const p = CONFIDENCE_PROBABILITY[confidence];
  return [pointsFor(p), pointsFor(1 - p)];
}

export function formatRecord(wins: number, losses: number): string {
  return wins + "–" + losses;
}

export function formatRest(team: Pick<TeamSnapshot, "restDays" | "backToBack">): string {
  if (team.backToBack) return "Back-to-back";
  if (team.restDays >= 7) return "7+ days";
  return team.restDays + (team.restDays === 1 ? " day" : " days");
}

export function formatLastTen(team: Pick<TeamSnapshot, "last10WinPct" | "last10NetRating">): string {
  const wins = Math.round(team.last10WinPct * 10);
  const net = team.last10NetRating;
  const netText = (net > 0 ? "+" : net < 0 ? "−" : "") + Math.abs(net).toFixed(1);
  return formatRecord(wins, 10 - wins) + ", net " + netText;
}

export function formatMissing(strength: number): string {
  if (strength <= 0) return "None";
  return strength.toFixed(1);
}

/** A probability as a whole percent that never rounds to 0% or 100%. */
export function formatPercent(p: number): string {
  const pct = Math.round(p * 100);
  if (pct >= 100) return ">99%";
  if (pct <= 0) return "<1%";
  return pct + "%";
}

export function teamLabel(team: Pick<TeamSnapshot, "city" | "name">): string {
  return team.city + " " + team.name;
}

// ---------------------------------------------------------------------------
// Results against an opponent (F09 Session 6)
// ---------------------------------------------------------------------------

/** A total in running text: true minus sign, no plus sign. */
function inText(points: number): string {
  return points < 0 ? "−" + Math.abs(points) : String(points);
}

/** The one-line headline of a revealed result. */
export function resultHeadline(result: DuelResult): string {
  const { you, model, opponent } = result;
  if (opponent) {
    const name = opponent.name;
    if (opponent.decidedBy === "forfeit") {
      return opponent.outcome === "you" ? name + " didn't lock in in time. You win by forfeit." : "You didn't lock in in time.";
    }
    if (opponent.outcome === "you") return "You beat " + name + ", " + inText(you.total) + " to " + inText(opponent.total) + ".";
    if (opponent.outcome === "opponent") return name + " won, " + inText(opponent.total) + " to " + inText(you.total) + ".";
    return "A draw with " + name + " at " + inText(you.total) + ".";
  }
  if (you.total > model.total) return "You scored " + inText(you.total) + ", ahead of the pre-game model.";
  if (you.total < model.total) return "You scored " + inText(you.total) + ". The pre-game model scored " + inText(model.total) + ".";
  return "You scored " + inText(you.total) + ", level with the pre-game model.";
}

/** "1,200 → 1,220 (+20)" */
export function formatRatingChange(change: RatingChange): string {
  return change.before.toLocaleString("en-US") + " → " + change.after.toLocaleString("en-US") + " (" + formatPoints(change.delta) + ")";
}

/** How a ranked or friend duel was settled and whether it counted, in a sentence or two; null for solo and bot sets. */
export function matchNote(mode: PlayMode, match: MatchSummary | null): string | null {
  if (!match) return null;
  if (mode === "friend") {
    return match.settledBy === "no-opponent"
      ? "Nobody took your invite in time, so this set was scored on its own. Friend duels are unranked."
      : "Friend duels are unranked.";
  }
  if (match.settledBy === "no-opponent") {
    return "No opponent joined in time, so this ranked set was scored against the Sparring Partner. It doesn't count toward your rating.";
  }
  if (!match.rated || !match.rating) return "This duel was unrated.";
  const forfeit = match.settledBy === "forfeit" ? " A forfeit counts as a loss for the player who didn't lock in." : "";
  return "Rated duel. Your rating: " + formatRatingChange(match.rating) + "." + forfeit;
}

/** "about 23 hours", "about 40 minutes", or "less than a minute". */
export function formatTimeLeft(until: number, now: number): string {
  const minutes = Math.floor((until - now) / 60000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 90) return "about " + minutes + (minutes === 1 ? " minute" : " minutes");
  const hours = Math.round(minutes / 60);
  return "about " + hours + " hours";
}

/** The analytics outcome of a revealed result, from the viewer's point of view. */
export function completionOutcome(result: DuelResult): { outcome: "win" | "loss" | "draw" | "solo"; beatModel: boolean } {
  const { opponent, you, model } = result;
  const outcome = !opponent ? "solo" : opponent.outcome === "you" ? "win" : opponent.outcome === "opponent" ? "loss" : "draw";
  return { outcome, beatModel: you.total > model.total };
}

// ---------------------------------------------------------------------------
// Leaderboards (F09 Session 7)
// ---------------------------------------------------------------------------

/** "4–1", or "4–1–2" when there are draws. */
export function formatWinLoss(wins: number, losses: number, draws: number): string {
  return formatRecord(wins, losses) + (draws > 0 ? "–" + draws : "");
}

/** What a board ranks, in a sentence. */
export function boardDescription(board: LeaderboardKind, minDuels: number): string {
  return board === "daily"
    ? "Rated duels since midnight UTC, ranked by rating gained today."
    : "Players with at least " + minDuels + " rated duels in the last 30 days, ranked by current rating.";
}

export function boardEmpty(board: LeaderboardKind, minDuels: number): string {
  return board === "daily"
    ? "No rated duels yet today."
    : "Nobody has played " + minDuels + " rated duels in the last 30 days yet.";
}
