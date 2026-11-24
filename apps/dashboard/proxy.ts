import { type NextRequest, NextResponse } from "next/server";
import { PATH_HEADER } from "./lib/path-header";

// A quick first check, before any page runs: with no session cookie, nobody is signed in, so go to
// the sign-in page, and come back here afterwards. Whether a cookie is still valid is the API's
// call (lib/api.ts), since only it can look the session up.
export function proxy(request: NextRequest) {
  const here = request.nextUrl.pathname + request.nextUrl.search;
  if (request.cookies.has("session")) {
    // Passed on to the page, so that if the API finds the session has ended, lib/api.ts can send
    // the person to sign in and back here. Set on every request, so a browser can't supply its own.
    const headers = new Headers(request.headers);
    headers.set(PATH_HEADER, here);
    return NextResponse.next({ request: { headers } });
  }
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", here);
  return NextResponse.redirect(signIn);
}

// Every page except sign-in itself
export const config = {
  matcher: ["/((?!sign-in|design|api|_next|favicon.ico).*)"],
};
