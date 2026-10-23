import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PoVendor = {
  key: string;
  name: string | null;
  address: string | null;
  gstin: string | null;
  contact: string | null;
  email: string | null;
};

export type PoDoc = {
  po_number: string;
  created_at: string; // ISO
  vendor_name: string | null;
  vendor_key: string;
  vendor?: PoVendor | null;
  run_ids: string | null;
  created_by: string | null;
  total_qty: number;
  total_amount?: number | null;
  lines: { sku: string; name: string | null; qty: number; run_id: string; unit?: string | null; hsn?: string | null; rate?: number | null; tax_pct?: number | null }[];
};

export type PoOptions = {
  company?: { name: string; address?: string; gstin?: string; contact?: string; email?: string };
  shipTo?: string[]; // lines
  expiryDays?: number;
  paymentTerms?: string;
  terms?: string[];
  watermark?: string;
};

export const DEFAULT_TERMS = [
  "We reserve the right to cancel this purchase order at any time before the goods are shipped.",
  "The invoice must quote the PO number and match the items and quantities ordered.",
  "Goods must meet the agreed product specifications. Deviations may result in rejection.",
  "Rates and the delivery date are to be confirmed by the vendor when accepting this order.",
];

/** Company block, ship-to and terms from environment variables, with safe defaults. */
export function poOptionsFromEnv(env: Record<string, string | undefined> = process.env): PoOptions {
  const name = env.COMPANY_NAME || "Freshroots";
  const split = (v: string | undefined) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : []);
  return {
    company: { name, address: env.COMPANY_ADDRESS, gstin: env.COMPANY_GSTIN, contact: env.COMPANY_CONTACT, email: env.COMPANY_EMAIL },
    shipTo: split(env.SHIP_TO).length ? split(env.SHIP_TO) : [name, "Pune Central Warehouse, Pune"],
    expiryDays: Number(env.PO_EXPIRY_DAYS) || 7,
    paymentTerms: env.PAYMENT_TERMS || "As agreed with the vendor",
    terms: split(env.PO_TERMS).length ? split(env.PO_TERMS) : DEFAULT_TERMS,
  };
}

/** The built-in PDF fonts only cover Latin-1, so map the usual typographic characters and drop the rest. */
export function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/·|•/g, "-")
    .replace(/₹/g, "Rs ")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Line total including tax, as in the reference layout. */
export function lineAmount(l: { qty: number; rate?: number | null; tax_pct?: number | null }): number | null {
  if (l.rate === null || l.rate === undefined) return null;
  return l.qty * l.rate * (1 + (l.tax_pct ?? 0) / 100);
}

const INK = rgb(0.1, 0.12, 0.18);
const MUTED = rgb(0.42, 0.45, 0.52);
const BLUE = rgb(0.18, 0.43, 0.78);
const PANEL = rgb(0.91, 0.94, 0.99);
const RULE = rgb(0.82, 0.85, 0.9);
const WHITE = rgb(1, 1, 1);

const W = 595;
const H = 842;
const M = 36;
const CW = W - 2 * M;

/** A4 purchase order laid out like the reference: supplier panel, bill/ship blocks, item table, totals, terms, signature. */
export async function buildPoPdf(po: PoDoc, options: PoOptions = {}): Promise<Uint8Array> {
  const o = { ...poOptionsFromEnv({}), ...options };
  const company = o.company ?? { name: "Freshroots" };
  const doc = await PDFDocument.create();
  doc.setTitle(`Purchase order ${po.po_number}`);
  doc.setProducer("Demand Planning Desk");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page!: PDFPage;
  const Y = (top: number) => H - top; // distance from top -> PDF y

  const text = (s: string, x: number, top: number, size = 10, f: PDFFont = font, color = INK, align: "l" | "r" | "c" = "l") => {
    const t = pdfText(s);
    const w = f.widthOfTextAtSize(t, size);
    const px = align === "r" ? x - w : align === "c" ? x - w / 2 : x;
    page.drawText(t, { x: px, y: Y(top), size, font: f, color });
  };
  const wrap = (s: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = pdfText(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) <= maxW) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };
  const fit = (s: string, f: PDFFont, size: number, maxW: number) => {
    let t = pdfText(s);
    if (f.widthOfTextAtSize(t, size) <= maxW) return t;
    while (t.length > 1 && f.widthOfTextAtSize(t + "...", size) > maxW) t = t.slice(0, -1);
    return t.trimEnd() + "...";
  };
  const rect = (x: number, top: number, w: number, h: number, color = PANEL) => page.drawRectangle({ x, y: Y(top + h), width: w, height: h, color });
  const hline = (top: number, x1 = M, x2 = W - M, color = RULE) => page.drawLine({ start: { x: x1, y: Y(top) }, end: { x: x2, y: Y(top) }, thickness: 0.8, color });
  const dash = (v: string | null | undefined) => (v && String(v).trim() ? String(v) : "-");

  // table geometry
  const cols = [
    { k: "sn", t: "S.No", w: 30, a: "c" as const },
    { k: "code", t: "Product Code", w: 66, a: "c" as const },
    { k: "name", t: "Product Name", w: 158, a: "l" as const },
    { k: "hsn", t: "HSN code", w: 52, a: "c" as const },
    { k: "qty", t: "Qty", w: 36, a: "r" as const },
    { k: "unit", t: "Units", w: 36, a: "c" as const },
    { k: "rate", t: "Rate", w: 52, a: "r" as const },
    { k: "tax", t: "Tax", w: 36, a: "r" as const },
    { k: "amt", t: "Amount", w: 57, a: "r" as const },
  ];
  const colX = (i: number) => M + cols.slice(0, i).reduce((s, c) => s + c.w, 0);
  const cell = (i: number, s: string, top: number, f: PDFFont, size: number, color = INK) => {
    const c = cols[i];
    const x0 = colX(i);
    const pad = 5;
    const t = fit(s, f, size, c.w - 2 * pad);
    if (c.a === "l") text(t, x0 + pad, top, size, f, color);
    else if (c.a === "r") text(t, x0 + c.w - pad, top, size, f, color, "r");
    else text(t, x0 + c.w / 2, top, size, f, color, "c");
  };
  const tableHeader = (top: number) => {
    rect(M, top, CW, 24, BLUE);
    cols.forEach((c, i) => cell(i, c.t, top + 16, bold, 8.5, WHITE));
    return top + 24;
  };

  page = doc.addPage([W, H]);

  // ---- title and company
  const title = "PURCHASE ORDER";
  const spacing = 4;
  const titleW = [...title].reduce((s, ch) => s + bold.widthOfTextAtSize(ch, 15) + spacing, -spacing);
  let tx = W / 2 - titleW / 2;
  for (const ch of title) {
    page.drawText(ch, { x: tx, y: Y(54), size: 15, font: bold, color: MUTED });
    tx += bold.widthOfTextAtSize(ch, 15) + spacing;
  }
  text(company.name, W / 2, 96, 22, bold, INK, "c");
  if (company.address) text(company.address, W / 2, 114, 10, font, INK, "c");

  // ---- supplier panel
  const v = po.vendor;
  const panelTop = 130;
  rect(M, panelTop, CW, 112);
  const L = (label: string, value: string, top: number, lx: number, vx: number, maxW: number) => {
    text(label, lx, top, 9.5, bold);
    text(fit(value, font, 9.5, maxW), vx, top, 9.5);
  };
  let ty = panelTop + 22;
  L("Supplier Name:", dash(v?.name ?? po.vendor_name ?? po.vendor_key), ty, M + 14, M + 96, 190);
  ty += 18;
  const addr = wrap(dash(v?.address), font, 9.5, 190).slice(0, 2);
  text("Address:", M + 14, ty, 9.5, bold);
  addr.forEach((l, i) => text(l, M + 96, ty + i * 11, 9.5));
  ty += 18 + (addr.length > 1 ? 11 : 0);
  L("GSTIN:", dash(v?.gstin), ty, M + 14, M + 96, 190);
  ty += 18;
  L("Contact:", dash(v?.contact), ty, M + 14, M + 96, 190);
  ty += 18;
  L("Email:", dash(v?.email), ty, M + 14, M + 96, 190);
  let ry = panelTop + 22;
  L("Supplier Code:", po.vendor_key, ry, 322, 410, 150);
  ry += 18;
  L("PO No:", po.po_number, ry, 322, 410, 150);
  ry += 18;
  L("PO Date:", fmtDate(po.created_at), ry, 322, 410, 150);
  ry += 18;
  L("PO Expiry:", `${o.expiryDays ?? 7} days`, ry, 322, 410, 150);

  // ---- bill to / ship to
  const barTop = panelTop + 112;
  rect(M, barTop, CW, 22, BLUE);
  text("Bill To:", M + 16, barTop + 15, 10.5, bold, WHITE);
  text("Ship To:", M + 280, barTop + 15, 10.5, bold, WHITE);
  const bill = [company.name, company.address, company.gstin ? `GSTIN: ${company.gstin}` : null, company.contact ? `Contact: ${company.contact}` : null, company.email ? `Email: ${company.email}` : null].filter(Boolean) as string[];
  const ship = o.shipTo ?? [company.name];
  let by = barTop + 42;
  bill.forEach((l, i) => text(wrap(l, i === 0 ? bold : font, 9.5, 240)[0], M + 16, by + i * 13, 9.5, i === 0 ? bold : font));
  ship.forEach((l, i) => text(wrap(l, i === 0 ? bold : font, 9.5, 240)[0], M + 280, by + i * 13, 9.5, i === 0 ? bold : font));
  by += Math.max(bill.length, ship.length) * 13 + 8;
  hline(by);
  text(`Payment terms: ${o.paymentTerms ?? ""}`, W / 2, by + 18, 10, font, INK, "c");
  let top = tableHeader(by + 32);

  // ---- rows
  const rowH = 24;
  const needAfter = 200; // totals + terms + signature
  po.lines.forEach((l, i) => {
    if (top + rowH > H - 60) {
      page = doc.addPage([W, H]);
      text(`${po.po_number} (continued)`, M, 44, 11, bold);
      top = tableHeader(58);
    }
    const amt = lineAmount(l);
    cell(0, String(i + 1), top + 16, font, 9.5);
    cell(1, l.sku, top + 16, bold, 9.5);
    cell(2, l.name ?? "", top + 16, font, 9.5);
    cell(3, dash(l.hsn), top + 16, font, 9.5);
    cell(4, String(l.qty), top + 16, bold, 9.5);
    cell(5, dash(l.unit ?? "nos"), top + 16, font, 9.5);
    cell(6, l.rate == null ? "-" : money(l.rate), top + 16, font, 9.5);
    cell(7, l.tax_pct == null ? "-" : `${l.tax_pct}%`, top + 16, font, 9.5);
    cell(8, amt == null ? "-" : money(amt), top + 16, font, 9.5);
    top += rowH;
    hline(top);
  });

  // ---- totals
  if (top + needAfter > H - 40) {
    page = doc.addPage([W, H]);
    text(`${po.po_number} (continued)`, M, 44, 11, bold);
    top = 70;
  }
  top += 8;
  const labelX = colX(6) - 6;
  text("Total units", labelX, top + 12, 10, bold, INK, "r");
  text(String(po.total_qty), W - M - 5, top + 12, 10.5, bold, INK, "r");
  top += 22;
  const priced = po.lines.every((l) => l.rate != null);
  const grand = po.total_amount ?? (priced ? po.lines.reduce((s, l) => s + (lineAmount(l) ?? 0), 0) : null);
  text("Grand total", labelX, top + 12, 10, bold, INK, "r");
  text(grand == null ? "to be confirmed" : money(grand), W - M - 5, top + 12, 10.5, bold, INK, "r");
  top += 26;

  // ---- terms and signature
  const termsW = 330;
  const termLines: { s: string; n: number | null }[] = [];
  (o.terms ?? DEFAULT_TERMS).forEach((t, i) => wrap(t, font, 8.5, termsW - 40).forEach((s, j) => termLines.push({ s, n: j === 0 ? i + 1 : null })));
  const boxH = 30 + termLines.length * 11;
  rect(M, top, termsW, boxH);
  text("Terms and conditions:", M + 14, top + 16, 8.5, bold);
  termLines.forEach((t, i) => {
    if (t.n !== null) text(`${t.n}.`, M + 14, top + 30 + i * 11, 8.5);
    text(t.s, M + 28, top + 30 + i * 11, 8.5);
  });
  const sx = M + termsW + 16;
  const sw = W - M - sx;
  rect(sx, top, sw, 22, BLUE);
  text(`For ${company.name}`, sx + sw / 2, top + 15, 10, bold, WHITE, "c");
  hline(top + boxH - 6, sx + 8, W - M - 8);
  text("Authorized signatory", sx + sw / 2, top + boxH + 6, 8.5, italic, MUTED, "c");
  if (po.created_by) text(`Approved by ${po.created_by}`, sx + sw / 2, top + 42, 8.5, font, MUTED, "c");

  // ---- footer on every page, plus optional watermark
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    const foot = company.email ? `Mark any communications to ${company.email}` : "Generated by Demand Planning Desk after approval";
    text(foot, M, H - 24, 8.5, font, INK);
    text(`Page ${i + 1} of ${pages.length}`, W - M, H - 24, 8.5, font, MUTED, "r");
    if (o.watermark) {
      p.drawText(pdfText(o.watermark), { x: 130, y: 330, size: 96, font: bold, color: rgb(0.8, 0.82, 0.88), rotate: degrees(40), opacity: 0.35 });
    }
  });
  return doc.save();
}
