import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
// Imported so TypeScript can resolve "next-auth/jwt" for the `declare module` augmentation below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";

import { db } from "./db";
import { users } from "./db/schema";
import { encrypt } from "./lib/crypto";
import { refreshGoogleToken } from "./lib/google-token";

export { refreshGoogleToken } from "./lib/google-token";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      needsGoogleReconnect: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    needsGoogleReconnect?: boolean;
    /** Cached copy of `users.google_token_expires_at`, as epoch milliseconds. */
    googleTokenExpiresAt?: number;
  }
}

type GoogleProfile = {
  email: string;
  name?: string | null;
};

type GoogleTokens = {
  access_token: string;
  refresh_token?: string | null;
  /** Absolute expiry timestamp in seconds since epoch (matches Auth.js `account.expires_at`). */
  expires_at: number;
};

/**
 * Upserts a user row keyed on email, encrypting Google OAuth tokens before they
 * ever touch the database. The refresh token is only overwritten when Google
 * actually returned a new one (it's only sent on first consent).
 */
export async function upsertUserFromGoogleProfile(
  profile: GoogleProfile,
  tokens: GoogleTokens,
): Promise<{ id: string }> {
  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined;
  const expiresAt = new Date(tokens.expires_at * 1000);

  const updateSet: Record<string, unknown> = {
    name: profile.name ?? undefined,
    googleAccessToken: encryptedAccessToken,
    googleTokenExpiresAt: expiresAt,
  };
  if (encryptedRefreshToken) {
    updateSet.googleRefreshToken = encryptedRefreshToken;
  }

  const [row] = await db
    .insert(users)
    .values({
      email: profile.email,
      name: profile.name ?? undefined,
      googleAccessToken: encryptedAccessToken,
      googleRefreshToken: encryptedRefreshToken,
      googleTokenExpiresAt: expiresAt,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: updateSet,
    })
    .returning({ id: users.id });

  return row;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/tasks",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // First sign-in: Google returns `account` (tokens) and `profile` (user info).
      if (account && profile?.email) {
        if (!account.access_token) {
          // Log only a non-secret identifier and the object's shape — never
          // the account object itself, which carries `refresh_token` and
          // `id_token` when present. Logging those would write plaintext
          // Google OAuth credentials to server logs (log drains, retention,
          // dashboard access), exactly what the "tokens are never stored in
          // plaintext" constraint exists to prevent.
          console.error(
            `Google sign-in for ${profile.email} returned no access_token; account keys: ${Object.keys(account).join(", ")}`,
          );
        }

        const expiresAt = account.expires_at ?? Math.floor(Date.now() / 1000);
        const dbUser = await upsertUserFromGoogleProfile(
          { email: profile.email, name: profile.name },
          {
            access_token: account.access_token ?? "",
            refresh_token: account.refresh_token,
            expires_at: expiresAt,
          },
        );
        token.userId = dbUser.id;
        token.needsGoogleReconnect = false;
        token.googleTokenExpiresAt = expiresAt * 1000;
        return token;
      }

      // Subsequent requests: only hit the DB/refresh endpoint once our cached
      // expiry has actually passed, instead of on every single request. Once
      // a refresh attempt has already failed (`needsGoogleReconnect`), skip
      // retrying on every subsequent request — a revoked/expired refresh
      // token won't start working on its own, so retrying would mean a
      // failed DB read + a failed POST to Google on every request forever.
      // The user has to actively reconnect (the "Reconnect Google" button in
      // Settings, which calls `signIn("google")` again) to clear the flag
      // and get a fresh token.
      if (
        token.userId &&
        !token.needsGoogleReconnect &&
        token.googleTokenExpiresAt &&
        token.googleTokenExpiresAt <= Date.now()
      ) {
        const [dbUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, token.userId));

        if (dbUser) {
          const refreshed = await refreshGoogleToken({
            id: dbUser.id,
            googleRefreshToken: dbUser.googleRefreshToken,
          });

          if (refreshed.accessToken && refreshed.expiresAt) {
            // Persist the refreshed access token + expiry so the next refresh
            // check (here or in a future session) sees a fresh expiry instead
            // of re-refreshing on every subsequent request.
            await db
              .update(users)
              .set({
                googleAccessToken: encrypt(refreshed.accessToken),
                googleTokenExpiresAt: new Date(refreshed.expiresAt * 1000),
              })
              .where(eq(users.id, dbUser.id));

            token.googleTokenExpiresAt = refreshed.expiresAt * 1000;
            token.needsGoogleReconnect = false;
          } else {
            token.needsGoogleReconnect = refreshed.needsGoogleReconnect;
          }
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string) ?? "";
        session.user.needsGoogleReconnect = Boolean(token.needsGoogleReconnect);
      }
      return session;
    },
  },
});
