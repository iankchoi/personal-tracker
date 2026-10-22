"use client";

import type { Session } from "next-auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ThemeToggle } from "./ThemeToggle";

type NavItem = {
  href: string;
  label: string;
  /** Pale-tint category class from app/globals.css (cal/rem/note/jour/cv). Omit for untinted items. */
  categoryClass?: string;
  icon: ReactNode;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 12l9-9 9 9M5 10v10h14V10" />
      </svg>
    ),
  },
  {
    href: "/calendar",
    label: "Calendar",
    categoryClass: "cal",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M3 10h18M8 2v4M16 2v4" />
      </svg>
    ),
  },
  {
    href: "/reminders",
    label: "Reminders",
    categoryClass: "rem",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4" />
        <rect x="3" y="3" width="18" height="18" rx="4" />
      </svg>
    ),
  },
  {
    href: "/notes",
    label: "Notes",
    categoryClass: "note",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 4h12l4 4v12H4z" />
        <path d="M14 4v5h5" />
      </svg>
    ),
  },
  {
    href: "/journal",
    label: "Journal",
    categoryClass: "jour",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
      </svg>
    ),
  },
];

export const SCHOOL_NAV_ITEMS: NavItem[] = [
  {
    href: "/canvas",
    label: "Canvas",
    categoryClass: "cv",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3l9 4-9 4-9-4 9-4z" />
        <path d="M5 10v5c3 2 11 2 14 0v-5" />
      </svg>
    ),
  },
];

export const SETTINGS_NAV_ITEM: NavItem = {
  href: "/settings/account",
  label: "Settings",
  icon: (
    <svg viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0A1.7 1.7 0 0 0 10.2 3H10a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z" />
    </svg>
  ),
};

/** All nav destinations, used to resolve the mobile top-bar title for the current route. */
const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...SCHOOL_NAV_ITEMS, SETTINGS_NAV_ITEM];

/** A route is "active" at its own path or any of its sub-paths (e.g. `/settings/account` under `/settings`). */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function getPageTitle(pathname: string): string {
  const match = ALL_NAV_ITEMS.find((item) => isActiveRoute(pathname, item.href));
  return match?.label ?? "Personal Tracker";
}

function getInitials(name?: string | null, email?: string | null): string {
  const trimmedName = name?.trim();
  if (trimmedName) {
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
    }
    return parts[0]!.slice(0, 2).toUpperCase();
  }

  const trimmedEmail = email?.trim();
  if (trimmedEmail) {
    return trimmedEmail.slice(0, 2).toUpperCase();
  }

  return "?";
}

export function Sidebar({
  session,
  menuOpen,
  onCloseMenu,
}: {
  session: Session;
  menuOpen: boolean;
  onCloseMenu: () => void;
}) {
  const pathname = usePathname();

  function renderNavItem(item: NavItem) {
    const active = isActiveRoute(pathname, item.href);
    const className = ["nav-item", item.categoryClass].filter(Boolean).join(" ");
    return (
      <Link key={item.href} className={className} href={item.href} aria-current={active ? "page" : undefined}>
        {item.icon}
        {item.label}
      </Link>
    );
  }

  const initials = getInitials(session.user?.name, session.user?.email);

  return (
    <nav className={menuOpen ? "sidebar open" : "sidebar"} id="sidebar">
      <button className="menu-close" type="button" aria-label="Close menu" onClick={onCloseMenu}>
        <svg viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      {NAV_ITEMS.map(renderNavItem)}
      <div className="group-label">School</div>
      {SCHOOL_NAV_ITEMS.map(renderNavItem)}
      <div className="bottom">
        <ThemeToggle />
        {renderNavItem(SETTINGS_NAV_ITEM)}
        <div className="user-row">
          <span className="avatar">{initials}</span>
          <span className="email">{session.user?.email}</span>
        </div>
      </div>
    </nav>
  );
}
