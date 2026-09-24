// Series odds from a single-game neutral-court win probability. Each game is
// treated as an independent trial at the same probability
// (see docs/frontend-handoff.md, "Series odds").
//
// With w = ceil(bestOf / 2) wins needed:
// P(series) = sum over k=w..2w-1 of C(k-1, w-1) * p^w * (1-p)^(k-w)

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

export function seriesWinProbability(p: number, bestOf: number = 7): number {
  const need = Math.ceil(bestOf / 2);
  let total = 0;
  for (let k = need; k <= 2 * need - 1; k++) {
    total += choose(k - 1, need - 1) * p ** need * (1 - p) ** (k - need);
  }
  return total;
}
