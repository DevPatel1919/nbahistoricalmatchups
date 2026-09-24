// Display text for duel puzzles and results. Pure, so it is unit-tested.

import { CONFIDENCE_PROBABILITY, pointsFor, type Confidence, type EraKey, type TeamSnapshot } from "../duel";

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
