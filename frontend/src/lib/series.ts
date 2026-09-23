// Best-of-7 series odds from a single-game neutral-court win probability.
// Each game is treated as an independent trial at the same probability
// (see docs/frontend-handoff.md, "Series odds").
//
// P(series) = sum over k=4..7 of C(k-1, 3) * p^4 * (1-p)^(k-4)

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

export function seriesWinProbability(p: number): number {
  let total = 0;
  for (let k = 4; k <= 7; k++) {
    total += choose(k - 1, 3) * p ** 4 * (1 - p) ** (k - 4);
  }
  return total;
}
