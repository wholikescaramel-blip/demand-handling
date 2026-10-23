/**
 * Email goes out through an Apps Script web app (your Gmail), so there is no extra email service to sign up for.
 * The dashboard posts the PDF to MAIL_WEBHOOK_URL together with the shared SYNC_SECRET; the script checks the secret
 * and sends the message. See apps-script/Mail.js.
 */
export const mailConfigured = () => Boolean(process.env.MAIL_WEBHOOK_URL && process.env.SYNC_SECRET);

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export async function sendMailViaWebApp(args: {
  to: string;
  subject: string;
  body: string;
  filename: string;
  pdf: Uint8Array;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailConfigured()) return { ok: false, error: "Email is not set up. Add MAIL_WEBHOOK_URL in the Vercel settings." };
  try {
    const res = await fetch(process.env.MAIL_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain avoids a CORS-style preflight on Apps Script
      body: JSON.stringify({
        secret: process.env.SYNC_SECRET, to: args.to, subject: args.subject, body: args.body, filename: args.filename,
        pdf_base64: Buffer.from(args.pdf).toString("base64"),
      }),
      redirect: "follow",
    });
    const text = await res.text();
    let json: { ok?: boolean; error?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: `The email script did not answer properly (HTTP ${res.status}). Check that the web app is deployed to "Anyone".` };
    }
    return json.ok ? { ok: true } : { ok: false, error: json.error ?? "The email script refused the request." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
