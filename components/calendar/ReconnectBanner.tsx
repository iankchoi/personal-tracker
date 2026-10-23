import { signIn } from "../../auth";

/**
 * Shown on `/calendar` when `getGoogleAccessToken` reports
 * `needsGoogleReconnect: true` — no mockup defines a dedicated
 * reconnect-banner design, so this reuses the `.error-block`/`.error-dot`
 * structure ported into `app/globals.css` for the error state below, with
 * one modifier (`.error-dot.warn`) swapping the dot to `--warning` amber
 * instead of `--negative` red. Unlike `.error-retry` (a click-to-reload
 * action), reconnecting is a distinct action, so this renders its own
 * button using the same `signIn("google", { redirectTo: ... })`
 * server-action-in-a-form pattern as Settings → Account's "Reconnect
 * Google" button.
 */
export function ReconnectBanner() {
  return (
    <div className="error-block">
      <span className="error-dot warn" />
      <span>We couldn&apos;t refresh your Google connection.</span>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/calendar" });
        }}
      >
        <button className="btn-outline" type="submit">
          Reconnect Google
        </button>
      </form>
    </div>
  );
}
