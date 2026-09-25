// Court of All Time duel API (F09). All scored play, including guest play,
// goes through here. The static matchup explorer and tournaments never call it.
//
//   GET  /v1/health
//   POST /v1/guests                      -> { guestToken }
//   POST /v1/sets                        { mode, draw } -> IssuedSet (no answers); ranked needs an eligible account
//   POST /v1/invites/accept              { invite } -> { duelId, set } (the friend duel's identical set)
//   GET  /v1/duels/:id                   -> DuelState: open, waiting, expired, or revealed
//   POST /v1/duels/:id/submission        { setToken, picks } + Idempotency-Key -> DuelState (revealed or waiting)
//   POST /v1/duels/:id/stop-waiting      (match creator) -> DuelState: settles with no opponent
//   POST /v1/auth/magic-link             { email, turnstileToken } -> 202 (same answer for every address)
//   POST /v1/auth/verify                 { token, guestToken? } -> { sessionToken, account }
//   POST /v1/auth/sign-out               (session) -> { ok }
//   GET  /v1/account                     (session) -> AccountView
//   POST /v1/account/display-name        (session) { displayName } -> AccountView
//   GET  /v1/dev/outbox?to=              local test doubles only -> last magic-link email
//
// Scheduled (wrangler.jsonc triggers): settles ranked and friend matches whose
// timeout has passed, so forfeits and no-opponent fallbacks resolve unattended.

import { accountView, requestMagicLink, setDisplayName, signOut, verifyMagicLink } from "./accounts";
import { clientKey, createGuest, requireAccount, requireParticipant } from "./auth";
import type { Env } from "./env";
import { ApiError, errorResponse, json, readJson, withCors } from "./http";
import { acceptInvite, settleDue, startFriend, startRanked, stopWaiting } from "./matches";
import { issueSet, readDuel, submitPicks } from "./play";
import { ServiceUnavailable, outboxKey, servicesFor, testDoublesEnabled, type Services } from "./services";

async function route(request: Request, env: Env, services: Services): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (method === "GET" && path === "/v1/health") return json({ ok: true, poolVersion: env.POOL_VERSION });

  if (method === "POST" && path === "/v1/guests") return json(await createGuest(request, env), 201);

  if (method === "POST" && path === "/v1/sets") {
    const participant = await requireParticipant(request, env);
    const body = await readJson(request);
    const mode = (body as { mode?: unknown } | null)?.mode;
    const ipKey = await clientKey(request, env);
    // startRanked runs assertRankedEligible before anything is issued.
    if (mode === "ranked") return json(await startRanked(env, participant, ipKey), 201);
    if (mode === "friend") return json(await startFriend(env, participant, ipKey, body), 201);
    return json(await issueSet(env, participant, ipKey, body), 201);
  }

  if (method === "POST" && path === "/v1/invites/accept") {
    const participant = await requireParticipant(request, env);
    return json(await acceptInvite(env, participant, await clientKey(request, env), await readJson(request)));
  }

  if (method === "POST" && path === "/v1/auth/magic-link") {
    return json(await requestMagicLink(request, env, services, await readJson(request)), 202);
  }
  if (method === "POST" && path === "/v1/auth/verify") return json(await verifyMagicLink(request, env, await readJson(request)));
  if (method === "POST" && path === "/v1/auth/sign-out") return json(await signOut(env, (await requireAccount(request, env)).token));
  if (method === "GET" && path === "/v1/account") return json(await accountView(env, (await requireAccount(request, env)).accountId));
  if (method === "POST" && path === "/v1/account/display-name") {
    const { accountId } = await requireAccount(request, env);
    return json(await setDisplayName(env, accountId, await readJson(request)));
  }
  if (method === "GET" && path === "/v1/dev/outbox" && testDoublesEnabled(env)) {
    const message = await env.RATE_LIMITS.get(outboxKey(url.searchParams.get("to") ?? ""), { type: "json" });
    if (!message) throw new ApiError("not_found");
    return json(message);
  }

  const duel = /^\/v1\/duels\/([A-Za-z0-9_-]{1,64})(\/submission|\/stop-waiting)?$/.exec(path);
  if (duel && method === "GET" && !duel[2]) {
    return json(await readDuel(env, await requireParticipant(request, env), duel[1]));
  }
  if (duel && method === "POST" && duel[2] === "/submission") {
    const participant = await requireParticipant(request, env);
    const key = request.headers.get("idempotency-key");
    return json(await submitPicks(env, participant, duel[1], key, await readJson(request)));
  }
  if (duel && method === "POST" && duel[2] === "/stop-waiting") {
    return json(await stopWaiting(env, await requireParticipant(request, env), duel[1]));
  }
  throw new ApiError("not_found");
}

/** The whole API with its outside services injected; tests pass doubles here. */
export async function handle(request: Request, env: Env, services: Services): Promise<Response> {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), origin, env.ALLOWED_ORIGINS);
  let response: Response;
  try {
    response = await route(request, env, services);
  } catch (error) {
    if (error instanceof ApiError) {
      response = errorResponse(error);
    } else if (error instanceof ServiceUnavailable) {
      console.error("duel-api auth service unavailable");
      response = errorResponse(new ApiError("auth_unavailable"));
    } else {
      // Log the error class only: messages from lower layers could carry data.
      console.error("duel-api unhandled", error instanceof Error ? error.name : typeof error);
      response = errorResponse(new ApiError("internal"));
    }
  }
  return withCors(response, origin, env.ALLOWED_ORIGINS);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, servicesFor(env));
  },
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      settleDue(env, Date.now()).catch((error: unknown) => {
        console.error("duel-api settle sweep failed", error instanceof Error ? error.name : typeof error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
