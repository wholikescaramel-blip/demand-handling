import { getPo } from "@/lib/data";
import { buildPoPdf, poOptionsFromEnv } from "@/lib/pdf";
import { isAuthed } from "@/lib/secret";

export const dynamic = "force-dynamic";

/** The purchase order as a PDF. `?download=1` makes the browser save it instead of showing it. */
export async function GET(req: Request, { params }: { params: Promise<{ number: string }> }) {
  if (!(await isAuthed(req))) return new Response("Unauthorized", { status: 401 });
  const { number } = await params;
  const po = await getPo(decodeURIComponent(number));
  if (!po) return new Response("No such purchase order", { status: 404 });

  const bytes = await buildPoPdf(po, poOptionsFromEnv());
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${po.po_number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
