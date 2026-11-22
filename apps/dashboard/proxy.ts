import { type NextRequest, NextResponse } from "next/server";

// A quick first check, before any page runs: with no session cookie, nobody is signed in, so go to
// the sign-in page, and come back here afterwards. Whether a cookie is still valid is the API's
// call (lib/api.ts), since only it can look the session up.
export function proxy(request: NextRequest) {
  if (request.cookies.has("session")) {
    return NextResponse.next();
  }
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(signIn);
}

// Every page except sign-in itself
export const config = {
  matcher: ["/((?!sign-in|design|api|_next|favicon.ico).*)"],
};
