// Response helpers. Every error body is one of a fixed set of codes with a
// static message, so no code path can echo pool data, answers, or internals.

export const ERRORS = {
  bad_request: [400, "The request was malformed."],
  missing_idempotency_key: [400, "An Idempotency-Key header is required."],
  unauthorized: [401, "A valid guest token is required."],
  set_token_invalid: [403, "This puzzle set token is not valid for this duel."],
  set_expired: [403, "This puzzle set has expired. Start a new one."],
  not_found: [404, "Not found."],
  already_submitted: [409, "Picks for this duel were already submitted."],
  rate_limited: [429, "Too many requests. Try again shortly."],
  pool_unavailable: [503, "Duel puzzles are not available right now."],
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
