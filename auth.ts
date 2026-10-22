import { eq } from "drizzle-orm";
import NextAuth, { type DefaultSession } from "next-auth";
// Imported so TypeScript can resolve "next-auth/jwt" for the `declare module` augmentation below.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { JWT } from "next-auth/jwt";
import Google from "next-auth/providers/google";

import { db } from "./db";
import { users } from "./db/schema";
import { decrypt, encrypt } from "./lib/crypto";

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

export type UserTokenRow = {
  id: string;
  googleRefreshToken: string | null;
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

/**
 * Attempts to refresh a user's Google access token using their stored refresh
 * token. Never throws: on any failure (revoked/expired refresh token, network
 * error, non-2xx response) it returns `needsGoogleReconnect: true` so callers
 * can surface a reconnect banner instead of crashing.
 */
export async function refreshGoogleToken(
  user: UserTokenRow,
): Promise<{ accessToken: string; needsGoogleReconnect: boolean }> {
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

    const data = (await response.json()) as { access_token: string };

    return { accessToken: data.access_token, needsGoogleReconnect: false };
  } catch {
    return { accessToken: "", needsGoogleReconnect: true };
  }
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
        const dbUser = await upsertUserFromGoogleProfile(
          { email: profile.email, name: profile.name },
          {
            access_token: account.access_token ?? "",
            refresh_token: account.refresh_token,
            expires_at: account.expires_at ?? Math.floor(Date.now() / 1000),
          },
        );
        token.userId = dbUser.id;
        token.needsGoogleReconnect = false;
        return token;
      }

      // Subsequent requests: if the stored access token has expired, try to refresh it.
      if (token.userId) {
        const [dbUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, token.userId));

        if (dbUser?.googleTokenExpiresAt && dbUser.googleTokenExpiresAt.getTime() <= Date.now()) {
          const refreshed = await refreshGoogleToken({
            id: dbUser.id,
            googleRefreshToken: dbUser.googleRefreshToken,
          });
          token.needsGoogleReconnect = refreshed.needsGoogleReconnect;
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
