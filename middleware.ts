import { NextResponse } from "next/server";

import { auth } from "./auth";

export default auth((req) => {
  if (!req.auth) {
    const signInUrl = new URL("/sign-in", req.nextUrl.origin);
    return NextResponse.redirect(signInUrl);
  }
});

export const config = {
  // Run on every path except /sign-in, /api/auth/* (Auth.js's own routes),
  // and Next.js's static asset conventions — matching any of those would
  // either 404 the asset or create a sign-in redirect loop.
  matcher: ["/((?!sign-in|api/auth|_next/static|_next/image|favicon.ico).*)"],
  // auth.ts pulls in lib/crypto.ts, which uses Node's `crypto` module (not
  // available in the Edge runtime) for the token-refresh path. Run this on
  // the Node.js runtime so that path works instead of only appearing to
  // work under the dev server's relaxed Edge simulation.
  runtime: "nodejs",
};
