/**
 * Zoho Inventory client (server-side only). Reads the config from env; returns null when not configured so
 * the rest of the app keeps working.
 *
 * Built from Zoho's published API: OAuth refresh-token flow, Authorization: Zoho-oauthtoken, organization_id on
 * every call, POST /purchaseorders, GET /purchaseorders, POST /purchaseorders/{id}/status/issued. Field names
 * that the docs leave open (the status filter, sku on PO lines) are handled defensively. Check once against your
 * own organisation (see README, "Zoho setup").
 */

export type ZohoCfg = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  dc: string; // in | com | eu | com.au | jp | ca
  poStatus: "draft" | "issued";
  vendorMap: Record<string, string>; // distributor id -> Zoho vendor contact_id
  defaultVendorId: string | null;
  numberPrefix: string | null; // set only if your org needs manual PO numbers
};

export function zohoCfg(env: Record<string, string | undefined> = process.env): ZohoCfg | null {
  const { ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID } = env;
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN || !ZOHO_ORG_ID) return null;
  let vendorMap: Record<string, string> = {};
  try {
    vendorMap = env.ZOHO_VENDOR_MAP ? JSON.parse(env.ZOHO_VENDOR_MAP) : {};
  } catch {
    vendorMap = {};
  }
  return {
    clientId: ZOHO_CLIENT_ID,
    clientSecret: ZOHO_CLIENT_SECRET,
    refreshToken: ZOHO_REFRESH_TOKEN,
    orgId: ZOHO_ORG_ID,
    dc: env.ZOHO_DC || "in",
    poStatus: env.ZOHO_PO_STATUS === "issued" ? "issued" : "draft",
    vendorMap,
    defaultVendorId: env.ZOHO_DEFAULT_VENDOR_ID || null,
    numberPrefix: env.ZOHO_PO_NUMBER_PREFIX || null,
  };
}

const apiBase = (c: ZohoCfg) => `https://www.zohoapis.${c.dc}/inventory/v1`;
const accountsBase = (c: ZohoCfg) => `https://accounts.zoho.${c.dc}`;

let cached: { token: string; exp: number; key: string } | null = null;

async function accessToken(c: ZohoCfg): Promise<string> {
  const key = `${c.dc}:${c.clientId}:${c.refreshToken}`;
  if (cached && cached.key === key && cached.exp > Date.now() + 60_000) return cached.token;
  const url = new URL(`${accountsBase(c)}/oauth/v2/token`);
  url.searchParams.set("refresh_token", c.refreshToken);
  url.searchParams.set("client_id", c.clientId);
  url.searchParams.set("client_secret", c.clientSecret);
  url.searchParams.set("grant_type", "refresh_token");
  const res = await fetch(url, { method: "POST" });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`Zoho sign-in failed: ${json.error ?? res.status}`);
  cached = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000, key };
  return cached.token;
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function zfetch(c: ZohoCfg, method: "GET" | "POST", path: string, opts: { params?: Record<string, string>; body?: unknown } = {}): Promise<Json> {
  const url = new URL(`${apiBase(c)}${path}`);
  url.searchParams.set("organization_id", c.orgId);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${await accessToken(c)}`,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok || (typeof json.code === "number" && json.code !== 0)) {
    throw new Error(`Zoho: ${json.message ?? res.status}${json.code ? ` (code ${json.code})` : ""}`);
  }
  return json;
}

export async function zohoPing(c: ZohoCfg): Promise<void> {
  await zfetch(c, "GET", "/purchaseorders", { params: { per_page: "1" } });
}

export type ZohoItem = { item_id: string; sku: string; name: string; purchase_rate: number | null };

export async function findItemBySku(c: ZohoCfg, sku: string): Promise<ZohoItem> {
  const json = await zfetch(c, "GET", "/items", { params: { search_text: sku, per_page: "25" } });
  const hit = ((json.items ?? []) as Json[]).find((i) => String(i.sku ?? "").toLowerCase() === sku.toLowerCase());
  if (!hit) throw new Error(`No Zoho item with SKU ${sku}. Create it in Zoho Inventory or fix the SKU.`);
  return { item_id: String(hit.item_id), sku, name: String(hit.name ?? sku), purchase_rate: hit.purchase_rate == null ? null : Number(hit.purchase_rate) };
}

/** distributor id -> explicit map, else exact vendor-name match in Zoho, else the default vendor. */
export async function resolveVendor(c: ZohoCfg, key: string, name: string | null): Promise<string> {
  if (c.vendorMap[key]) return c.vendorMap[key];
  if (name) {
    const json = await zfetch(c, "GET", "/contacts", { params: { contact_type: "vendor", search_text: name, per_page: "25" } });
    const hit = ((json.contacts ?? []) as Json[]).find((v) => String(v.contact_name ?? "").trim().toLowerCase() === name.trim().toLowerCase());
    if (hit) return String(hit.contact_id);
  }
  if (c.defaultVendorId) return c.defaultVendorId;
  throw new Error(`No Zoho vendor for ${name ?? key}. Add it to ZOHO_VENDOR_MAP or set ZOHO_DEFAULT_VENDOR_ID.`);
}

export type PoPayloadLine = { item_id: string; quantity: number; purchase_rate: number | null; name: string };

/** Pure: the JSON body for POST /purchaseorders. */
export function buildPoPayload(args: {
  vendorId: string;
  lines: PoPayloadLine[];
  reference: string;
  notes: string;
  date: string; // yyyy-mm-dd
  number?: string | null;
}): Json {
  return {
    vendor_id: args.vendorId,
    date: args.date,
    reference_number: args.reference,
    notes: args.notes,
    ...(args.number ? { purchaseorder_number: args.number } : {}),
    line_items: args.lines.map((l) => ({
      item_id: l.item_id,
      name: l.name,
      quantity: l.quantity,
      ...(l.purchase_rate != null ? { purchase_rate: l.purchase_rate } : {}),
    })),
  };
}

export async function createPurchaseOrder(c: ZohoCfg, payload: Json): Promise<{ po_id: string; po_number: string }> {
  const json = await zfetch(c, "POST", "/purchaseorders", { body: payload });
  const po = json.purchaseorder as Json | undefined;
  if (!po?.purchaseorder_id) throw new Error("Zoho created no purchase order (empty response).");
  const po_id = String(po.purchaseorder_id);
  if (c.poStatus === "issued") await zfetch(c, "POST", `/purchaseorders/${po_id}/status/issued`);
  return { po_id, po_number: String(po.purchaseorder_number ?? po_id) };
}

const CLOSED = new Set(["billed", "closed", "cancelled", "canceled", "received", "void"]);

/** Pure: quantity still on order for one PO detail, keyed by SKU. */
export function openQtyByLine(po: Json, skuByItemId: Map<string, string>): { sku: string; open: number }[] {
  const out: { sku: string; open: number }[] = [];
  for (const line of (po.line_items ?? []) as Json[]) {
    const sku = String(line.sku ?? skuByItemId.get(String(line.item_id)) ?? "");
    const open = Number(line.quantity ?? 0) - Number(line.quantity_received ?? 0);
    if (sku && open > 0) out.push({ sku, open });
  }
  return out;
}

export function isOpenStatus(status: unknown): boolean {
  return !CLOSED.has(String(status ?? "").toLowerCase());
}

export type OpenPo = { sku: string; qty_on_order: number; expected_date: string | null };

/**
 * Stock already on order (draft and open POs count, so flags do not double-order). Bounded: at most 3 list pages
 * and 40 PO detail calls per request, to stay inside Zoho's per-minute limit.
 */
export async function listOpenPoQty(c: ZohoCfg, daysBack = 90): Promise<OpenPo[]> {
  const since = Date.now() - daysBack * 86400000;
  const skuByItemId = new Map<string, string>();
  for (let page = 1; page <= 3; page++) {
    const json = await zfetch(c, "GET", "/items", { params: { per_page: "200", page: String(page) } });
    for (const i of (json.items ?? []) as Json[]) if (i.sku) skuByItemId.set(String(i.item_id), String(i.sku));
    if (!json.page_context?.has_more_page) break;
  }
  const open: Json[] = [];
  for (let page = 1; page <= 3; page++) {
    const json = await zfetch(c, "GET", "/purchaseorders", { params: { per_page: "200", page: String(page) } });
    for (const p of (json.purchaseorders ?? []) as Json[]) {
      if (isOpenStatus(p.status) && (!p.date || new Date(p.date).getTime() >= since)) open.push(p);
    }
    if (!json.page_context?.has_more_page) break;
  }
  const totals = new Map<string, OpenPo>();
  for (const p of open.slice(0, 40)) {
    const detail = (await zfetch(c, "GET", `/purchaseorders/${p.purchaseorder_id}`)).purchaseorder as Json;
    for (const { sku, open: qty } of openQtyByLine(detail ?? {}, skuByItemId)) {
      const cur = totals.get(sku) ?? { sku, qty_on_order: 0, expected_date: null };
      cur.qty_on_order += qty;
      const due = (detail?.delivery_date as string | undefined) || null;
      if (due && (!cur.expected_date || due < cur.expected_date)) cur.expected_date = due;
      totals.set(sku, cur);
    }
  }
  return [...totals.values()];
}
