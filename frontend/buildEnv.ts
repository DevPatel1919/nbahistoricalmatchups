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
