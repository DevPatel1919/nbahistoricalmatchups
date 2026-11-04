// Number and season formatting for Ask the Court (F13): the port of
// src/rag/textfmt.py. Python's round() is correctly rounded half-even on the
// float's exact value, and toFixed() breaks exact ties upward, so fixed() rounds
// from the exact decimal expansion to match it digit for digit.

export const DASH = "–";

/** Python's format(round(x, digits), "." + digits + "f"). */
export function fixed(x: number, digits: number): string {
  const negative = x < 0;
  const exact = Math.abs(x).toFixed(100);
  const dot = exact.indexOf(".");
  const kept = exact.slice(0, dot + 1 + digits);
  const rest = exact.slice(dot + 1 + digits);
  const half = rest[0] === "5" && /^0*$/.test(rest.slice(1));
  const lastDigit = Number(kept[kept.length - 1] === "." ? kept[kept.length - 2] : kept[kept.length - 1]);
  const up = half ? lastDigit % 2 === 1 : rest[0] >= "5";
  let scaled = BigInt(kept.replace(".", ""));
  if (up) scaled += 1n;
  let text = scaled.toString().padStart(digits + 1, "0");
  if (digits > 0) text = text.slice(0, -digits) + "." + text.slice(-digits);
  return (negative ? "-" : "") + text;
}

/** Python's round(x, digits), as a number. */
export function rounded(x: number, digits: number): number {
  return Number(fixed(x, digits));
}

export function seasonLabel(season: number): string {
  return season - 1 + DASH + String(season % 100).padStart(2, "0");
}

export function signed(x: number, digits = 1): string {
  const text = fixed(x, digits);
  if (Number(text) === 0) return "+" + fixed(0, digits);
  return (x >= 0 ? "+" : "") + text;
}

export function pct1(x: number): string {
  return fixed(x * 100, 1) + "%";
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 10 && tens <= 20) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
}
