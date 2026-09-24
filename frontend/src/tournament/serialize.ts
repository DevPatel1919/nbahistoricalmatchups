// URL-safe tournament definition format, version 1:
//
//   t1.<bestOf>.<seed>.<key1>~<key2>~...~<keyN>
//   t1.7.x7k2mq9pad.1998-bulls~2017-warriors~...
//
// Keys are listed in seed order. Every character is unreserved in a URL
// (RFC 3986), so the string can sit in a path segment or query value without
// escaping. Decoding is strict: anything that does not re-encode to the exact
// same string is rejected.

import { MAX_ENTRANT_KEY_LENGTH, validateDefinition } from "./definition";
import { fail, ok, type Result, type SeriesBestOf, type TournamentDefinition } from "./types";

const PREFIX = "t1";
/** 16 entrants at the maximum key length, a 32-character seed, and separators. */
export const MAX_ENCODED_LENGTH = PREFIX.length + 3 + 32 + 1 + 16 * (MAX_ENTRANT_KEY_LENGTH + 1);

export function encodeTournament(definition: TournamentDefinition): Result<string> {
  const valid = validateDefinition(definition);
  if (!valid.ok) return valid;
  const { seriesBestOf, seed, entrants } = definition;
  return ok(`${PREFIX}.${seriesBestOf}.${seed}.${entrants.join("~")}`);
}

/**
 * Parses an encoded definition from untrusted input (a URL). Pass the keys from
 * index.json as `knownKeys` to reject team-seasons the site does not support.
 */
export function decodeTournament(
  encoded: string,
  knownKeys?: ReadonlySet<string>,
): Result<TournamentDefinition> {
  if (typeof encoded !== "string") return fail("malformed", "Expected an encoded tournament string.");
  if (encoded.length > MAX_ENCODED_LENGTH) {
    return fail("too-long", `Encoded tournament exceeds ${MAX_ENCODED_LENGTH} characters.`);
  }
  const parts = encoded.split(".");
  if (parts.length !== 4) return fail("malformed", "Expected 4 '.'-separated fields.");
  const [prefix, bestOf, seed, keys] = parts;
  if (prefix !== PREFIX) {
    return /^t\d+$/.test(prefix)
      ? fail("unsupported-version", `Tournament format "${prefix}" is not supported.`)
      : fail("malformed", "Not a tournament string.");
  }
  if (!/^\d$/.test(bestOf)) return fail("invalid-best-of", `Series length "${bestOf}" is invalid.`);

  const definition: TournamentDefinition = {
    version: 1,
    entrants: keys.split("~"),
    seed,
    seriesBestOf: Number(bestOf) as SeriesBestOf,
  };
  const valid = validateDefinition(definition, knownKeys);
  if (!valid.ok) return valid;

  // Canonical-form check: rejects anything the encoder would not produce.
  const reencoded = encodeTournament(definition);
  if (!reencoded.ok || reencoded.value !== encoded) {
    return fail("malformed", "Tournament string is not in canonical form.");
  }
  return ok(definition);
}
