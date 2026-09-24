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
}
