"use server";

/**
 * Stub for the account-deletion server action. `DeleteAccountForm` (Task 7)
 * only owns the confirmation-gating UI; a later plan implements the actual
 * delete (events, reminders, notes, journal entries, then the user row) and
 * replaces this body.
 */
export async function deleteAccountAction(): Promise<void> {
  throw new Error("deleteAccountAction is not implemented yet");
}
