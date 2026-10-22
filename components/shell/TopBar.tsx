"use client";

import { usePathname } from "next/navigation";

import { getPageTitle } from "./Sidebar";

/**
 * Phone-width top bar (hidden on desktop via `.topbar`'s `display: none` in
 * app/globals.css). The menu button opens the sidebar sheet; `AppShell` owns
 * the open/close state so this component stays a dumb trigger.
 */
export function TopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname();
  const title = getPageTitle(pathname);

  return (
    <div className="topbar">
      <button className="menu-toggle" type="button" aria-label="Open menu" onClick={onOpenMenu}>
        <svg viewBox="0 0 24 24">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <span className="topbar-title">{title}</span>
    </div>
  );
}
