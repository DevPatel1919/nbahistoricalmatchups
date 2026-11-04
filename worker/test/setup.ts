import { applyD1Migrations, env } from "cloudflare:test";
import { fixturePoolEntries } from "../scripts/fixture-pool.mjs";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await applyD1Migrations(env.ASK_DB as D1Database, env.TEST_ASK_MIGRATIONS);
await Promise.all(fixturePoolEntries().map((e) => env.POOL.put(e.key, e.value)));
