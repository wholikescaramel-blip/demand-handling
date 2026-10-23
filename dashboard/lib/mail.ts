/**
 * Email goes out over SMTP, so any mailbox works. The simplest free setup is a Gmail account with an "app password"
 * (Google account > Security > 2-Step Verification > App passwords): set SMTP_USER to the Gmail address and SMTP_PASS to
 * that app password. Without them the Send button is disabled and Download still works.
 */
import nodemailer from "nodemailer";

export const mailConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

export async function sendMail(args: {
  to: string;
  subject: string;
  body: string;
  filename: string;
  pdf: Uint8Array;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!mailConfigured()) return { ok: false, error: "Email is not set up. Add SMTP_USER and SMTP_PASS in the Vercel settings." };
  try {
    const port = Number(process.env.SMTP_PORT) || 465;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: args.to,
      subject: args.subject,
      text: args.body,
      attachments: [{ filename: args.filename, content: Buffer.from(args.pdf), contentType: "application/pdf" }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `The email could not be sent: ${e instanceof Error ? e.message : String(e)}` };
  }
}
