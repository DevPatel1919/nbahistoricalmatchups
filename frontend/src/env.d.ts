// Build-time configuration (set in the Cloudflare Pages build environment).
// Every variable is optional: without it the related feature stays inert.

interface ImportMetaEnv {
  /** Plausible site domain; enables the analytics provider (lib/analyticsProviders.ts). */
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
  /** Plausible host for self-hosting; defaults to https://plausible.io. */
  readonly VITE_PLAUSIBLE_HOST?: string;
  /** Owner's form endpoint for interest emails and creator demo requests (components/InterestForm.tsx). */
  readonly VITE_INTEREST_ENDPOINT?: string;
  /** Base URL of the duel Worker (F09, worker/). Without it duel mode is off and nothing calls a backend. */
  readonly VITE_DUEL_API?: string;
}
