// Build-time gate for duel mode (docs/product/DEPLOYMENT.md, phase 2).
//
// Cloudflare Pages sets CF_PAGES_BRANCH on every build. The preview
// environment's VITE_DUEL_API points at the staging Worker, which only allows
// the staging origin, so only the `staging` branch (and production, `main`)
// keeps the duel variables. PR previews build the static site alone. A local
// build (the variable unset) keeps whatever the developer set.

/** Branches whose Pages builds may switch duel mode on. */
export const DUEL_BRANCHES: readonly string[] = ["main", "staging"];

/** Build variables that switch duel mode and sign-in on. */
export const DUEL_BUILD_VARS: readonly string[] = ["VITE_DUEL_API", "VITE_TURNSTILE_SITE_KEY"];

/** Whether a build of `branch` (CF_PAGES_BRANCH; undefined or empty when local) keeps duel mode. */
export function duelModeAllowed(branch: string | undefined): boolean {
  if (!branch) return true;
  return DUEL_BRANCHES.includes(branch);
}

/** Vite `define` entries that blank the duel variables on any other branch. */
export function duelEnvDefines(env: Record<string, string | undefined>): Record<string, string> {
  if (duelModeAllowed(env.CF_PAGES_BRANCH)) return {};
  return Object.fromEntries(DUEL_BUILD_VARS.map((name) => ["import.meta.env." + name, JSON.stringify("")]));
}

// Build-time flag for Daily Three (docs/product/features/F12-daily-three.md,
// "Build flag and staging flow"). VITE_DAILY_THREE=1 registers /daily and
// shows its home-page card and nav link. It is set in the Pages preview
// environment (PR previews and the `staging` branch) and stays unset in
// production until F12 Session 5. Unset, the build emits no /daily page code
// (App.tsx). Only "1" or "true" turn it on, so a stray "0" or "false" keeps it off.

/** The build variable that switches Daily Three on. */
export const DAILY_THREE_VAR = "VITE_DAILY_THREE";

/** Whether a VITE_DAILY_THREE value switches Daily Three on. */
export function dailyThreeEnabled(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/** A Vite `define` entry that hands the app VITE_DAILY_THREE as exactly "1" or "". */
export function dailyThreeDefines(env: Record<string, string | undefined>): Record<string, string> {
  return { ["import.meta.env." + DAILY_THREE_VAR]: JSON.stringify(dailyThreeEnabled(env[DAILY_THREE_VAR]) ? "1" : "") };
}

// Build-time flag for Ask the Court (docs/product/features/F13-ask-the-court.md).
// VITE_ASK_COURT=1 shows the panel on matchup pages, /ask and its nav link. It also
// needs VITE_DUEL_API, so PR previews stay without it. It stays unset in production
// until the owner's go-ahead (F13 Session 7). Unset, the build emits no Ask code.

/** The build variable that switches Ask the Court on. */
export const ASK_COURT_VAR = "VITE_ASK_COURT";

/** Whether a VITE_ASK_COURT value switches Ask the Court on. */
export function askCourtEnabled(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/** A Vite `define` entry that hands the app VITE_ASK_COURT as exactly "1" or "". */
export function askCourtDefines(env: Record<string, string | undefined>): Record<string, string> {
  return { ["import.meta.env." + ASK_COURT_VAR]: JSON.stringify(askCourtEnabled(env[ASK_COURT_VAR]) ? "1" : "") };
}
