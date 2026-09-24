// Fixed-window request counters in KV. KV is eventually consistent, so a burst
// spread across edge locations can exceed a limit slightly. These limits stop
// sustained abuse; the D1 constraints, not these counters, are what make double
// submission impossible. WAF rate limits sit in front (owner setup).

import { ApiError } from "./http";

export type Limit = { name: string; max: number; windowSeconds: number };

export const LIMITS = {
  guestCreatePerIp: { name: "guest-ip", max: 10, windowSeconds: 3600 },
  setIssuePerParticipant: { name: "set-sub", max: 40, windowSeconds: 3600 },
  setIssuePerIp: { name: "set-ip", max: 120, windowSeconds: 3600 },
  submitPerParticipant: { name: "submit-sub", max: 60, windowSeconds: 3600 },
} as const satisfies Record<string, Limit>;

/** `scale` multiplies every limit; production uses 1 (wrangler.jsonc), local e2e runs raise it. */
export async function enforce(kv: KVNamespace, limit: Limit, subject: string, scale = 1, now = Date.now()): Promise<void> {
  // A missing or malformed scale must never disable a limit.
  const max = limit.max * (Number.isFinite(scale) ? Math.max(1, scale) : 1);
  const window = Math.floor(now / 1000 / limit.windowSeconds);
  const key = "rl:" + limit.name + ":" + subject + ":" + window;
  const count = Number((await kv.get(key)) ?? "0");
  if (count >= max) {
    const retryAfter = (window + 1) * limit.windowSeconds - Math.floor(now / 1000);
    throw new ApiError("rate_limited", Math.max(1, retryAfter));
  }
  // KV requires a TTL of at least 60 seconds.
  await kv.put(key, String(count + 1), { expirationTtl: Math.max(60, limit.windowSeconds * 2) });
}
