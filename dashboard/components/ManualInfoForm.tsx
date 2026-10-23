import { saveManualInfo } from "@/app/review/actions";

/** Fields a person fills in for a SKU the rules cannot judge. Saving runs planning, so Stock and Review both update. */
export function ManualInfoForm({
  sku, from, onHand, weeklyDemand, note, needStock,
}: {
  sku: string;
  from: "review" | "stock";
  onHand: number | null;
  weeklyDemand: number | null;
  note: string | null;
  needStock: boolean; // no stock record exists, so the stock figure is required
}) {
  return (
    <form action={saveManualInfo} className="decide">
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="from" value={from} />
      <label className="small dim">
        Stock in hand{needStock ? "" : " (optional)"}
        <input name="on_hand" type="number" min={0} step={1} inputMode="numeric" defaultValue={onHand ?? ""} required={needStock && onHand === null} />
      </label>
      <label className="small dim">
        Expected demand per week
        <input name="weekly_demand" type="number" min={0} step="any" inputMode="decimal" defaultValue={weeklyDemand ?? ""} />
      </label>
      <label className="small dim grow">
        Note (optional)
        <input name="note" type="text" maxLength={300} defaultValue={note ?? ""} placeholder="e.g. launch estimate from the vendor" />
      </label>
      <button className="btn primary" type="submit">Save</button>
    </form>
  );
}
