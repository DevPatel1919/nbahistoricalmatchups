// Client for the duel Worker (F09). The only module that calls it. Nothing
// else in the site depends on the Worker: without VITE_DUEL_API the duel
// pages say so and every other route is unaffected.

import type { AccountView, ApiErrorBody, DrawMode, DuelState, IssuedSet, Pick, PlayMode, SignInResult } from "../duel";
import {
  clearGuestToken,
  clearSessionToken,
  readGuestToken,
  readSessionToken,
  writeGuestToken,
  writeSessionToken,
} from "./duelStorage";

/** Base URL of the duel API for this build, or null when duel mode is off. */
export const DUEL_API: string | null = import.meta.env.VITE_DUEL_API?.replace(/\/+$/, "") || null;

/** Turnstile site key for the sign-in form, or null when sign-in is not configured for this build. */
export const TURNSTILE_SITE_KEY: string | null = import.meta.env.VITE_TURNSTILE_SITE_KEY || null;

export class DuelApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type RequestOptions = { method?: "GET" | "POST"; body?: unknown; token?: string; idempotencyKey?: string };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!DUEL_API) throw new DuelApiError("not_configured", 0);
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = "Bearer " + options.token;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(DUEL_API + path, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new DuelApiError("network", 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new DuelApiError(body?.error ?? "http_" + response.status, response.status);
  }
  return (await response.json()) as T;
}

async function guestToken(): Promise<string> {
  const stored = readGuestToken();
  if (stored) return stored;
  const { guestToken } = await request<{ guestToken: string }>("/v1/guests", { method: "POST" });
  writeGuestToken(guestToken);
  return guestToken;
}

/** Runs a call as the guest, replacing a token the server no longer accepts once. */
async function asGuest<T>(call: (token: string) => Promise<T>): Promise<T> {
  try {
    return await call(await guestToken());
  } catch (error) {
    if (!(error instanceof DuelApiError) || error.code !== "unauthorized") throw error;
    clearGuestToken();
    return call(await guestToken());
  }
}

/**
 * Runs a call as the signed-in account, or as the guest when signed out. A
 * session the server no longer accepts (signed out elsewhere, expired) is
 * dropped and the call continues as a guest: play never needs an account.
 */
async function asPlayer<T>(call: (token: string) => Promise<T>): Promise<T> {
  const session = readSessionToken();
  if (!session) return asGuest(call);
  try {
    return await call(session);
  } catch (error) {
    if (!(error instanceof DuelApiError) || error.code !== "unauthorized") throw error;
    clearSessionToken();
    return asGuest(call);
  }
}

/** The token this browser plays under right now, without creating one. */
function currentToken(): string | undefined {
  return readSessionToken() ?? readGuestToken() ?? undefined;
}

/** Deals a set. Ranked ignores the draw (the server draws from every era) and needs an eligible account. */
export function startSet(mode: PlayMode, draw: DrawMode): Promise<IssuedSet> {
  const body = mode === "ranked" ? { mode } : { mode, draw };
  return asPlayer((token) => request<IssuedSet>("/v1/sets", { method: "POST", token, body }));
}

/** Takes the seat a friend's invite link offers. `set` is null when this browser already holds it. */
export function acceptInvite(invite: string): Promise<{ duelId: string; set: IssuedSet | null }> {
  return asPlayer((token) =>
    request<{ duelId: string; set: IssuedSet | null }>("/v1/invites/accept", { method: "POST", token, body: { invite } }),
  );
}

export function fetchDuel(duelId: string): Promise<DuelState> {
  return request<DuelState>("/v1/duels/" + encodeURIComponent(duelId), { token: currentToken() });
}

/** Locks in. A solo or bot set comes back revealed; a ranked or friend seat may come back waiting. */
export function submitPicks(duelId: string, setToken: string, picks: Pick[], idempotencyKey: string): Promise<DuelState> {
  const token = currentToken();
  if (!token) return Promise.reject(new DuelApiError("unauthorized", 401));
  return request<DuelState>("/v1/duels/" + encodeURIComponent(duelId) + "/submission", {
    method: "POST",
    token,
    idempotencyKey,
    body: { setToken, picks },
  });
}

/** The creator of a waiting match settles it now: ranked against the Sparring Partner (unrated), friend solo. */
export function stopWaiting(duelId: string): Promise<DuelState> {
  const token = currentToken();
  if (!token) return Promise.reject(new DuelApiError("unauthorized", 401));
  return request<DuelState>("/v1/duels/" + encodeURIComponent(duelId) + "/stop-waiting", { method: "POST", token });
}

// ---------------------------------------------------------------------------
// Accounts (optional: guests play every unranked mode without one)
// ---------------------------------------------------------------------------

export function isSignedIn(): boolean {
  return readSessionToken() !== null;
}

/** Emails a sign-in link. The answer is the same whether or not the address has an account. */
export async function requestSignInLink(email: string, turnstileToken: string): Promise<void> {
  await request<{ ok: true }>("/v1/auth/magic-link", { method: "POST", body: { email, turnstileToken } });
}

/**
 * Redeems a sign-in link. This browser's guest history moves to the account,
 * so the guest token is retired afterwards.
 */
export async function redeemSignInLink(token: string): Promise<AccountView> {
  const guestToken = readGuestToken() ?? undefined;
  const result = await request<SignInResult>("/v1/auth/verify", { method: "POST", body: { token, guestToken } });
  writeSessionToken(result.sessionToken);
  clearGuestToken();
  return result.account;
}

/** The signed-in account, or null when signed out or the session has lapsed. */
export async function fetchAccount(): Promise<AccountView | null> {
  const token = readSessionToken();
  if (!token) return null;
  try {
    return await request<AccountView>("/v1/account", { token });
  } catch (error) {
    if (error instanceof DuelApiError && error.code === "unauthorized") {
      clearSessionToken();
      return null;
    }
    throw error;
  }
}

export function updateDisplayName(displayName: string): Promise<AccountView> {
  const token = readSessionToken();
  if (!token) return Promise.reject(new DuelApiError("unauthorized", 401));
  return request<AccountView>("/v1/account/display-name", { method: "POST", token, body: { displayName } });
}

/** Ends this browser's session. Local state is cleared even if the server can't be reached. */
export async function signOut(): Promise<void> {
  const token = readSessionToken();
  clearSessionToken();
  if (!token) return;
  try {
    await request<{ ok: true }>("/v1/auth/sign-out", { method: "POST", token });
  } catch {
    // The session expires on its own; nothing else to do.
  }
}

/** Plain-language message for an API failure. */
export function describeDuelError(error: unknown): string {
  const code = error instanceof DuelApiError ? error.code : "unknown";
  switch (code) {
    case "not_configured":
      return "Duel mode isn't switched on for this version of the site.";
    case "network":
    case "pool_unavailable":
    case "internal":
      return "Duel mode is unavailable right now. The matchup explorer and tournaments still work.";
    case "rate_limited":
      return "That's a lot of duels in a short time. Try again in a little while.";
    case "set_expired":
      return "This set expired before it was locked in. Start a new one.";
    case "not_found":
    case "unauthorized":
      return "This duel can't be found. It may belong to another browser.";
    case "already_submitted":
      return "Picks for this duel were already locked in.";
    case "invalid_email":
      return "That doesn't look like an email address.";
    case "human_check_failed":
      return "The verification check didn't pass. Try it again.";
    case "link_invalid":
      return "This sign-in link has expired or was already used. Request a new one.";
    case "auth_unavailable":
      return "Sign-in is unavailable right now. You can keep playing as a guest.";
    case "name_invalid":
      return "Use 3 to 20 letters or digits. Spaces, dots, dashes, and underscores can go between them.";
    case "name_not_allowed":
      return "That name isn't allowed. Choose another.";
    case "name_taken":
      return "That name, or one very like it, is taken.";
    case "rename_too_soon":
      return "You can change your name once every 30 days.";
    case "account_required":
      return "Ranked duels need an account. Sign in to play ranked.";
    case "ranked_locked":
      return "Ranked unlocks after 10 completed sets and a display name.";
    case "ranked_queue_full":
      return "You already have three ranked sets waiting for opponents. Wait for one to finish.";
    case "ranked_exhausted":
      return "You've seen every ranked game available right now. More open up as others finish.";
    case "invite_unavailable":
      return "This invite has expired or was already used. Ask your friend for a new one.";
    case "invite_own":
      return "That's your own invite. Send the link to a friend.";
    case "not_waiting":
      return "An opponent has already joined, so this duel will finish when they lock in.";
    default:
      return "Something went wrong with this duel.";
  }
}
