import { applyD1Migrations, env } from "cloudflare:test";
import { fixturePoolEntries } from "../scripts/fixture-pool.mjs";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
await Promise.all(fixturePoolEntries().map((e) => env.POOL.put(e.key, e.value)));
