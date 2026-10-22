import { redirect } from "next/navigation";

// This route only redirects — it has no dynamic data access of its own for
// Cache Components to prerender around, so opt it out of the static/instant
// path entirely rather than wrapping a no-op in a pointless Suspense boundary.
export const instant = false;

export default function SettingsPage() {
  redirect("/settings/account");
}
