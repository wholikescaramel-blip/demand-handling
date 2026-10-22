import { NextResponse } from "next/server";
import { COOKIE, timingSafeEqual, tokenFor } from "@/lib/auth";

export async function POST(req: Request) {
  const password = process.env.DASHBOARD_PASSWORD;
  const form = await req.formData();
  const given = String(form.get("password") ?? "");
  const name = String(form.get("name") ?? "").replace(/[^\p{L}\p{N} .@_-]/gu, "").trim().slice(0, 60) || "reviewer";
  const origin = new URL(req.url).origin;

  if (!password || !timingSafeEqual(await tokenFor(given), await tokenFor(password))) {
    return NextResponse.redirect(`${origin}/login?error=1`, 303);
  }
  const res = NextResponse.redirect(`${origin}/`, 303);
  res.cookies.set(COOKIE, await tokenFor(password), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14,
  });
  res.cookies.set("dp_user", name, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
