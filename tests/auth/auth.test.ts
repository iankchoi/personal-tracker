import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";

import { refreshGoogleToken, upsertUserFromGoogleProfile } from "../../auth";
import { db } from "../../db";
import { users } from "../../db/schema";
import { decrypt, encrypt } from "../../lib/crypto";

const testEmails = ["ian@example.com", "ian2@example.com"];

afterAll(async () => {
  for (const email of testEmails) {
    await db.delete(users).where(eq(users.email, email));
  }
});

test("signing in twice with the same Google email reuses the same users row", async () => {
  const profile = { email: "ian@example.com", name: "Ian" };
  const tokens1 = { access_token: "access-token-1", refresh_token: "refresh-token-1", expires_at: Math.floor(Date.now() / 1000) + 3600 };
  const tokens2 = { access_token: "access-token-2", expires_at: Math.floor(Date.now() / 1000) + 7200 };

  const first = await upsertUserFromGoogleProfile(profile, tokens1);
  const second = await upsertUserFromGoogleProfile(profile, tokens2);

  expect(second.id).toBe(first.id);
  const rows = await db.select().from(users).where(eq(users.email, profile.email));
  expect(rows).toHaveLength(1);
});

test("stored tokens are encrypted, not plaintext", async () => {
  const profile = { email: "ian2@example.com", name: "Ian" };
  await upsertUserFromGoogleProfile(profile, {
    access_token: "plain-access-token",
    refresh_token: "plain-refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });

  const [row] = await db.select().from(users).where(eq(users.email, profile.email));
  expect(row.googleAccessToken).not.toBe("plain-access-token");
  expect(decrypt(row.googleAccessToken!)).toBe("plain-access-token");
  expect(row.googleRefreshToken).not.toBe("plain-refresh-token");
  expect(decrypt(row.googleRefreshToken!)).toBe("plain-refresh-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a refresh failure sets needsGoogleReconnect without throwing", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  const existingToken = { id: "00000000-0000-0000-0000-000000000000", googleRefreshToken: encrypt("revoked-token") };
  const refreshed = await refreshGoogleToken(existingToken);

  expect(refreshed.needsGoogleReconnect).toBe(true);
  expect(refreshed.accessToken).toBe("");
});

test("a successful refresh returns the new access token and its expiry", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

  const existingToken = { id: "00000000-0000-0000-0000-000000000000", googleRefreshToken: encrypt("valid-refresh-token") };
  const refreshed = await refreshGoogleToken(existingToken);

  expect(refreshed.needsGoogleReconnect).toBe(false);
  expect(refreshed.accessToken).toBe("new-access-token");
  // expiresAt is an absolute epoch-seconds timestamp roughly 3600s in the future.
  expect(refreshed.expiresAt).toBeGreaterThanOrEqual(nowSeconds + 3500);
  expect(refreshed.expiresAt).toBeLessThanOrEqual(nowSeconds + 3700);
});
