# Freshroots Demand Planning

Twice-weekly stock recommendations for Raghav. **Drive + Sheets + Apps Script** run the rules; **Gemini** words the reasons; Raghav **approves, rejects or overrides in a web dashboard** (Vercel + Neon); every approved line is turned into a **numbered PDF purchase order**, which the Sheet files in Drive and emails to procurement. Nothing is generated without Raghav's approval.

Components map: `docs/demand_planning_components_map_v4.png`. Sample PO: `docs/sample_purchase_order.pdf`.

## How it works

```
SAP export (CSV, Tue/Fri) -> Drive folder
  -> Ingest.js    validates (completeness > 95%), loads clean tabs, keeps every inventory snapshot
  -> On-order POs POs the dashboard generated and nobody has marked received count as stock on order
  -> Engine.js    Raghav's 5 rules, one recommendation per SKU, priority score, manual lane
  -> Gemini.js    one-line reason per flag + run summary (numbers checked, template fallback)
  -> Sync.js      pushes the run to the dashboard (Neon)
  -> Dashboard    Raghav: Approve / Reject / Override qty. Reject and Override need a reason
  -> PO PDF       once every line of a run is decided (or "Generate POs now"), approved lines become
                  one PDF per vendor, numbered DP-YYYY-NNNN
  -> Drive + email  hourly, Apps Script saves each new PDF to Drive/Purchase Orders and emails it to procurement
  -> Sheet        decisions and PO numbers are mirrored back (Decision_Log, Approved, Rejections, Purchase_Orders)
  -> Rule_Review  a rule overridden 3+ times in 28 days opens a review; rules never edit themselves
```

| Where | File | Job |
|---|---|---|
| Apps Script | `Config.js`, `Engine.js` | Tab names and default rules; the pure rules engine (unit-tested in Node) |
| | `Ingest.js`, `Gemini.js` | Drive CSV to Sheets with the completeness gate; explanations with a number guard |
| | `Sync.js` | Push runs to the dashboard; pull decisions and on-order stock; file and email PO PDFs |
| | `Review.js`, `Main.js`, `Setup.js` | Sheet-only review (fallback), override feedback loop, pipeline, menu, triggers |
| Dashboard | `app/review` | Approve / reject / override; "Generate POs now" for a partial review |
| | `app/orders` | Generated POs (PDF link), filed/emailed status, "Mark received" |
| | `app/` overview, log, rules, cost | KPIs, guardrails vs kill criteria, review log, rule change rates, Gemini cost |
| | `lib/po.ts`, `lib/orders.ts`, `lib/pdf.ts` | Decision rules and PO numbering, PO generation, the PDF |
| | `app/api/*` | `ingest`, `pos`, `po/[number]`, `open-pos`, `decisions`, `status` |

Tests: `npm test` (15 engine tests) and `cd dashboard && npm test` (18 tests: metrics, decision rules, PO grouping and numbering, on-order stock, PDF generation).

## Setup

### 1. Google side (about 15 minutes)
1. **Drive:** one folder with `weekly_sales.csv`, `sku_master.csv`, `current_inventory.csv`, `calendar.csv`, `distributor_master.csv`. The newest file per name prefix wins. A `Purchase Orders` subfolder is created inside it for the PDFs.
2. **Sheet + script:** create a Sheet, Extensions > Apps Script, add the files from `apps-script/` (Config first) and `appsscript.json`, or `clasp push` from `apps-script/`. The manifest now asks for full Drive access (it creates the PDF folder and files), so Google will ask you to re-authorise.
3. Reload the Sheet. **Demand Planning > 1. Set up**, then **2. Configure**: Drive folder ID, Gemini key, `REVIEWER_EMAIL`, `BACKUP_EMAIL`, **`PROCUREMENT_EMAIL`** (receives each PO PDF), and later `DASHBOARD_URL` and `SYNC_SECRET`.
4. **Run pipeline now.** First runs are in shadow mode (`SHADOW_MODE = TRUE` in Rules_Config): recommendations go to `Shadow_Log`.

### 2. Dashboard (Neon + Vercel)
1. **Neon:** create a project; copy the pooled connection string.
2. Vercel project root directory `dashboard`. Environment variables: `DATABASE_URL`, `SYNC_SECRET` (long random string, same value in Apps Script), `DASHBOARD_PASSWORD`. Optional: `COMPANY_NAME` (default Freshroots), `SHIP_TO` (default Pune Central Warehouse, Pune), `OPEN_PO_DAYS` (default 21).
3. Deploy. The build creates the tables itself (`npm run db:migrate` runs when `DATABASE_URL` is present).
4. Set `DASHBOARD_URL` and `SYNC_SECRET` in the Apps Script Configure dialog. Then set `SHADOW_MODE` to `FALSE`, run the pipeline, open `/review` and sign in with your name and the team password.

Without `DATABASE_URL` the dashboard shows clearly labelled demo data: `cd dashboard && npm run dev`. With a database but no `DASHBOARD_PASSWORD` it refuses to load.

## What happens to a purchase order

1. Raghav decides each line. When the last line of a run is decided, all approved lines with a quantity above zero become POs automatically, one per vendor. The vendor is the Distributor_ID in `sku_master.csv`. If he stops part-way, **Generate POs now** does the same for what is approved so far, and anything still approved when the next run arrives is turned into POs then.
2. Each PO gets a number from a database sequence (`DP-2026-0001`) and a frozen copy of its lines. The PDF at `/api/po/<number>` always matches that copy.
3. Within the hour, Apps Script saves the PDF in `Purchase Orders` in Drive, emails it to `PROCUREMENT_EMAIL`, logs it in the `Purchase_Orders` tab and tells the dashboard it is delivered. A PO is never filed or emailed twice.
4. Procurement sends the PDF to the vendor. When the goods arrive, **Mark received** on the Purchase orders page. Until then the PO's quantities count as stock on order, so the rules do not flag a second order for a SKU that already has one out (POs older than `OPEN_PO_DAYS` stop counting, so a forgotten PO cannot hide a stockout).

The PO shows quantities only: the data has no prices, so rates and delivery date are left for the vendor to confirm. The vendor's email is not in the data either, which is why the PDF goes to procurement to forward.

## How the rules get re-evaluated

The rules are Raghav's fixed thresholds (20% trend, 6 and 14 weeks, +25% festival, 3 to 4 weeks for perishables). They never change by themselves. Every override or rejection is logged with its reason, and each decision carries the rule flags that triggered it. When the same rule is overridden or rejected `OVERRIDE_ALERT_COUNT` (3) or more times within `OVERRIDE_ALERT_DAYS` (28), a row opens in `Rule_Review` and on the dashboard's Rules page. **Ask Gemini to propose rule changes** drafts a short suggestion from the reviewers' own reasons (for example "overrides cluster in festival weeks"). Raghav and Deepa decide whether to edit `Rules_Config`. If more than 40% of all decisions are changed or rejected for four straight weeks, the rules are not matching Raghav's judgement and the project's kill criterion is hit.

## Decisions the build makes (all editable in Rules_Config)

- **Standard quantity** = `Standard_Reorder_Qty` in `sku_master.csv`.
- **Festival uplift** (+25%) applies to the demand behind weeks-of-cover, not to the 4-week vs 12-week trend. The festival month comes from the inventory as-of date.
- **Perishables** (`Perishability = High`) use a 3-4 week window; reorder quantities are capped so cover after the order stays within the maximum.
- **Precedence:** stockout (+/- high-demand) reorders, 1.5x if high-demand; high-demand alone reorders 1.5x; overstock alone pauses; overstock + high-demand and SKUs with under 12 weeks of history go to Raghav as `MANUAL_REVIEW`.
- **Priority score** (1-100) replaces "confidence": how far past its threshold a SKU is, boosted for perishables.

## Guardrails

- Gemini only words numbers the engine computed. A reply with any other number is discarded and the template reason used.
- A run aborts, without overwriting anything, if sales completeness is below 95%. Owners are emailed.
- Each recommendation is decided once. Approve of a manual-review row is blocked; Reject and Override need a reason; Override to 0 records the change and orders nothing.
- PO generation claims lines before numbering them, so two simultaneous requests cannot put a line on two POs; a failure puts the lines back so the next call retries.
- Undecided rows from the previous live run are marked `EXPIRED` when the next run arrives, so they are counted.
- The dashboard needs a password; the machine endpoints need `SYNC_SECRET`.

## Known limits

- The sample is 15 SKUs and 16 weeks. The backtest gate and baselines need the full SAP export and Raghav's past recommendations.
- Zoho Inventory is not used: it could not be set up, so purchase orders are PDFs instead. The PO flow can later be pointed at an ERP without changing the review step.
- The shared password gate is fine for a project. For real use, move to per-user sign-in.
- Apps Script runs have a 6-minute limit; the Sales tab can hold the full export (about 62K rows for 400 SKUs over 3 years).
