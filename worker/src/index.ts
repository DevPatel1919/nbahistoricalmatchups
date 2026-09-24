// Court of All Time duel API (F09). All scored play, including guest play,
// goes through here. The static matchup explorer and tournaments never call it.
//
//   GET  /v1/health
//   POST /v1/guests                      -> { guestToken }
//   POST /v1/sets                        { mode, draw } -> IssuedSet (no answers)
//   GET  /v1/duels/:id                   -> open set, expired, or revealed result
//   POST /v1/duels/:id/submission        { setToken, picks } + Idempotency-Key -> DuelResult

import { clientKey, createGuest, requireParticipant } from "./auth";
import type { Env } from "./env";
import { ApiError, errorResponse, json, readJson, withCors } from "./http";
import { issueSet, readDuel, submitPicks } from "./play";

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;

  if (method === "GET" && path === "/v1/health") return json({ ok: true, poolVersion: env.POOL_VERSION });

  if (method === "POST" && path === "/v1/guests") return json(await createGuest(request, env), 201);

  if (method === "POST" && path === "/v1/sets") {
    const participant = await requireParticipant(request, env);
    return json(await issueSet(env, participant, await clientKey(request, env), await readJson(request)), 201);
  }

  const duel = /^\/v1\/duels\/([A-Za-z0-9_-]{1,64})(\/submission)?$/.exec(path);
  if (duel && method === "GET" && !duel[2]) {
    return json(await readDuel(env, await requireParticipant(request, env), duel[1]));
  }
  if (duel && method === "POST" && duel[2]) {
    const participant = await requireParticipant(request, env);
    const key = request.headers.get("idempotency-key");
    return json(await submitPicks(env, participant, duel[1], key, await readJson(request)));
  }
  throw new ApiError("not_found");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }), origin, env.ALLOWED_ORIGINS);
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof ApiError) {
        response = errorResponse(error);
      } else {
        // Log the error class only: messages from lower layers could carry data.
        console.error("duel-api unhandled", error instanceof Error ? error.name : typeof error);
        response = errorResponse(new ApiError("internal"));
      }
    }
    return withCors(response, origin, env.ALLOWED_ORIGINS);
  },
} satisfies ExportedHandler<Env>;
