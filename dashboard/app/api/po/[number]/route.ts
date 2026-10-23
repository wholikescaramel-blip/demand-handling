import { getPo } from "@/lib/data";
import { buildPoPdf, poOptionsFromEnv } from "@/lib/pdf";

export const dynamic = "force-dynamic";

/** The purchase order as a PDF (the password gate in proxy.ts protects it). `?download=1` saves it instead of showing it. */
export async function GET(req: Request, { params }: { params: Promise<{ number: string }> }) {
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
