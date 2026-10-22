import type { ReactNode } from "react";

import { auth } from "../../auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // middleware.ts has already redirected unauthenticated requests to
  // /sign-in before any route under this layout renders, so `session` is
  // guaranteed non-null here and in every page below this layout.
  const session = await auth();
  void session;

  // Task 6 wraps `children` in <AppShell session={session}> (sidebar, top
  // bar, theme toggle) — not built yet, so this layout just passes children
  // through for now.
  return <>{children}</>;
}
