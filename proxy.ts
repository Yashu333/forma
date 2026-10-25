import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/auth/")) {
    return NextResponse.next();
  }
  return await updateSession(request);
}

export const config = {
  // Everything except static files and the PWA files, which must load signed
  // out (a signed-out phone would otherwise get the login page as its
  // manifest): the manifest, the service worker, /icons/* and /offline.
  // Must stay a literal: Next reads it at build time. Tested in
  // lib/pwa/proxy-matcher.test.ts.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest$|sw\\.js$|icons/|offline$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
