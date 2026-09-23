// The single analytics extension point (F02 integration contract, F05 schema).
//
// The UI calls `track(...)` and nothing else. No vendor SDK is imported here,
// and no component imports one either -- a provider is attached at the edge by
// registering a sink in `main.tsx` (see lib/analyticsProviders.ts). Page views
// come from Cloudflare Web Analytics, a script tag that needs no wiring.
//
// Event names follow docs/product/features/F05-growth-and-demand.md. Never put
// names, email addresses, free text, or URLs carrying personal state (picks)
// in a property.

/** Bumped when an event's meaning or required properties change. */
export const ANALYTICS_SCHEMA_VERSION = 1;

/** Where a matchup was entered from. */
export type MatchupEntry =
  | "home-search"
  | "browse"
  | "suggested"
  | "random"
  | "swap"
  | "direct"
  | "shared-plain"
  | "shared-challenge";

export type ShareMethod = "native" | "copy" | "image";
export type ShareVariant = "plain" | "challenge";

/** Every event the UI is allowed to emit. Adding a case is a deliberate change. */
export type AnalyticsEvent =
  // Canonical F05 events.
  | { name: "matchup_started"; entrySurface: MatchupEntry }
  | { name: "matchup_completed"; teamA: string; teamB: string; extrapolationWarning: boolean }
  | { name: "matchup_shared"; surface: "result-page"; shareMethod: ShareMethod; variant: ShareVariant }
  // `tournamentId` is a curated id or "custom-8"/"custom-16", never the definition or the picks.
  | { name: "tournament_started"; tournamentId: string; entrantCount: number }
  | { name: "bracket_predictions_completed"; tournamentId: string }
  | { name: "tournament_revealed"; tournamentId: string; revealMode: "round" | "all" }
  | { name: "tournament_shared"; tournamentId: string; shareMethod: ShareMethod }
  | { name: "email_interest_submitted"; sourceSurface: string }
  | { name: "price_intent_clicked"; audience: "fan" | "creator"; offerId: string; displayedPrice: string; qualified: boolean }
  | { name: "creator_demo_requested"; sourceSurface: string }
  // F05 measurement additions (new actions, not alternate names).
  | { name: "visit_started"; visitKind: "first" | "return"; cohortWeek: string; daysSinceFirstVisit: DaysBucket; firstReturn: boolean }
  | { name: "offer_viewed"; surface: string; audience: "fan" | "creator" }
  | { name: "challenge_answered"; agreedWithModel: boolean }
  | { name: "app_error"; surface: string; code: string }
  // Feature interactions (F02).
  | { name: "random_matchup_rolled"; matchup: string }
  | { name: "matchup_team_swapped"; side: "a" | "b"; matchup: string }
  | { name: "theme_changed"; theme: "dark" | "light" };

export type DaysBucket = "0" | "1-7" | "8-30" | "31+";

export type AnalyticsSink = (event: AnalyticsEvent) => void;

const sinks = new Set<AnalyticsSink>();

/**
 * Register a destination for analytics events. Returns an unsubscribe
 * function. Call this once at the app edge; never from a component.
 */
export function registerAnalyticsSink(sink: AnalyticsSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

/**
 * Report that something happened. Safe to call from anywhere: a sink that
 * throws is swallowed, because analytics must never break the page. Nothing
 * is reported once the visitor has opted out.
 */
export function track(event: AnalyticsEvent): void {
  if (isAnalyticsOptedOut()) return;
  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      // A broken analytics provider is not worth a broken page.
    }
  }
}

/** Test/debug helper: drop every registered sink. */
export function resetAnalyticsSinks(): void {
  sinks.clear();
}

// --- Opt-out -----------------------------------------------------------------

const OPT_OUT_KEY = "ct:analytics-opt-out";

/** True when the browser sends Global Privacy Control or Do Not Track; always honored. */
export function hasBrowserPrivacySignal(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** The visitor's own choice, or a browser privacy signal. */
export function isAnalyticsOptedOut(): boolean {
  try {
    if (localStorage.getItem(OPT_OUT_KEY) === "1") return true;
  } catch {
    // Storage blocked: fall through to the browser signal.
  }
  return hasBrowserPrivacySignal();
}

export function setAnalyticsOptOut(optOut: boolean): void {
  try {
    if (optOut) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}
