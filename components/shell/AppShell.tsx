"use client";

import type { Session } from "next-auth";
import { useState } from "react";
import type { ReactNode } from "react";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * Authenticated app shell: `.app` grid of `TopBar` + `Sidebar` + a `.canvas`
 * main region. Owns the single piece of shared state (whether the mobile
 * sidebar sheet is open) so `TopBar` and `Sidebar` stay simple, stateless
 * props-in consumers of it.
 */
export function AppShell({ session, children }: { session: Session; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app">
      <TopBar onOpenMenu={() => setMenuOpen(true)} />
      <Sidebar session={session} menuOpen={menuOpen} onCloseMenu={() => setMenuOpen(false)} />
      <main className="canvas">{children}</main>
    </div>
  );
}
