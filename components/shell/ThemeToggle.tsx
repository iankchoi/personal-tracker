"use client";

import { useState } from "react";

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
  const [theme, setTheme] = useState<Theme>(readCurrentTheme);

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
