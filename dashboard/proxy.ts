import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, timingSafeEqual, tokenFor } from "./lib/auth.ts";

/**
 * Password gate for the whole dashboard. Only the login page and the scheduled-run endpoint (which checks its own secret)
 * are outside it. The review page can approve orders, so with a database connected but no DASHBOARD_PASSWORD the site
 * refuses to load rather than staying open.
 */
export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
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
  matcher: ["/((?!api/cron|login|api/login|_next/static|_next/image|favicon.ico).*)"],
};
