// Participants. A guest is a random id in a signed token the browser keeps; an
// account holds an opaque session token issued after a magic-link sign-in.
// Guests play every unranked mode; only accounts can reach ranked (accounts.ts).

import type { Env } from "./env";
import { ApiError } from "./http";
import { LIMITS, enforce } from "./ratelimit";
import { keyedHash, randomId, sha256Hex, sign, verify } from "./tokens";

export type Participant =
  | { id: string; kind: "guest"; guestId: string }
  | { id: string; kind: "account"; accountId: string };

export const SESSION_PREFIX = "s_";

export async function clientKey(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return keyedHash("ip:" + ip, env.GUEST_TOKEN_SECRET);
}

/**
 * False when a request carries no real client address: local development,
 * where every request is loopback. Network signals are skipped then, since one
 * shared "network" would link every local account.
 */
export function hasClientNetwork(request: Request): boolean {
  const ip = request.headers.get("cf-connecting-ip");
  return ip !== null && !/^(127\.|::1$|::ffff:127\.)/.test(ip);
}

export async function createGuest(request: Request, env: Env): Promise<{ guestToken: string }> {
  await enforce(env.RATE_LIMITS, LIMITS.guestCreatePerIp, await clientKey(request, env), Number(env.RATE_LIMIT_SCALE));
  const guestId = randomId("g");
  await env.DB.prepare("INSERT INTO guests (id, created_at) VALUES (?, ?)").bind(guestId, Date.now()).run();
  return { guestToken: await sign({ v: 1, typ: "guest", sub: guestId }, env.GUEST_TOKEN_SECRET) };
}

/** The guest id in a valid token for a guest not yet merged into an account, else null. */
export async function activeGuestId(token: string, env: Env): Promise<string | null> {
  const payload = await verify(token, env.GUEST_TOKEN_SECRET);
  if (!payload || payload.v !== 1 || payload.typ !== "guest" || typeof payload.sub !== "string") return null;
  const guest = await env.DB.prepare("SELECT id FROM guests WHERE id = ? AND account_id IS NULL").bind(payload.sub).first();
  return guest ? payload.sub : null;
}

/** The account behind a live session token, else null. */
export async function sessionAccountId(token: string, env: Env): Promise<string | null> {
  if (!token.startsWith(SESSION_PREFIX) || token.length > 100) return null;
  const row = await env.DB.prepare(
    "SELECT account_id FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
  )
    .bind(await sha256Hex(token), Date.now())
    .first<{ account_id: string }>();
  return row?.account_id ?? null;
}

export function bearer(request: Request): string {
  const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
  if (!match) throw new ApiError("unauthorized");
  return match[1];
}

export async function requireParticipant(request: Request, env: Env): Promise<Participant> {
  const token = bearer(request);
  if (token.startsWith(SESSION_PREFIX)) {
    const accountId = await sessionAccountId(token, env);
    if (!accountId) throw new ApiError("unauthorized");
    return { id: "a:" + accountId, kind: "account", accountId };
  }
  const guestId = await activeGuestId(token, env);
  if (!guestId) throw new ApiError("unauthorized");
  return { id: "g:" + guestId, kind: "guest", guestId };
}

export async function requireAccount(request: Request, env: Env): Promise<{ accountId: string; token: string }> {
  const token = bearer(request);
  const accountId = await sessionAccountId(token, env);
  if (!accountId) throw new ApiError("unauthorized");
  return { accountId, token };
}
