import type { ReactNode } from "react";

import { auth } from "../../auth";
import { AppShell } from "../../components/shell/AppShell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  // middleware.ts has already redirected unauthenticated requests to
  // /sign-in before any route under this layout renders, so `session` is
  // guaranteed non-null here and in every page below this layout.
  const session = await auth();

  return <AppShell session={session!}>{children}</AppShell>;
}
