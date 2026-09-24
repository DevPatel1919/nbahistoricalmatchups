// Guest identity. A guest is a random id in a signed token the browser keeps.
// Guests can play every unranked mode; they cannot enter ranked or the board.

import type { Env } from "./env";
import { ApiError } from "./http";
import { LIMITS, enforce } from "./ratelimit";
import { keyedHash, randomId, sign, verify } from "./tokens";

export type Participant = { id: string; kind: "guest"; guestId: string };

export async function clientKey(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return keyedHash("ip:" + ip, env.GUEST_TOKEN_SECRET);
}

export async function createGuest(request: Request, env: Env): Promise<{ guestToken: string }> {
  await enforce(env.RATE_LIMITS, LIMITS.guestCreatePerIp, await clientKey(request, env), Number(env.RATE_LIMIT_SCALE));
  const guestId = randomId("g");
  await env.DB.prepare("INSERT INTO guests (id, created_at) VALUES (?, ?)").bind(guestId, Date.now()).run();
  return { guestToken: await sign({ v: 1, typ: "guest", sub: guestId }, env.GUEST_TOKEN_SECRET) };
}

export async function requireParticipant(request: Request, env: Env): Promise<Participant> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (\S+)$/.exec(header);
  if (!match) throw new ApiError("unauthorized");
  const payload = await verify(match[1], env.GUEST_TOKEN_SECRET);
  if (!payload || payload.v !== 1 || payload.typ !== "guest" || typeof payload.sub !== "string") {
    throw new ApiError("unauthorized");
  }
  const guest = await env.DB.prepare("SELECT id FROM guests WHERE id = ?").bind(payload.sub).first();
  if (!guest) throw new ApiError("unauthorized");
  return { id: "g:" + payload.sub, kind: "guest", guestId: payload.sub };
}
