import { eq } from "drizzle-orm";

import { db } from "../db";
import { users } from "../db/schema";
import { decrypt, encrypt } from "./crypto";

export type UserTokenRow = {
  id: string;
  googleRefreshToken: string | null;
};

/**
 * Attempts to refresh a user's Google access token using their stored refresh
 * token. Never throws: on any failure (revoked/expired refresh token, network
 * error, non-2xx response) it returns `needsGoogleReconnect: true` so callers
 * can surface a reconnect banner instead of crashing.
 *
 * On success, `expiresAt` is the new absolute expiry as epoch seconds (matching
 * the shape `upsertUserFromGoogleProfile` expects), so callers can persist the
 * refreshed access token and expiry instead of discarding them.
 */
export async function refreshGoogleToken(
  user: UserTokenRow,
): Promise<{ accessToken: string; needsGoogleReconnect: boolean; expiresAt?: number }> {
  try {
    if (!user.googleRefreshToken) {
      throw new Error("No Google refresh token stored for this user");
    }

    const refreshToken = decrypt(user.googleRefreshToken);

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Google token refresh failed with status ${response.status}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in?: number };
    const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);

    return { accessToken: data.access_token, needsGoogleReconnect: false, expiresAt };
  } catch (error) {
    console.error("Google access token refresh failed:", error);
    return { accessToken: "", needsGoogleReconnect: true };
  }
}

/**
 * The single chokepoint for getting a valid Google access token for a user.
 * Returns the stored token if it hasn't expired yet; otherwise refreshes it
 * via `refreshGoogleToken` and persists the refreshed token/expiry before
 * returning it. Never throws: a missing token or a failed refresh both
 * resolve to `{ accessToken: null, needsGoogleReconnect: true }` so callers
 * can surface a reconnect prompt instead of crashing.
 */
export async function getGoogleAccessToken(
  userId: string,
): Promise<
  | { accessToken: string; needsGoogleReconnect: false }
  | { accessToken: null; needsGoogleReconnect: true }
> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user || !user.googleAccessToken) {
    return { accessToken: null, needsGoogleReconnect: true };
  }

  if (user.googleTokenExpiresAt && user.googleTokenExpiresAt.getTime() > Date.now()) {
    return { accessToken: decrypt(user.googleAccessToken), needsGoogleReconnect: false };
  }

  const refreshed = await refreshGoogleToken({
    id: user.id,
    googleRefreshToken: user.googleRefreshToken,
  });

  if (refreshed.accessToken && refreshed.expiresAt) {
    await db
      .update(users)
      .set({
        googleAccessToken: encrypt(refreshed.accessToken),
        googleTokenExpiresAt: new Date(refreshed.expiresAt * 1000),
      })
      .where(eq(users.id, user.id));

    return { accessToken: refreshed.accessToken, needsGoogleReconnect: false };
  }

  return { accessToken: null, needsGoogleReconnect: true };
}
