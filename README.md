# Freshroots Demand Planning

Twice-weekly stock recommendations for Raghav. **Drive + Sheets + Apps Script** run the rules; **Gemini** words the reasons; Raghav **approves, rejects or overrides in a web dashboard** (Vercel + Neon); approved lines become **purchase orders in Zoho Inventory**. A human approves every recommendation, and nothing is created in Zoho without that approval.

Components map: `docs/demand_planning_components_map_v3.png` (v2 is the earlier, sheet-only review version).

## How it works

```
SAP export (CSV, Tue/Fri) -> Drive folder
  -> Ingest.js    validates (completeness > 95%), loads clean tabs, keeps every inventory snapshot
  -> Zoho (read)  open POs pulled via the dashboard, so flags do not re-order what is already on order
  -> Engine.js    Raghav's 5 rules, one recommendation per SKU, priority score, manual lane
  -> Gemini.js    one-line reason per flag + run summary (numbers checked, template fallback)
  -> Sync.js      pushes the run to the dashboard (Neon)
  -> Dashboard    Raghav: Approve / Reject / Override qty. Reject and Override need a reason
  -> Zoho (write) "Create POs in Zoho": one PO per vendor, as draft; failures can be retried
  -> Sheet        decisions and PO numbers are mirrored back (Decision_Log, Approved, Rejections)
  -> Rule_Review  a rule overridden 3+ times in 28 days opens a review; rules never edit themselves
```

| Where | File | Job |
|---|---|---|
| Apps Script | `Config.js` | Tab names, default rules table, Sheets helpers |
| | `Engine.js` | Pure rules engine (no Google APIs, unit-tested in Node) |
| | `Ingest.js` | Drive CSV to Sheets, completeness gate, inventory history |
| | `Gemini.js` | Explanations, run summary, rule-change proposals, number guard |
| | `Sync.js` | Push runs to the dashboard; pull decisions, PO numbers and Zoho open POs back |
| | `Review.js` | Sheet-only review (fallback), SLA nudge, override feedback loop |
| | `Main.js`, `Setup.js` | `runPipeline`, run log, menu, triggers, configure dialog |
| Dashboard | `app/review` | Approve / reject / override, then "Create POs in Zoho" |
| | `app/orders` | POs created, failures and retry, Zoho connection status |
| | `app/` (overview, log, rules, cost) | KPIs, guardrails vs kill criteria, review log, rule change rates, Gemini cost, run health |
| | `lib/po.ts`, `lib/zoho.ts`, `lib/orders.ts` | Decision rules, Zoho client, PO creation |
| | `app/api/*` | `ingest` (Apps Script pushes), `open-pos`, `decisions`, `status` (Apps Script pulls) |

Tests: `npm test` (15 engine tests) and `cd dashboard && npm test` (18 tests: metrics, decision rules, PO grouping, Zoho payloads).

## Setup

### 1. Google side (about 15 minutes)
1. **Drive:** one folder with `weekly_sales.csv`, `sku_master.csv`, `current_inventory.csv`, `calendar.csv`, `distributor_master.csv`. The newest file per name prefix wins.
2. **Sheet + script:** create a Sheet, Extensions > Apps Script, add the files from `apps-script/` (Config first) and `appsscript.json`, or `clasp push` from `apps-script/` (`.clasp.json` holds the script id).
3. Reload the Sheet. **Demand Planning > 1. Set up**, then **2. Configure** (Drive folder ID, Gemini key, emails, and later `DASHBOARD_URL` and `SYNC_SECRET`).
4. **Run pipeline now.** First runs are in shadow mode (`SHADOW_MODE = TRUE` in Rules_Config): recommendations go to `Shadow_Log`.

### 2. Dashboard (Neon + Vercel)
1. **Neon:** create a project; copy the connection string.
2. In `dashboard/`: copy `.env.example` to `.env.local`, fill `DATABASE_URL`, `SYNC_SECRET` (a long random string) and `DASHBOARD_PASSWORD`; `npm install`; `npm run db:migrate`.
3. **Vercel:** import the repo with `dashboard` as the root directory, add the same variables, deploy.
4. In Apps Script Configure: set `DASHBOARD_URL` (the Vercel URL) and the same `SYNC_SECRET`. From now on a live run is reviewed in the dashboard, not in the Sheet's Review tab.
5. Go live: set `SHADOW_MODE` to `FALSE`, run the pipeline, open `/review` and sign in with your name and the team password. Your name is recorded on each decision.

Without `DATABASE_URL` the dashboard shows clearly labelled demo data (the real engine on your sample CSVs, with illustrative decisions): `cd dashboard && npm run dev`.

### 3. Zoho Inventory
1. At `api-console.zoho.in` (or your data centre) create a **Self Client**. Generate a grant code with scopes `ZohoInventory.purchaseorders.CREATE, ZohoInventory.purchaseorders.READ, ZohoInventory.items.READ, ZohoInventory.contacts.READ`, exchange it for a **refresh token**.
2. Add to the dashboard environment: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_DC`. Redeploy.
3. **Items:** each Zoho item must carry the same SKU as `sku_master.csv` (SKU001 and so on).
4. **Vendors:** the vendor on a PO is the Distributor_ID from `sku_master.csv`. Map each to a Zoho vendor with `ZOHO_VENDOR_MAP`, or name the Zoho vendor exactly like the distributor, or set `ZOHO_DEFAULT_VENDOR_ID`.
5. The **Purchase orders** page shows the connection. POs are created as **draft** by default (`ZOHO_PO_STATUS=issued` issues them immediately).
6. Check once on a test org: create a PO from one approved line and compare it with what you expect. Two things Zoho's docs leave open are handled defensively: whether your org auto-numbers POs (`ZOHO_PO_NUMBER_PREFIX` if not), and the PO status values used to decide what counts as "on order" (draft and open count; billed, closed, cancelled do not).

## Decisions the build makes (all editable in Rules_Config)

- **Standard quantity** = `Standard_Reorder_Qty` in `sku_master.csv`.
- **Festival uplift** (+25%) applies to the demand behind weeks-of-cover, not to the 4-week vs 12-week trend (applying it to one side would flag every SKU). The festival month comes from the inventory as-of date.
- **Perishables** (`Perishability = High`) use a 3-4 week window instead of 6/14; reorder quantities are capped so cover after the order stays within the maximum.
- **Precedence:** stockout (+/- high-demand) reorders, 1.5x if high-demand; high-demand alone reorders 1.5x; overstock alone pauses; overstock + high-demand and SKUs with under 12 weeks of history go to Raghav as `MANUAL_REVIEW`.
- **Priority score** (1-100) replaces "confidence": how far past its threshold a SKU is, boosted for perishables.
- **POs are created per vendor, on a button press**, not per click on Approve. That avoids one PO per SKU and gives Raghav one last look at what is going to Zoho.

## Guardrails

- Gemini only words numbers the engine computed. A reply with any other number is discarded and the template reason used. If Gemini fails, the run still completes.
- A run aborts, without overwriting anything, if sales completeness is below 95%. Owners are emailed.
- Each recommendation can be decided once. Approve of a manual-review row is blocked; Reject and Override need a reason; Override to 0 records the change and orders nothing.
- PO creation claims lines before calling Zoho, so a double click cannot create the same PO twice. Failures keep their error and can be retried.
- Undecided rows from the previous live run are marked `EXPIRED` when the next run arrives, so they are counted.
- `Rule_Review` and the dashboard track override rate against the 40% adoption kill line. Gemini drafts rule proposals as text only.

## Known limits

- The sample is 15 SKUs and 16 weeks. The backtest gate and baselines need the full SAP export and Raghav's past recommendations.
- The Zoho client has not been run against a live Zoho organisation (no account was available); it follows Zoho's published API and is covered by unit tests on payloads and parsing, not on live calls.
- The shared password gate is fine for a project. For real use, move to per-user sign-in.
- Apps Script runs have a 6-minute limit; the Sales tab can hold the full export (about 62K rows for 400 SKUs over 3 years).
