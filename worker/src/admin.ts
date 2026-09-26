// The internal review queue (F09 Session 7). A reviewer lists open flags with
// their evidence and decides each one: clear (back on the board) or uphold
// (stays off the board). Nothing here bans an account or changes a rating;
// those would be separate, deliberate owner actions.
//
// Auth is one long random ADMIN_TOKEN secret (`wrangler secret put ADMIN_TOKEN`).
// Without it every admin path answers 404, as does a wrong token, so the
// endpoints are indistinguishable from missing ones. worker/scripts/review-queue.mjs
// is a small command-line client.

import type { Env } from "./env";
import { ApiError } from "./http";
import { runIntegritySweep, type SweepReport } from "./integrity";
import { LIMITS, enforce } from "./ratelimit";
import { sha256Hex } from "./tokens";

export const ADMIN_TOKEN_MIN_LENGTH = 32;
const NOTE_MAX = 500;

export type FlagStatus = "open" | "cleared" | "upheld";

export type FlagView = {
  id: string;
  accountId: string;
  displayName: string | null;
  kind: string;
  relatedAccountId: string | null;
  relatedDisplayName: string | null;
  status: FlagStatus;
  evidence: unknown;
  createdAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  reviewNote: string | null;
  account: { createdAt: number; rating: number | null; ratedDuels: number };
};

export async function requireAdmin(request: Request, env: Env, ipKey: string): Promise<void> {
  const configured = env.ADMIN_TOKEN;
  if (!configured || configured.length < ADMIN_TOKEN_MIN_LENGTH) throw new ApiError("not_found");
  // Counted before the token check, so guessing is rate-limited.
  await enforce(env.RATE_LIMITS, LIMITS.adminPerIp, ipKey, Number(env.RATE_LIMIT_SCALE));
  const presented = /^Bearer (\S{1,200})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  // Comparing digests keeps the comparison's timing independent of the secret.
  if (!presented || (await sha256Hex(presented)) !== (await sha256Hex(configured))) throw new ApiError("not_found");
}

type FlagRow = {
  id: string;
  account_id: string;
  display_name: string | null;
  kind: string;
  related: string;
  related_name: string | null;
  status: FlagStatus;
  evidence: string;
  created_at: number;
  updated_at: number;
  reviewed_at: number | null;
  review_note: string | null;
  account_created_at: number;
  rating: number | null;
  rated_duels: number | null;
};

const FLAG_SELECT = `SELECT f.*, a.display_name, ra.display_name AS related_name, a.created_at AS account_created_at, r.rating, r.rated_duels
  FROM integrity_flags f
  JOIN accounts a ON a.id = f.account_id
  LEFT JOIN accounts ra ON ra.id = f.related
  LEFT JOIN ratings r ON r.account_id = f.account_id`;

function toView(row: FlagRow): FlagView {
  return {
    id: row.id,
    accountId: row.account_id,
    displayName: row.display_name,
    kind: row.kind,
    relatedAccountId: row.related || null,
    relatedDisplayName: row.related_name,
    status: row.status,
    evidence: JSON.parse(row.evidence) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    account: { createdAt: row.account_created_at, rating: row.rating, ratedDuels: row.rated_duels ?? 0 },
  };
}

/** GET /v1/admin/flags?status=open (default) | cleared | upheld, oldest first. */
export async function listFlags(env: Env, url: URL): Promise<{ flags: FlagView[] }> {
  const status = url.searchParams.get("status") ?? "open";
  if (status !== "open" && status !== "cleared" && status !== "upheld") throw new ApiError("bad_request");
  const rows = await env.DB.prepare(FLAG_SELECT + " WHERE f.status = ? ORDER BY f.created_at, f.id LIMIT 200").bind(status).all<FlagRow>();
  return { flags: rows.results.map(toView) };
}

/**
 * POST /v1/admin/flags/:id { decision: "clear" | "uphold", note? }. An open flag
 * can be cleared or upheld; an upheld flag can later be cleared (an appeal).
 * The allowed transition is part of the UPDATE, so two reviewers cannot both decide.
 */
export async function decideFlag(env: Env, flagId: string, body: unknown, now: number): Promise<FlagView> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.decision !== "clear" && b.decision !== "uphold") throw new ApiError("bad_request");
  if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > NOTE_MAX)) throw new ApiError("bad_request");
  const status = b.decision === "clear" ? "cleared" : "upheld";
  const from = b.decision === "clear" ? ["open", "upheld"] : ["open"];
  const result = await env.DB.prepare(
    `UPDATE integrity_flags SET status = ?, reviewed_at = ?, review_note = ?
     WHERE id = ? AND status IN (SELECT value FROM json_each(?))`,
  )
    .bind(status, now, typeof b.note === "string" ? b.note : null, flagId, JSON.stringify(from))
    .run();
  const row = await env.DB.prepare(FLAG_SELECT + " WHERE f.id = ?").bind(flagId).first<FlagRow>();
  if (!row) throw new ApiError("not_found");
  if (result.meta.changes === 0) throw new ApiError("flag_decided");
  return toView(row);
}

/** POST /v1/admin/sweep: runs the detectors now instead of waiting for the schedule. */
export function sweepNow(env: Env): Promise<SweepReport> {
  return runIntegritySweep(env, Date.now());
}
