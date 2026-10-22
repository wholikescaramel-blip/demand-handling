import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, timingSafeEqual, tokenFor } from "./lib/auth.ts";

/**
 * Password gate for the dashboard. /api/ingest is excluded (it checks its own shared secret) and /login is public.
 * With no DASHBOARD_PASSWORD set the dashboard is open, which is only sensible for local demo mode.
 */
export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    // Demo mode (no database) is harmless to leave open. With a database connected, fail closed: the review page can
    // approve orders, so it must never be reachable without a password.
    if (process.env.DATABASE_URL) {
      return new NextResponse("DASHBOARD_PASSWORD is not set. Add it in the Vercel project settings and redeploy.", { status: 503 });
    }
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE)?.value ?? "";
  if (timingSafeEqual(cookie, await tokenFor(password))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/ingest|api/open-pos|api/decisions|api/status|login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
