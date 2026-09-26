// Accounts: magic-link sign-in, sessions, display names, guest upgrade, and
// ranked eligibility. Integrity rules live in D1 constraints (0002_accounts.sql):
// a link is single-use because its redemption row has a primary key, and a
// name is unique by its folded key.
//
// Stored per account: a keyed hash of the normalised email (never the address),
// an optional display name, and timestamps. The address itself is used once, to
// send the link, and is not written anywhere.

import { ELO_PROVISIONAL_DUELS, type AccountView, type SignInResult } from "../../frontend/src/duel";
import { activeGuestId, clientKey, hasClientNetwork, type Participant } from "./auth";
import { hiddenFromBoard, recordCreationNetwork } from "./integrity";
import type { Env } from "./env";
import { ApiError } from "./http";
import { RENAME_WINDOW_MS, checkDisplayName } from "./names";
import { LIMITS, enforce } from "./ratelimit";
import { ServiceUnavailable, type Services } from "./services";
import { keyedHash, randomId, sha256Hex } from "./tokens";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Completed sets (solo or bot, including upgraded guest history) before ranked unlocks. Owner-tunable. */
export const RANKED_MIN_COMPLETED_DUELS = 10;

const MAGIC_LINK_PATTERN = /^ml_[A-Za-z0-9_-]{43}$/;

function asRecord(body: unknown): Record<string, unknown> {
  return (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
}

function scale(env: Env): number {
  return Number(env.RATE_LIMIT_SCALE);
}

function isUniqueViolation(error: unknown, table: string): boolean {
  return error instanceof Error && new RegExp("UNIQUE constraint failed: " + table + "\\.|PRIMARY KEY.*" + table, "i").test(error.message);
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/** A trimmed, plausible address to send to, or null. */
export function parseEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim();
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

/**
 * The form accounts are keyed by: lowercase, "+tag" removed, and Gmail's
 * ignored dots removed, so one inbox cannot mint many accounts by aliasing.
 */
export function canonicalEmail(email: string): string {
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  let local = lower.slice(0, at).split("+")[0];
  let domain = lower.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return local + "@" + domain;
}

async function emailHash(email: string, env: Env): Promise<string> {
  return keyedHash("email:" + canonicalEmail(email), env.EMAIL_HASH_SECRET);
}

function linkOrigin(env: Env): string {
  const origins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  // A link must only ever point at a site this API already trusts.
  if (!env.APP_ORIGIN || !origins.includes(env.APP_ORIGIN)) throw new ServiceUnavailable("APP_ORIGIN not allowed");
  return env.APP_ORIGIN;
}

function signInMessage(to: string, link: string) {
  return {
    to,
    subject: "Your Court of All Time sign-in link",
    text: [
      "Use this link to sign in to Court of All Time duel mode:",
      "",
      link,
      "",
      "It works once and expires in 15 minutes.",
      "If you didn't ask for it, ignore this email; nothing happens without the link.",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------

/** POST /v1/auth/magic-link. Always the same answer, whether or not an account exists. */
export async function requestMagicLink(request: Request, env: Env, services: Services, body: unknown): Promise<{ ok: true }> {
  const b = asRecord(body);
  const email = parseEmail(b.email);
  if (!email) throw new ApiError("invalid_email");
  await enforce(env.RATE_LIMITS, LIMITS.magicLinkPerIp, await clientKey(request, env), scale(env));
  const turnstileToken = typeof b.turnstileToken === "string" ? b.turnstileToken : "";
  if (!(await services.humanCheck.verify(turnstileToken, request.headers.get("cf-connecting-ip")))) {
    throw new ApiError("human_check_failed");
  }
  const hash = await emailHash(email, env);
  await enforce(env.RATE_LIMITS, LIMITS.magicLinkPerEmail, hash, scale(env));

  const origin = linkOrigin(env);
  const token = randomId("ml", 32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO magic_links (token_hash, email_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), hash, now, now + MAGIC_LINK_TTL_MS)
    .run();
  // The token rides in the fragment, so it never reaches a server log or a Referer header.
  await services.mailer.send(signInMessage(email, origin + "/account/verify#token=" + token));
  return { ok: true };
}

type LinkRow = { email_hash: string; expires_at: number; redeemed: string | null };

/**
 * POST /v1/auth/verify { token, guestToken? }. Redeems the link, creates the
 * account on first use, opens a session, and merges the presenting browser's
 * guest history, all in one D1 batch: a reused link fails the whole batch.
 */
export async function verifyMagicLink(request: Request, env: Env, body: unknown): Promise<SignInResult> {
  const ipKey = await clientKey(request, env);
  await enforce(env.RATE_LIMITS, LIMITS.verifyPerIp, ipKey, scale(env));
  const b = asRecord(body);
  if (typeof b.token !== "string" || !MAGIC_LINK_PATTERN.test(b.token)) throw new ApiError("link_invalid");
  const linkHash = await sha256Hex(b.token);
  const now = Date.now();
  const link = await env.DB.prepare(
    `SELECT l.email_hash, l.expires_at, r.token_hash AS redeemed FROM magic_links l
     LEFT JOIN magic_link_redemptions r ON r.token_hash = l.token_hash WHERE l.token_hash = ?`,
  )
    .bind(linkHash)
    .first<LinkRow>();
  if (!link || link.redeemed || now > link.expires_at) throw new ApiError("link_invalid");

  const existing = await env.DB.prepare("SELECT id FROM accounts WHERE email_hash = ?").bind(link.email_hash).first<{ id: string }>();
  if (!existing) {
    await enforce(env.RATE_LIMITS, LIMITS.accountCreatePerIp, ipKey, scale(env));
    const asn = (request as { cf?: { asn?: unknown } }).cf?.asn;
    if (typeof asn === "number") await enforce(env.RATE_LIMITS, LIMITS.accountCreatePerAsn, "asn:" + asn, scale(env));
  }
  // A bad or already-merged guest token never blocks sign-in; it just merges nothing.
  const guestId = typeof b.guestToken === "string" ? await activeGuestId(b.guestToken, env) : null;

  const sessionToken = randomId("s", 32); // "s_…": SESSION_PREFIX
  const accountIdSql = "(SELECT id FROM accounts WHERE email_hash = ?)";
  const statements = [
    env.DB.prepare("INSERT INTO magic_link_redemptions (token_hash, redeemed_at) VALUES (?, ?)").bind(linkHash, now),
    env.DB.prepare("INSERT INTO accounts (id, email_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (email_hash) DO NOTHING")
      .bind(randomId("a"), link.email_hash, now),
    env.DB.prepare(`INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ${accountIdSql}, ?, ?)`)
      .bind(await sha256Hex(sessionToken), link.email_hash, now, now + SESSION_TTL_MS),
  ];
  if (guestId) statements.push(...upgradeGuest(env, guestId, accountIdSql, link.email_hash));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error, "magic_link_redemptions")) throw new ApiError("link_invalid");
    throw error;
  }
  const account = await env.DB.prepare("SELECT id, created_at FROM accounts WHERE email_hash = ?")
    .bind(link.email_hash)
    .first<{ id: string; created_at: number }>();
  if (!account) throw new Error("account missing after sign-in");
  if (!existing && account.created_at === now && hasClientNetwork(request)) {
    // Multi-account velocity signal. It must never block a sign-in.
    await recordCreationNetwork(env, ipKey, account.id, now).catch((error: unknown) => {
      console.error("duel-api network signal failed", error instanceof Error ? error.name : typeof error);
    });
  }
  return { sessionToken, account: await accountView(env, account.id) };
}

/**
 * Re-keys every row the guest owns from 'g:<guestId>' to 'a:<accountId>' and
 * retires the guest id. Tables are keyed by participant, so this is an update,
 * not a copy. Foreign keys are checked at commit, after all rows have moved.
 */
function upgradeGuest(env: Env, guestId: string, accountIdSql: string, emailHashValue: string): D1PreparedStatement[] {
  const from = "g:" + guestId;
  const to = `'a:' || ${accountIdSql}`;
  return [
    env.DB.prepare("PRAGMA defer_foreign_keys = on"),
    env.DB.prepare(`UPDATE guests SET account_id = ${accountIdSql} WHERE id = ? AND account_id IS NULL`).bind(emailHashValue, guestId),
    env.DB.prepare(`UPDATE duels SET issued_to = ${to} WHERE issued_to = ?`).bind(emailHashValue, from),
    env.DB.prepare(`UPDATE submissions SET participant = ${to} WHERE participant = ?`).bind(emailHashValue, from),
    env.DB.prepare(`UPDATE scored_picks SET participant = ${to} WHERE participant = ?`).bind(emailHashValue, from),
    // Friend-duel seats (ranked seats are accounts already).
    env.DB.prepare(`UPDATE match_seats SET participant = ${to} WHERE participant = ?`).bind(emailHashValue, from),
  ];
}

/** POST /v1/auth/sign-out. Revokes this session only. */
export async function signOut(env: Env, token: string): Promise<{ ok: true }> {
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(Date.now(), await sha256Hex(token))
    .run();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Account view, names, and ranked eligibility
// ---------------------------------------------------------------------------

type AccountRow = { display_name: string | null; name_changed_at: number | null; created_at: number };

export async function accountView(env: Env, accountId: string): Promise<AccountView> {
  const [row, count, rating, hidden] = await Promise.all([
    env.DB.prepare("SELECT display_name, name_changed_at, created_at FROM accounts WHERE id = ?").bind(accountId).first<AccountRow>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE participant = ?").bind("a:" + accountId).first<{ n: number }>(),
    env.DB.prepare("SELECT rating, rated_duels FROM ratings WHERE account_id = ?").bind(accountId).first<{ rating: number; rated_duels: number }>(),
    hiddenFromBoard(env, accountId),
  ]);
  if (!row) throw new ApiError("unauthorized");
  const completedDuels = count?.n ?? 0;
  const needsDisplayName = row.display_name === null;
  const renameAt = row.name_changed_at === null ? null : row.name_changed_at + RENAME_WINDOW_MS;
  return {
    displayName: row.display_name,
    createdAt: row.created_at,
    completedDuels,
    nextRenameAt: renameAt !== null && renameAt > Date.now() ? renameAt : null,
    ranked: {
      eligible: completedDuels >= RANKED_MIN_COMPLETED_DUELS && !needsDisplayName,
      minCompletedDuels: RANKED_MIN_COMPLETED_DUELS,
      needsDisplayName,
    },
    rating: rating
      ? { rating: rating.rating, ratedDuels: rating.rated_duels, provisional: rating.rated_duels < ELO_PROVISIONAL_DUELS }
      : null,
    hiddenFromBoard: hidden,
  };
}

/**
 * POST /v1/account/display-name. The first name is free; after that one change
 * per RENAME_WINDOW_MS, enforced in the UPDATE itself. Uniqueness is the D1
 * constraint on the folded key, so "Guard_Dog" blocks "guard dog" and "Guard D0g".
 */
export async function setDisplayName(env: Env, accountId: string, body: unknown): Promise<AccountView> {
  await enforce(env.RATE_LIMITS, LIMITS.renamePerAccount, accountId, scale(env));
  const check = checkDisplayName(asRecord(body).displayName);
  if (!check.ok) throw new ApiError(check.reason === "length" || check.reason === "characters" ? "name_invalid" : "name_not_allowed");

  const current = await env.DB.prepare("SELECT display_name FROM accounts WHERE id = ?").bind(accountId).first<{ display_name: string | null }>();
  if (!current) throw new ApiError("unauthorized");
  if (current.display_name === check.name) return accountView(env, accountId);

  const now = Date.now();
  let changed: number;
  try {
    const result = await env.DB.prepare(
      `UPDATE accounts SET display_name = ?, display_name_key = ?,
         name_changed_at = CASE WHEN display_name IS NULL THEN NULL ELSE ? END
       WHERE id = ? AND (display_name IS NULL OR name_changed_at IS NULL OR name_changed_at <= ?)`,
    )
      .bind(check.name, check.key, now, accountId, now - RENAME_WINDOW_MS)
      .run();
    changed = result.meta.changes;
  } catch (error) {
    if (isUniqueViolation(error, "accounts")) throw new ApiError("name_taken");
    throw error;
  }
  if (changed === 0) {
    const row = await env.DB.prepare("SELECT name_changed_at FROM accounts WHERE id = ?").bind(accountId).first<{ name_changed_at: number }>();
    const retryAfter = Math.ceil(((row?.name_changed_at ?? now) + RENAME_WINDOW_MS - now) / 1000);
    throw new ApiError("rename_too_soon", Math.max(1, retryAfter));
  }
  return accountView(env, accountId);
}

/**
 * The gate every ranked entry point must pass. Guests never rank; an account
 * ranks only after RANKED_MIN_COMPLETED_DUELS completed sets and with a name.
 */
export async function assertRankedEligible(env: Env, participant: Participant): Promise<void> {
  if (participant.kind !== "account") throw new ApiError("account_required");
  const view = await accountView(env, participant.accountId);
  if (!view.ranked.eligible) throw new ApiError("ranked_locked");
}
