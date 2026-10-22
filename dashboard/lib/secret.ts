import { COOKIE, timingSafeEqual, tokenFor } from "./auth.ts";

/** Shared-secret check for the machine endpoints the Apps Script calls. */
export function secretOk(req: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  return Boolean(secret) && timingSafeEqual(req.headers.get("x-sync-secret") ?? "", secret!);
}

/** Either the Apps Script secret or a signed-in browser session. Demo mode (no database) is open. */
export async function isAuthed(req: Request): Promise<boolean> {
  if (secretOk(req)) return true;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return !process.env.DATABASE_URL;
  const cookie = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  return timingSafeEqual(cookie, await tokenFor(password));
}
