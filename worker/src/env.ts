export interface Env {
  DB: D1Database;
  POOL: KVNamespace;
  RATE_LIMITS: KVNamespace;
  ALLOWED_ORIGINS: string;
  POOL_VERSION: string;
  /** Multiplies every rate limit. "1" in production; raised only for local e2e runs. */
  RATE_LIMIT_SCALE: string;
  GUEST_TOKEN_SECRET: string;
  SET_TOKEN_SECRET: string;
  /** Keys the email hash accounts are looked up by. Never rotate it: every account would be orphaned. */
  EMAIL_HASH_SECRET: string;
  /** Site origin that magic links point at, e.g. https://courtofalltime.com. Must be in ALLOWED_ORIGINS. */
  APP_ORIGIN: string;
  /** Resend API key and verified sender for magic-link email (services.ts). */
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** "1" swaps in local test doubles for email and Turnstile; ignored unless every origin is localhost. */
  AUTH_TEST_DOUBLES?: string;
}
