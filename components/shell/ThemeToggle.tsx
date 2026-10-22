"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function readCurrentTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/**
 * Sidebar button that flips `data-theme` on `<html>` and persists the choice
 * to `localStorage` under the `theme` key, the same key `app/layout.tsx`'s
 * no-FOUC inline script reads on the next page load.
 */
export function ThemeToggle() {
  // Seed with a stable default so the server-rendered output and the initial
  // client render agree (both "light"), then read the real DOM-derived theme
  // in an effect after mount. Reading the DOM in the `useState` initializer
  // would run during SSR (no real theme, defaults to "light") and again on
  // client hydration (where the inline no-FOUC script may have already set
  // `data-theme="dark"`), producing a server/client label text mismatch that
  // React flags as a hydration error on every dark-mode load. The colors
  // don't depend on this — they come from CSS driven by `data-theme` on
  // `<html>`, set by the inline script before paint, regardless of when
  // React catches up.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(readCurrentTheme());
  }, []);

  function handleClick() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }

  const label = theme === "dark" ? "Light mode" : "Dark mode";

  return (
    <button className="theme-toggle" type="button" onClick={handleClick}>
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
