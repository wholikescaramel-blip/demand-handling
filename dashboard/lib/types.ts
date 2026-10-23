import type { ImpactSettings, LossEntry } from "./impact.ts";

export type Run = {
  run_id: string;
  run_at: string; // ISO
  as_of: string | null;
  mode: string | null; // SHADOW | LIVE
  status: string; // OK | ABORTED | FAILED
  skus: number | null;
  completeness: number | null;
  flagged: number | null;
  healthy: number | null;
  n_reorder: number;
  n_pause: number;
  n_manual: number;
  festival: boolean | null;
  gemini_reasons: string | null;
  gemini_tokens: number;
  summary: string | null;
  notes: string | null;
  review_due_at?: string | null; // ISO
};

export type Rec = {
  run_id: string;
  sku: string;
  name: string | null;
  perishable: boolean | null;
  action: string;
  rec_qty: number | null;
  priority: number | null;
  on_hand: number | null;
  open_po: number | null;
  cover_weeks: number | null;
  trend_pct: number | null;
  flags: string | null;
  reason: string | null;
  reason_source: string | null;
  data_notes: string | null;
  distributor_id?: string | null;
  distributor_name?: string | null;
  // joined from decisions (null = not decided)
  decision: string | null;
  final_qty: number | null;
  change_reason: string | null;
  po_status?: string | null;
  po_number?: string | null;
};

export type Decision = {
  decided_at: string; // ISO
  run_id: string;
  sku: string;
  action: string | null;
  rec_qty: number | null;
  flags: string | null;
  priority: number | null;
  decision: string; // Approve | Override | Reject | EXPIRED
  final_qty: number | null;
  reason: string | null;
  reviewer: string | null;
  hours_to_decide: number | null;
  name?: string | null;
  po_status?: string | null; // NONE | READY | CREATED
  po_number?: string | null;
  po_id?: string | null;
  po_vendor?: string | null;
  po_error?: string | null;
  po_created_at?: string | null;
};

export type RuleReview = {
  id: number;
  opened_at: string;
  rule: string;
  changed: number | null;
  total: number | null;
  rate: string | null;
  proposal: string | null;
  status: string;
};

export type PoLineRow = {
  run_id: string;
  sku: string;
  name: string | null;
  qty: number;
  unit?: string | null;
  hsn?: string | null;
  rate?: number | null; // purchase rate per unit, when sku_master has Unit_Cost
  tax_pct?: number | null;
};

export type VendorInfo = {
  key: string;
  name: string | null;
  address: string | null;
  gstin: string | null;
  contact: string | null;
  email: string | null;
};

export type PurchaseOrder = {
  po_number: string;
  created_at: string; // ISO
  vendor_key: string;
  vendor_name: string | null;
  vendor?: VendorInfo | null;
  run_ids: string | null;
  created_by: string | null;
  total_qty: number;
  total_amount?: number | null; // Rs incl. tax, only when every line has a rate
  lines: PoLineRow[];
  sent_at: string | null; // emailed from the dashboard
  sent_to: string | null;
  received_at: string | null; // goods received: stops counting as stock on order
};

export type Snapshot = {
  runs: Run[]; // newest first
  latestRun: Run | null;
  recs: Rec[]; // for latestRun, priority desc
  decisions: Decision[]; // newest first
  ruleReviews: RuleReview[];
  pos: PurchaseOrder[]; // newest first
  impact: { entries: LossEntry[]; settings: ImpactSettings };
  vendorEmails?: Record<string, string>; // last address used per vendor
};
