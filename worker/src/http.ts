// Response helpers. Every error body is one of a fixed set of codes with a
// static message, so no code path can echo pool data, answers, or internals.

export const ERRORS = {
  bad_request: [400, "The request was malformed."],
  missing_idempotency_key: [400, "An Idempotency-Key header is required."],
  unauthorized: [401, "A valid guest or session token is required."],
  invalid_email: [400, "Enter a valid email address."],
  link_invalid: [400, "This sign-in link is invalid, expired, or already used. Request a new one."],
  name_invalid: [400, "Names are 3 to 20 letters or digits, with single spaces, dots, dashes, or underscores between them."],
  name_not_allowed: [400, "That name isn't allowed. Choose another."],
  human_check_failed: [403, "The verification check didn't pass. Try again."],
  account_required: [403, "Ranked play needs an account."],
  ranked_locked: [403, "Ranked play unlocks after more completed duels and a display name."],
  set_token_invalid: [403, "This puzzle set token is not valid for this duel."],
  set_expired: [403, "This puzzle set has expired. Start a new one."],
  invite_own: [400, "This is your own invite. Send it to a friend."],
  not_found: [404, "Not found."],
  invite_unavailable: [404, "This invite is invalid, expired, or already used."],
  already_submitted: [409, "Picks for this duel were already submitted."],
  ranked_queue_full: [409, "You already have the most ranked sets waiting for opponents. Wait for one to finish."],
  not_waiting: [409, "This duel isn't waiting for an opponent."],
  name_taken: [409, "That name, or one too like it, is taken."],
  flag_decided: [409, "This flag has already been decided."],
  rename_too_soon: [429, "Display names can be changed once every 30 days."],
  rate_limited: [429, "Too many requests. Try again shortly."],
  pool_unavailable: [503, "Duel puzzles are not available right now."],
  ranked_exhausted: [503, "No ranked games you haven't seen are available right now."],
  auth_unavailable: [503, "Sign-in is unavailable right now."],
  internal: [500, "Something went wrong."],
} as const satisfies Record<string, readonly [number, string]>;

export type ErrorCode = keyof typeof ERRORS;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter?: number;
  constructor(code: ErrorCode, retryAfter?: number) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(error: ApiError): Response {
  const [status, message] = ERRORS[error.code];
  const headers: Record<string, string> = {};
  if (error.retryAfter !== undefined) headers["retry-after"] = String(error.retryAfter);
  return json({ error: error.code, message }, status, headers);
}

export function withCors(response: Response, origin: string | null, allowed: string): Response {
  const origins = allowed.split(",").map((o) => o.trim()).filter(Boolean);
  if (!origin || !origins.includes(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", "authorization, content-type, idempotency-key");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-expose-headers", "retry-after");
  headers.set("access-control-max-age", "600");
  headers.append("vary", "origin");
  return new Response(response.body, { status: response.status, headers });
}

export async function readJson(request: Request, maxBytes = 8192): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError("bad_request");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("bad_request");
  }
}
