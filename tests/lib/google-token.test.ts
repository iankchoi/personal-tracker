import { eq } from "drizzle-orm";
import { afterAll, afterEach, expect, test, vi } from "vitest";

import { db } from "../../db";
import { users } from "../../db/schema";
import { decrypt, encrypt } from "../../lib/crypto";
import { getGoogleAccessToken } from "../../lib/google-token";

const testEmails = ["fresh@test.com", "expired@test.com", "revoked@test.com", "corrupted@test.com"];

afterAll(async () => {
  for (const email of testEmails) {
    await db.delete(users).where(eq(users.email, email));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("getGoogleAccessToken returns the decrypted token when it has not expired", async () => {
  const [user] = await db.insert(users).values({
    email: "fresh@test.com",
    googleAccessToken: encrypt("fresh-access-token"),
    googleRefreshToken: encrypt("refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: "fresh-access-token", needsGoogleReconnect: false });
});

test("getGoogleAccessToken refreshes and persists a new token when the stored one has expired", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: "refreshed-token", expires_in: 3600 }),
  }));
  const [user] = await db.insert(users).values({
    email: "expired@test.com",
    googleAccessToken: encrypt("stale-token"),
    googleRefreshToken: encrypt("refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() - 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: "refreshed-token", needsGoogleReconnect: false });
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  expect(decrypt(row.googleAccessToken!)).toBe("refreshed-token");
});

test("getGoogleAccessToken reports needsGoogleReconnect when refresh fails, without throwing", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400 }));
  const [user] = await db.insert(users).values({
    email: "revoked@test.com",
    googleAccessToken: encrypt("stale-token"),
    googleRefreshToken: encrypt("revoked-refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() - 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: null, needsGoogleReconnect: true });
});

test("getGoogleAccessToken reports needsGoogleReconnect instead of throwing when the stored access token is corrupted", async () => {
  const [user] = await db.insert(users).values({
    email: "corrupted@test.com",
    googleAccessToken: "not-validly-encrypted-data",
    googleRefreshToken: encrypt("refresh-token"),
    googleTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }).returning();

  const result = await getGoogleAccessToken(user.id);

  expect(result).toEqual({ accessToken: null, needsGoogleReconnect: true });
});
