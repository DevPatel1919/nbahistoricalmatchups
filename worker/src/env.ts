export interface Env {
  DB: D1Database;
  POOL: KVNamespace;
  RATE_LIMITS: KVNamespace;
  ALLOWED_ORIGINS: string;
  POOL_VERSION: string;
  GUEST_TOKEN_SECRET: string;
  SET_TOKEN_SECRET: string;
}
