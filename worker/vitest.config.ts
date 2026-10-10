import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with real (local) D1 and KV via Miniflare.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // wrangler.jsonc's top level is production; tests run as a local site.
            ALLOWED_ORIGINS: "http://localhost:4317,http://localhost:5173",
            APP_ORIGIN: "http://localhost:4317",
            GUEST_TOKEN_SECRET: "test-guest-secret-0123456789",
            SET_TOKEN_SECRET: "test-set-secret-0123456789ab",
            EMAIL_HASH_SECRET: "test-email-secret-0123456789",
            ADMIN_TOKEN: "test-admin-token-0123456789abcdef0123",
            // Tests read boards straight after writing results; one test turns caching back on.
            LEADERBOARD_CACHE_SECONDS: "0",
            // ...and computed per request; the snapshot tests turn stored boards on.
            LEADERBOARD_REFRESH_SECONDS: "0",
            // Daily Three crowd stats are read straight after posting; one test turns caching on.
            DAILY_STATS_CACHE_SECONDS: "0",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
