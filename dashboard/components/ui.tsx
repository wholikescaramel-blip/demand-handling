import type { ReactNode } from "react";
import type { KillCheck } from "@/lib/metrics";

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export const pct = (x: number | null, digits = 0) => (x === null ? "n/a" : `${(x * 100).toFixed(digits)}%`);

export function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

const ACTION_CLASS: Record<string, string> = { REORDER: "reorder", PAUSE: "pause", MANUAL_REVIEW: "manual" };
const ACTION_LABEL: Record<string, string> = { REORDER: "Reorder", PAUSE: "Pause", MANUAL_REVIEW: "Manual review" };

export function ActionPill({ action }: { action: string }) {
  return <span className={`pill ${ACTION_CLASS[action] ?? "neutral"}`}>{ACTION_LABEL[action] ?? action}</span>;
}

export function DecisionPill({ decision }: { decision: string | null }) {
  if (!decision) return <span className="pill na">Awaiting</span>;
  const cls = decision === "Approve" ? "ok" : decision === "Override" ? "warn" : decision === "Reject" ? "breach" : "na";
  const label = decision === "Approve" ? "Approved" : decision === "Override" ? "Approved, qty changed" : decision === "Reject" ? "Rejected" : decision === "EXPIRED" ? "Expired" : decision;
  return <span className={`pill ${cls}`}>{label}</span>;
}

const PO_CLASS: Record<string, string> = { READY: "warn", CREATED: "ok", NONE: "na" };
const PO_LABEL: Record<string, string> = { READY: "Approved, PO pending", CREATED: "PO generated", NONE: "No PO" };

export function PoPill({ status }: { status: string | null | undefined }) {
  const s = status ?? "NONE";
  return <span className={`pill ${PO_CLASS[s] ?? "na"}`}>{PO_LABEL[s] ?? s}</span>;
}

const STATUS_LABEL = { ok: "OK", warn: "Watch", breach: "Breach", na: "n/a" } as const;

export function KillChecks({ checks }: { checks: KillCheck[] }) {
  return (
    <div className="checks">
      {checks.map((c) => (
        <div className="check" key={c.name}>
          <span className="name">{c.name}</span>
          <span className={`pill ${c.status}`}>{STATUS_LABEL[c.status]}</span>
          <span className="small dim">{c.rule}</span>
          <span className="small">{c.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DemoBanner({ demo }: { demo: boolean }) {
  if (!demo) return null;
  return (
    <div className="banner" role="note">
      <strong>Practice mode.</strong> No database is connected, so this shows the real rules engine run on your five sample CSVs. Nothing has been
      decided: you decide. Your clicks are kept in this browser only, so you can try Approve, Reject and the POs. Connect Neon (<code>DATABASE_URL</code>) to make it real.
    </div>
  );
}
