// The single analytics extension point (F02 integration contract).
//
// The UI calls `track(...)` and nothing else. No vendor SDK is imported here,
// and no component imports one either -- a provider is attached at the edge by
// registering a sink. Cloudflare Web Analytics (decision 13) needs no wiring
// at all: it is a script tag in index.html that reports page views by itself,
// so at the time of writing there are zero registered sinks and `track` is a
// no-op. That is intentional; swapping or adding a provider later means
// registering a sink in `main.tsx`, not touching any component.

/** Every event the UI is allowed to emit. Adding a case is a deliberate change. */
export type AnalyticsEvent =
  | { name: "matchup_viewed"; matchup: string; teamA: string; teamB: string }
  | { name: "matchup_link_copied"; matchup: string }
  | { name: "random_matchup_rolled"; matchup: string }
  | { name: "matchup_team_swapped"; side: "a" | "b"; matchup: string }
  | { name: "theme_changed"; theme: "dark" | "light" }
  // Tournament events use the canonical F05 names. `tournamentId` is a
  // curated id or "custom-8"/"custom-16", never the definition or the picks.
  | { name: "tournament_started"; tournamentId: string; entrantCount: number }
  | { name: "bracket_predictions_completed"; tournamentId: string }
  | { name: "tournament_revealed"; tournamentId: string; revealMode: "round" | "all" }
  | { name: "tournament_shared"; tournamentId: string; shareMethod: "native" | "copy" };

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
 * throws is swallowed, because analytics must never break the page.
 */
export function track(event: AnalyticsEvent): void {
  for (const sink of sinks) {
    try {
      sink(event);
    } catch {
      // A broken analytics provider is not worth a broken matchup page.
    }
  }
}

/** Test/debug helper: drop every registered sink. */
export function resetAnalyticsSinks(): void {
  sinks.clear();
}
