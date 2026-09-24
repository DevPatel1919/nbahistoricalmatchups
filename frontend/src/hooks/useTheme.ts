import { useCallback, useEffect, useState } from "react";
import { track } from "../lib/analytics";

export type Theme = "dark" | "light";

const STORAGE_KEY = "court-of-all-time-theme";

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) -- fall back to default.
  }
  return "dark";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore write failures; the toggle still works for this page load.
    }
  }, [theme]);

  // Derives the next theme from `theme` rather than from a functional update,
  // so the analytics call stays out of the state updater (which StrictMode
  // invokes twice and would therefore double-report).
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    track({ name: "theme_changed", theme: next });
    setTheme(next);
  }, [theme]);

  return [theme, toggle];
}
