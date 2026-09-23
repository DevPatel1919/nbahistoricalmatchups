// Matchup URL helpers.
//
// A single matchup is always addressed at one canonical URL:
//   /1998-bulls-vs-2017-warriors
// Canonical order: lower season first; if seasons tie, alphabetical by key.
// The reverse order redirects to the canonical URL (see ResultPage).

const SEPARATOR = "-vs-";

export function canonicalOrder(
  keyA: string,
  seasonA: number,
  keyB: string,
  seasonB: number,
): [string, string] {
  if (seasonA !== seasonB) {
    return seasonA < seasonB ? [keyA, keyB] : [keyB, keyA];
  }
  return keyA <= keyB ? [keyA, keyB] : [keyB, keyA];
}

export function buildMatchupSlug(keyA: string, keyB: string): string {
  return `${keyA}${SEPARATOR}${keyB}`;
}

export function parseMatchupSlug(slug: string): [string, string] | null {
  const idx = slug.indexOf(SEPARATOR);
  if (idx === -1) return null;
  const a = slug.slice(0, idx);
  const b = slug.slice(idx + SEPARATOR.length);
  if (!a || !b || b.includes(SEPARATOR)) return null;
  return [a, b];
}
