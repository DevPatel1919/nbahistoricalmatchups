import { useEffect, useLayoutEffect, useRef } from "react";

// Cloudflare Turnstile, loaded only on the sign-in form and only when this
// build has a site key. Nothing else on the site loads a third-party script.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render(element: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

type Props = {
  siteKey: string;
  /** A fresh token, or null when it expires or the check errors. Tokens are single-use: remount to get another. */
  onToken: (token: string | null) => void;
  onLoadError: () => void;
};

export default function TurnstileWidget({ siteKey, onToken, onLoadError }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onToken, onLoadError });
  useLayoutEffect(() => {
    handlers.current = { onToken, onLoadError };
  });

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !container.current) return;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          callback: (token: string) => handlers.current.onToken(token),
          "expired-callback": () => handlers.current.onToken(null),
          "error-callback": () => handlers.current.onToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) handlers.current.onLoadError();
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={container} className="turnstile" />;
}
