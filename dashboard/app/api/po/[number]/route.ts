import { getPo } from "@/lib/data";
import { buildPoPdf } from "@/lib/pdf";
import { isAuthed } from "@/lib/secret";

export const dynamic = "force-dynamic";

/** The purchase order as a PDF. Open to a signed-in browser session or to the Apps Script (shared secret). */
export async function GET(req: Request, { params }: { params: Promise<{ number: string }> }) {
  if (!(await isAuthed(req))) return new Response("Unauthorized", { status: 401 });
  const { number } = await params;
  const po = await getPo(decodeURIComponent(number));
  if (!po) return new Response("No such purchase order", { status: 404 });

  const bytes = await buildPoPdf(po, { company: process.env.COMPANY_NAME, shipTo: process.env.SHIP_TO });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${po.po_number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
