// Outside services used by accounts: sending the magic-link email and checking
// Turnstile. Both sit behind interfaces so tests and local runs use doubles and
// the repo holds no real credentials.
//
// Production: EMAIL_API_KEY + EMAIL_FROM (Resend's HTTP API) and
// TURNSTILE_SECRET_KEY, all set with `wrangler secret put` / wrangler.jsonc.
// Local only: AUTH_TEST_DOUBLES = "1" swaps in an outbox mailer and a check
// that accepts Turnstile's documented dummy token. It is refused unless every
// allowed origin is localhost, so a stray setting cannot open production.

import type { Env } from "./env";

export type MailMessage = { to: string; subject: string; text: string };

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export interface HumanCheck {
  /** True when the Turnstile token is valid for this request. */
  verify(token: string, ip: string | null): Promise<boolean>;
}

export type Services = { mailer: Mailer; humanCheck: HumanCheck };

/** Thrown when auth services are not configured; the router maps it to a fixed 503. */
export class ServiceUnavailable extends Error {}

/** The token Turnstile's test site keys issue (developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

// ---------------------------------------------------------------------------
// Production implementations
// ---------------------------------------------------------------------------

export class ResendMailer implements Mailer {
  private readonly apiKey: string;
  private readonly from: string;
  constructor(apiKey: string, from: string) {
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(message: MailMessage): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!response.ok) throw new ServiceUnavailable("mailer " + response.status);
  }
}

export class TurnstileCheck implements HumanCheck {
  private readonly secret: string;
  constructor(secret: string) {
    this.secret = secret;
  }

  async verify(token: string, ip: string | null): Promise<boolean> {
    if (!token || token.length > 2048) return false;
    const form = new FormData();
    form.set("secret", this.secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!response.ok) throw new ServiceUnavailable("turnstile " + response.status);
    const outcome = (await response.json()) as { success?: boolean };
    return outcome.success === true;
  }
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** Keeps sent mail in memory; tests read `sent`. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failNext = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new ServiceUnavailable("mailer test failure");
    }
    this.sent.push(message);
  }
}

/**
 * Local `wrangler dev` only: stores the latest message per recipient in KV so
 * the e2e run can read the link from GET /v1/dev/outbox. Never enabled when
 * any allowed origin is not localhost.
 */
export class KvOutboxMailer implements Mailer {
  private readonly kv: KVNamespace;
  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  async send(message: MailMessage): Promise<void> {
    await this.kv.put(outboxKey(message.to), JSON.stringify(message), { expirationTtl: 600 });
  }
}

export function outboxKey(to: string): string {
  return "dev-outbox:" + to.trim().toLowerCase();
}

/** Accepts exactly Turnstile's documented dummy token. */
export class DummyTokenCheck implements HumanCheck {
  async verify(token: string): Promise<boolean> {
    return token === TURNSTILE_DUMMY_TOKEN;
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export function localOnly(env: Env): boolean {
  const origins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  return origins.length > 0 && origins.every((o) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o));
}

export function testDoublesEnabled(env: Env): boolean {
  return env.AUTH_TEST_DOUBLES === "1" && localOnly(env);
}

/** The services this deployment is configured for. Missing production config fails closed. */
export function servicesFor(env: Env): Services {
  if (testDoublesEnabled(env)) return { mailer: new KvOutboxMailer(env.RATE_LIMITS), humanCheck: new DummyTokenCheck() };
  const unconfigured = {
    send: async () => {
      throw new ServiceUnavailable("mailer not configured");
    },
    verify: async () => {
      throw new ServiceUnavailable("turnstile not configured");
    },
  };
  return {
    mailer: env.EMAIL_API_KEY && env.EMAIL_FROM ? new ResendMailer(env.EMAIL_API_KEY, env.EMAIL_FROM) : unconfigured,
    humanCheck: env.TURNSTILE_SECRET_KEY ? new TurnstileCheck(env.TURNSTILE_SECRET_KEY) : unconfigured,
  };
}
