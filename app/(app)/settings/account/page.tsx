import { auth, signIn } from "../../../../auth";
import { DeleteAccountForm } from "../../../../components/settings/DeleteAccountForm";

// This page reads the signed-in session (cookies) directly, so it can't be
// statically prerendered under Cache Components — opt it out of the
// static/instant path rather than wrapping the whole page in Suspense.
export const instant = false;

export default async function SettingsAccountPage() {
  // app/(app)/layout.tsx has already redirected unauthenticated requests to
  // /sign-in before this page renders, so `session` is guaranteed non-null.
  const session = await auth();
  const user = session!.user;

  return (
    <>
      <section className="settings-row">
        <div className="settings-label">
          <h2>Profile</h2>
          <p>Your name and email, synced from Google sign-in.</p>
        </div>
        <div className="settings-panel">
          <div className="field">
            <label htmlFor="f-name">Name</label>
            <input className="input" id="f-name" value={user.name ?? ""} disabled />
          </div>
          <div className="field">
            <label htmlFor="f-email">Email</label>
            <input className="input" id="f-email" value={user.email ?? ""} disabled />
          </div>
          <div className="status-row">
            <span className="label">Google account</span>
            {user.needsGoogleReconnect ? (
              <span className="pill">Disconnected</span>
            ) : (
              <span className="pill pos">Connected</span>
            )}
          </div>
          <div className="panel-foot" style={{ justifyContent: "flex-start" }}>
            <form
              action={async () => {
                "use server";
                await signIn("google");
              }}
            >
              <button className="btn-outline" type="submit">
                Reconnect Google
              </button>
            </form>
          </div>
        </div>
      </section>

      <section className="settings-row">
        <div className="settings-label">
          <h2>Delete account</h2>
          <p>
            Permanently remove your account and all data: events, reminders, notes, and journal
            entries. This can&apos;t be undone.
          </p>
        </div>
        <div className="settings-panel">
          <DeleteAccountForm email={user.email ?? ""} />
        </div>
      </section>
    </>
  );
}
