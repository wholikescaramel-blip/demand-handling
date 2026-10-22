import { timingSafeEqual } from "./auth.ts";

/** Shared-secret check for the machine endpoints the Apps Script calls. */
export function secretOk(req: Request): boolean {
  const secret = process.env.SYNC_SECRET;
  return Boolean(secret) && timingSafeEqual(req.headers.get("x-sync-secret") ?? "", secret!);
}
