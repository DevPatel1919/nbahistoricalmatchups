// The projected margin is a rough regressor estimate (typical error on real
// games was about 11 points: hist-v2's ridge regressor, test MAE 11.4, per
// reports/hist_v2_evaluation.md), so it is never shown with decimals or as a
// precise number.

export function formatMargin(points: number): string {
  const rounded = Math.round(Math.abs(points));
  if (rounded < 1) return "by under 1 pt";
  return `by about ${rounded} ${rounded === 1 ? "pt" : "pts"}`;
}
