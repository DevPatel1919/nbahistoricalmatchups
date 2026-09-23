// Analytics providers (F05). A provider is a sink registered in main.tsx; the
// UI never knows which one is attached.
//
// Plausible's events API is used because it is cookie-free (no consent
// banner, matching the Cloudflare Web Analytics decision) and accepts custom
// properties. It is inert until the owner sets VITE_PLAUSIBLE_DOMAIN at build
// time; self-hosted Plausible works by also setting VITE_PLAUSIBLE_HOST.

import { ANALYTICS_SCHEMA_VERSION, type AnalyticsEvent, type AnalyticsSink } from "./analytics";

export interface PlausibleConfig {
  domain: string;
  host: string;
}

export interface PlausiblePayload {
  name: string;
  domain: string;
  url: string;
  props: Record<string, string | number | boolean>;
}

/**
 * Builds the request body for one event. The page URL is reduced to origin and
 * path: query strings and fragments are dropped, so nothing appended to a URL
 * can leak into analytics.
 */
export function plausiblePayload(event: AnalyticsEvent, config: PlausibleConfig, location: { origin: string; pathname: string }): PlausiblePayload {
  const { name, ...props } = event;
  return {
    name,
    domain: config.domain,
    url: location.origin + location.pathname,
    props: { ...props, schema: ANALYTICS_SCHEMA_VERSION },
  };
}

export function plausibleSink(config: PlausibleConfig): AnalyticsSink {
  return (event) => {
    const body = JSON.stringify(plausiblePayload(event, config, window.location));
    // text/plain keeps this a simple CORS request; keepalive lets it finish
    // while the page navigates. Failures are ignored: analytics is optional.
    void fetch(`${config.host}/api/event`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      keepalive: true,
    }).catch(() => {});
  };
}

/** The configured provider, or null when none is set for this build. */
export function configuredProvider(env: Record<string, string | undefined>): AnalyticsSink | null {
  const domain = env.VITE_PLAUSIBLE_DOMAIN?.trim();
  if (!domain) return null;
  const host = (env.VITE_PLAUSIBLE_HOST?.trim() || "https://plausible.io").replace(/\/+$/, "");
  return plausibleSink({ domain, host });
}
