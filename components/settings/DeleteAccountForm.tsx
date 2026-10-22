"use client";

import { useState } from "react";

import { deleteAccountAction } from "../../lib/actions/delete-account";

/**
 * Delete-account confirmation gate: the `.btn-negative` stays disabled until
 * the typed value exactly matches the signed-in user's email (case-sensitive,
 * no trimming). Wiring the actual deletion is out of scope for this plan —
 * `onClick` calls `deleteAccountAction`, a server action a later plan
 * implements; this component only owns the confirmation gating logic.
 */
export function DeleteAccountForm({ email }: { email: string }) {
  const [typed, setTyped] = useState("");
  const canDelete = typed === email;

  return (
    <div className="field">
      <label htmlFor="f-confirm">Type your email to confirm</label>
      <input
        className="input"
        id="f-confirm"
        placeholder={email}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className="panel-foot" style={{ justifyContent: "flex-start" }}>
        <button
          className="btn-negative"
          type="button"
          disabled={!canDelete}
          onClick={() => deleteAccountAction()}
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
