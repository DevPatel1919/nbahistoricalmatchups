import { defineConfig, devices } from "@playwright/test";

const PORT = 4317;
/** The duel Worker (F09), run locally with the synthetic fixture pool. */
export const DUEL_API_PORT = 8788;
/** A second dev server built without VITE_DAILY_THREE, for the flag-off check (F12). */
export const DAILY_OFF_PORT = 4318;

// The Worker's local secrets, auth test doubles, and a raised rate-limit scale are for this run only;
// production values come from `wrangler secret put` and wrangler.jsonc.
const workerCommand = [
  "cd ../worker",
  "node scripts/seed-local.mjs --fixture --fresh --persist-to .wrangler/e2e",
  `npx wrangler dev --local --port ${DUEL_API_PORT} --persist-to .wrangler/e2e` +
    " --var GUEST_TOKEN_SECRET:e2e-guest-secret-0123456789" +
    " --var SET_TOKEN_SECRET:e2e-set-secret-0123456789ab" +
    // wrangler.jsonc's top level is production; this run serves the local site.
    ` --var ALLOWED_ORIGINS:http://localhost:${PORT} --var APP_ORIGIN:http://localhost:${PORT}` +
    " --var EMAIL_HASH_SECRET:e2e-email-secret-0123456789" +
    // Local-only email outbox and Turnstile dummy token (worker/src/services.ts).
    " --var AUTH_TEST_DOUBLES:1" +
    " --var RATE_LIMIT_SCALE:100" +
    // The review queue (F09 Session 7), and an uncached, per-request board so results show at once.
    " --var ADMIN_TOKEN:e2e-admin-token-0123456789abcdef0123" +
    " --var LEADERBOARD_CACHE_SECONDS:0" +
    " --var LEADERBOARD_REFRESH_SECONDS:0",
].join(" && ");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: workerCommand,
      url: `http://localhost:${DUEL_API_PORT}/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      // Turnstile's public always-pass test site key; the e2e run also stubs its script.
      env: {
        VITE_DUEL_API: `http://localhost:${DUEL_API_PORT}`,
        VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        VITE_DAILY_THREE: "1",
      },
    },
    {
      // Daily Three off: /daily must not exist. Its own cache dir keeps the two dev servers apart.
      command: `npx vite --port ${DAILY_OFF_PORT} --strictPort`,
      url: `http://localhost:${DAILY_OFF_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_DAILY_THREE: "", VITE_DUEL_API: "", VITE_CACHE_DIR: "node_modules/.vite-daily-off" },
    },
  ],
});
