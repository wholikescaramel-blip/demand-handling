import { parseCsv } from "./csv.ts";

export type DatasetKind = "sku_master" | "distributor_master" | "weekly_sales" | "current_inventory" | "calendar";

export type SkuRow = {
  sku_id: string; name: string; category: string | null; perishability: "Low" | "High"; std_reorder_qty: number;
  unit: string | null; distributor_id: string | null; hsn: string | null; unit_cost: number | null; tax_pct: number | null;
};
export type DistributorRow = {
  distributor_id: string; name: string; region: string | null; status: string; address: string | null; gstin: string | null;
  contact: string | null; email: string | null;
};
export type SalesRow = { sku_id: string; week: string; units: number };
export type InventoryRow = { sku_id: string; location: string; units_on_hand: number; as_of: string };
export type CalendarRow = { year_month: string; year: number; month: number; is_festival: boolean };

export type RowOf = {
  sku_master: SkuRow;
  distributor_master: DistributorRow;
  weekly_sales: SalesRow;
  current_inventory: InventoryRow;
  calendar: CalendarRow;
};

export const DATASETS: Record<DatasetKind, { label: string; file: string; required: string[]; optional: string[]; blurb: string; keyHint: string }> = {
  sku_master: {
    label: "SKUs", file: "sku_master.csv", keyHint: "SKU_ID",
    required: ["SKU_ID", "SKU_Name", "Perishability", "Standard_Reorder_Qty"],
    optional: ["Category", "Unit_of_Measure", "Distributor_ID", "HSN_Code", "Unit_Cost", "Tax_Pct"],
    blurb: "The products. Perishability is Low or High. Unit_Cost, HSN_Code and Tax_Pct fill the rate, HSN and tax columns on purchase orders.",
  },
  distributor_master: {
    label: "Distributors (vendors)", file: "distributor_master.csv", keyHint: "Distributor_ID",
    required: ["Distributor_ID", "Distributor_Name"],
    optional: ["Region", "Status", "Address", "GSTIN", "Contact", "Email"],
    blurb: "Who each SKU is ordered from. The address, GSTIN and contact appear on the PO; the email pre-fills the 'Send by email' box.",
  },
  weekly_sales: {
    label: "Weekly sales", file: "weekly_sales.csv", keyHint: "SKU_ID + Week",
    required: ["SKU_ID", "Week", "Units_Sold"], optional: [],
    blurb: "Units sold per SKU per week, like 2026-W42. The rules look at the latest 12 weeks.",
  },
  current_inventory: {
    label: "Stock on hand", file: "current_inventory.csv", keyHint: "SKU_ID + Location + As_Of_Date",
    required: ["SKU_ID", "Location", "Units_On_Hand", "As_Of_Date"], optional: [],
    blurb: "Stock per SKU and location on a date. Every upload is kept as history; the latest date per SKU and location is current.",
  },
  calendar: {
    label: "Festival calendar", file: "calendar.csv", keyHint: "Year_Month",
    required: ["Year_Month", "Is_Festival_Month"], optional: ["Year", "Month"],
    blurb: "Which months are festival months (Rule 4 raises demand by the festival uplift in those months).",
  },
};

export type ParseResult<T> = { rows: T[]; errors: string[]; errorCount: number; totalRows: number; missingColumns: string[] };

const isInt = (s: string) => /^\d+$/.test(s);
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const emptyToNull = (s: string | undefined) => (s === undefined || s.trim() === "" ? null : s.trim());

/**
 * Read a CSV for one dataset: check the columns, validate every row, return the good rows and a list of what is wrong.
 * Rows with problems are skipped, never silently fixed.
 */
export function parseDataset<K extends DatasetKind>(kind: K, text: string): ParseResult<RowOf[K]> {
  const def = DATASETS[kind];
  const table = parseCsv(text);
  const result: ParseResult<RowOf[K]> = { rows: [], errors: [], errorCount: 0, totalRows: 0, missingColumns: [] };
  if (!table.length) {
    result.errors.push("The file is empty.");
    result.errorCount = 1;
    return result;
  }
  const header = table[0].map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  result.missingColumns = def.required.filter((c) => col(c) < 0);
  if (result.missingColumns.length) {
    result.errors.push(`Missing column(s): ${result.missingColumns.join(", ")}. Expected: ${[...def.required, ...def.optional].join(", ")}.`);
    result.errorCount = 1;
    return result;
  }

  const seen = new Map<string, number>(); // duplicate keys inside the file: the last row wins
  const out: RowOf[K][] = [];
  const keyOf = (r: unknown): string => {
    const x = r as Record<string, unknown>;
    switch (kind) {
      case "sku_master": return String(x.sku_id);
      case "distributor_master": return String(x.distributor_id);
      case "weekly_sales": return `${x.sku_id}|${x.week}`;
      case "current_inventory": return `${x.sku_id}|${x.location}|${x.as_of}`;
      default: return String(x.year_month);
    }
  };

  table.slice(1).forEach((r, i) => {
    result.totalRows++;
    const n = i + 2; // spreadsheet row number
    const get = (name: string) => (col(name) >= 0 ? r[col(name)] ?? "" : "");
    const bad = (msg: string) => {
      result.errorCount++;
      if (result.errors.length < 20) result.errors.push(`Row ${n}: ${msg}`);
    };
    let row: unknown;
    switch (kind) {
      case "sku_master": {
        const id = get("SKU_ID");
        const name = get("SKU_Name");
        const per = get("Perishability").toLowerCase();
        const std = get("Standard_Reorder_Qty");
        if (!id) return bad("SKU_ID is empty.");
        if (!name) return bad(`${id}: SKU_Name is empty.`);
        if (per !== "low" && per !== "high") return bad(`${id}: Perishability must be Low or High (got "${get("Perishability")}").`);
        if (!isInt(std)) return bad(`${id}: Standard_Reorder_Qty must be a whole number (got "${std}").`);
        const cost = emptyToNull(get("Unit_Cost"));
        const tax = emptyToNull(get("Tax_Pct"));
        if (cost !== null && (!isFinite(Number(cost)) || Number(cost) < 0)) return bad(`${id}: Unit_Cost must be a number of 0 or more.`);
        if (tax !== null && (!isFinite(Number(tax)) || Number(tax) < 0 || Number(tax) > 100)) return bad(`${id}: Tax_Pct must be between 0 and 100.`);
        row = {
          sku_id: id, name, category: emptyToNull(get("Category")), perishability: per === "high" ? "High" : "Low", std_reorder_qty: Number(std),
          unit: emptyToNull(get("Unit_of_Measure")), distributor_id: emptyToNull(get("Distributor_ID")), hsn: emptyToNull(get("HSN_Code")),
          unit_cost: cost === null ? null : Number(cost), tax_pct: tax === null ? null : Number(tax),
        } satisfies SkuRow;
        break;
      }
      case "distributor_master": {
        const id = get("Distributor_ID");
        const name = get("Distributor_Name");
        if (!id) return bad("Distributor_ID is empty.");
        if (!name) return bad(`${id}: Distributor_Name is empty.`);
        const email = emptyToNull(get("Email"));
        if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad(`${id}: Email "${email}" does not look like an email address.`);
        row = {
          distributor_id: id, name, region: emptyToNull(get("Region")), status: emptyToNull(get("Status")) ?? "Active",
          address: emptyToNull(get("Address")), gstin: emptyToNull(get("GSTIN")), contact: emptyToNull(get("Contact")), email,
        } satisfies DistributorRow;
        break;
      }
      case "weekly_sales": {
        const id = get("SKU_ID");
        const week = get("Week");
        const u = get("Units_Sold");
        if (!id) return bad("SKU_ID is empty.");
        if (!/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(week)) return bad(`${id}: Week must look like 2026-W42 (got "${week}").`);
        if (!isInt(u)) return bad(`${id} ${week}: Units_Sold must be a whole number of 0 or more (got "${u}").`);
        row = { sku_id: id, week, units: Number(u) } satisfies SalesRow;
        break;
      }
      case "current_inventory": {
        const id = get("SKU_ID");
        const loc = get("Location");
        const u = get("Units_On_Hand");
        const d = get("As_Of_Date");
        if (!id) return bad("SKU_ID is empty.");
        if (!loc) return bad(`${id}: Location is empty.`);
        if (!isInt(u)) return bad(`${id}: Units_On_Hand must be a whole number of 0 or more (got "${u}").`);
        if (!validDate(d)) return bad(`${id}: As_Of_Date must look like 2026-10-19 (got "${d}").`);
        row = { sku_id: id, location: loc, units_on_hand: Number(u), as_of: d } satisfies InventoryRow;
        break;
      }
      default: {
        const ym = get("Year_Month");
        const f = get("Is_Festival_Month").toLowerCase();
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return bad(`Year_Month must look like 2026-10 (got "${ym}").`);
        if (!["true", "false", "1", "0", "yes", "no"].includes(f)) return bad(`${ym}: Is_Festival_Month must be TRUE or FALSE (got "${get("Is_Festival_Month")}").`);
        row = { year_month: ym, year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)), is_festival: ["true", "1", "yes"].includes(f) } satisfies CalendarRow;
      }
    }
    const k = keyOf(row);
    const prev = seen.get(k);
    if (prev !== undefined) out[prev] = row as RowOf[K];
    else {
      seen.set(k, out.length);
      out.push(row as RowOf[K]);
    }
  });
  result.rows = out;
  return result;
}
