// Display-name moderation. A name is checked on its folded form, so case,
// accents, spacing, punctuation, and digit-for-letter swaps cannot slip a
// reserved or blocked word past the list, and two names that fold the same
// cannot both exist (display_name_key is UNIQUE in D1).

export const NAME_MIN = 3;
export const NAME_MAX = 20;
/** First name is free; after that one rename per window. */
export const RENAME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Names that would impersonate the site, its staff, the league, or the two
// non-human lines on every result. Matched as a substring of the folded name.
const RESERVED = [
  "admin",
  "administrator",
  "moderator",
  "staff",
  "support",
  "official",
  "courtofalltime",
  "sparringpartner",
  "pregamemodel",
  "nba",
  "system",
  "anthropic",
  "claude",
];

// Matched only as the whole folded name: short words that are fine inside
// other names ("Modesto", "Botswana") but not alone.
const RESERVED_EXACT = ["mod", "bot", "model", "team", "root", "null", "undefined", "anonymous", "guest", "you"];
// Abusive words that are also common inside innocent names ("Grapefruit"), so
// they are blocked only as the whole folded name.
const BLOCKED_EXACT = ["rape", "rapist", "fag", "fags"];

// A starter list of abusive words, matched as substrings of the folded name.
// Owner: extend it before launch; the check is unchanged by the list's size.
const BLOCKED = [
  "fuck",
  "shit",
  "cunt",
  "bitch",
  "whore",
  "slut",
  "nigg",
  "retard",
  "nazi",
  "hitler",
  "kkk",
  "penis",
  "vagina",
  "porn",
];

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g" };

/** The name with accents split off and dropped ("José" -> "Jose"). */
function stripAccents(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "");
}

/** Lowercase letters and digits only, accents stripped, digit look-alikes mapped to letters. */
export function foldName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/[0-9]/g, (d) => LEET[d] ?? d);
}

export type NameCheck = { ok: true; name: string; key: string } | { ok: false; reason: NameRejection };
export type NameRejection = "length" | "characters" | "reserved" | "blocked";

/**
 * Latin letters (accents allowed), digits, spaces, and . _ - (never doubled); must
 * start and end with a letter or digit. Other scripts are refused because a
 * Cyrillic "а" folds to nothing and would slip "аdmin" past the reserved list;
 * allowing them needs a confusables table. Returns the tidied name and its
 * folded uniqueness key.
 */
export function checkDisplayName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "characters" };
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length < NAME_MIN || name.length > NAME_MAX) return { ok: false, reason: "length" };
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9 ._-]*[A-Za-z0-9])?$/.test(stripAccents(name))) return { ok: false, reason: "characters" };
  // "D.J. Hoops" is fine; "a__b" and "a.-_b" are not.
  if (/([ ._-])\1|[ ._-]{3}/.test(name)) return { ok: false, reason: "characters" };
  const key = foldName(name);
  if (key.length < NAME_MIN) return { ok: false, reason: "characters" };
  // Check the digit-mapped fold and the plain one, so "b0t" and "n8a" are both caught.
  const plain = stripAccents(name).toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const form of [key, plain]) {
    if (RESERVED_EXACT.includes(form)) return { ok: false, reason: "reserved" };
    if (RESERVED.some((w) => form.includes(w))) return { ok: false, reason: "reserved" };
    if (BLOCKED_EXACT.includes(form) || BLOCKED.some((w) => form.includes(w))) return { ok: false, reason: "blocked" };
  }
  return { ok: true, name, key };
}
