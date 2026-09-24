// HMAC-SHA256 signed tokens: base64url(JSON payload) + "." + base64url(signature).

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret || secret.length < 16) throw new Error("Token secret missing or too short");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function sign(payload: object, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return body + "." + b64url(new Uint8Array(sig));
}

/** Returns the payload when the signature is valid, otherwise null. Never throws on bad input. */
export async function verify(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const key = await hmacKey(secret);
  const parts = token.split(".");
  if (parts.length !== 2 || token.length > 2048) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), encoder.encode(parts[0]));
    if (!ok) return null;
    const payload: unknown = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A short keyed digest, so raw identifiers such as IP addresses are never stored. */
export async function keyedHash(value: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(value));
  return b64url(new Uint8Array(sig)).slice(0, 22);
}

export function randomId(prefix: string, bytes = 16): string {
  return prefix + "_" + b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
