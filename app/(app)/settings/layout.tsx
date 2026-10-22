"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type SettingsTab = {
  href: string;
  label: string;
};

/**
 * Tab-bar destinations for every Settings sub-page. Calendar/Canvas/
 * Notifications/Appearance don't have pages yet — those are built in later
 * plans — but the tabs link to them now so the bar is complete from day one.
 */
const SETTINGS_TABS: SettingsTab[] = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/calendar", label: "Calendar" },
  { href: "/settings/canvas", label: "Canvas" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/appearance", label: "Appearance" },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="settings-col">
      <h1>Settings</h1>

      <nav className="tabs" role="tablist">
        {SETTINGS_TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} role="tab" aria-selected={pathname === tab.href}>
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
