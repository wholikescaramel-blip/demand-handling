# Freshroots Demand Planning

One web app on **Vercel** with **Neon** as its only database. The dashboard is the front end; every piece of data (SKUs, distributors, sales, stock, the festival calendar, Raghav's rules, decisions, purchase orders) lives in Neon and is changed from the dashboard. There is no Apps Script, Drive or Sheet any more.

Raghav's rules *recommend*. Raghav presses **Approve** or **Reject** on each SKU; an approval creates that line's **purchase order** (PDF in a standard supplier-PO layout), which can be downloaded or emailed. **Gemini** only words the reasons, and only with numbers the rules produced.

Components map: `docs/demand_planning_components_map_v6.png`. Sample PO: `docs/sample_purchase_order.pdf`.

## What each page does

| Page | What you do there |
|---|---|
| **Overview** | Numbers at a glance, the guardrails, the latest recommendations. **Run planning now** applies the rules to what is in Neon. |
| **Review** | One card per flagged SKU with the metrics (stock, weeks of cover, trend, which rule fired). **Approve** (the quantity box starts at the recommendation and is editable; changing it needs a reason) or **Reject** (reason needed). Approve creates the PO right away, with **Download PDF** and **Send by email**. |
| **Purchase orders** | Every PO: preview, download, email, mark received. |
| **Data** | Upload a CSV for any dataset (add/update rows, or replace everything), download what is there now or a blank template, and open **Manage SKUs** / **Manage distributors** to add, edit or remove single items. |
| **Rules** | Edit every threshold (the five rules, the windows, shadow mode, the kill line, data checks). Also the queue of rules that are changed too often. |
| **Impact** | Weekly losses vs the pre-AI baseline, graphs, and the day-90 keep / review / go-back-to-manual verdict. |
| **Review log** | Every decision with its reason. |

## How a run works

1. `Run planning` (the button, or the Tuesday/Friday schedule) reads Neon: active SKUs, the latest 12+ weeks of sales, the latest stock per SKU and location, the festival calendar, the rules, and POs not yet marked received (counted as stock on order).
2. It refuses to run if sales data is less than 95% complete over the baseline window, and says so on screen.
3. Raghav's rules give one recommendation per SKU (reorder, pause, or manual review) with a priority score. SKUs with under 12 weeks of history, and SKUs whose signals conflict, go to Raghav as a manual review.
4. Gemini words a one-line reason for each (optional). Any reply containing a number the rules did not produce is thrown away and the standard wording is used.
5. The recommendations wait on the Review page. Nothing is ordered until Raghav approves. Undecided cards expire when the next run arrives.

## Setup

1. **Neon:** create a project; copy the **pooled** connection string.
2. **Vercel** (the project's root directory is `dashboard`): add these environment variables, then redeploy. The build creates the tables itself.

| Variable | Needed? | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `DASHBOARD_PASSWORD` | yes | The team password for the login page. With a database but no password the site refuses to load. |
| `CRON_SECRET` | for the schedule | Any long random string; lets Vercel's Tue/Fri cron call `/api/cron/run` |
| `GEMINI_API_KEY` | optional | Gemini words the reasons. Without it the standard wording is used. |
| `SMTP_USER`, `SMTP_PASS` | optional | Email POs from the dashboard. Gmail: an app password (Google account > Security > 2-Step Verification > App passwords). Without them, Download still works. |
| `COMPANY_*`, `SHIP_TO`, `PAYMENT_TERMS`, `PO_TERMS`, `OPEN_PO_DAYS` | optional | Company block and wording on the PO (see `dashboard/.env.example`) |

3. Open **Data** and upload your CSVs, in this order: distributors, SKUs, weekly sales, stock, calendar. (To do it from a terminal instead: put the values in `dashboard/.env.local`, then `npm run db:migrate` and `npm run seed` in `dashboard/`. That loads the five CSV files from the repo root, and is safe to repeat.)
4. Press **Run planning now**, open **Review**.

## The CSV files

| File | Columns (required; optional in brackets) |
|---|---|
| `sku_master.csv` | SKU_ID, SKU_Name, Perishability (Low/High), Standard_Reorder_Qty; [Category, Unit_of_Measure, Distributor_ID, HSN_Code, Unit_Cost, Tax_Pct] |
| `distributor_master.csv` | Distributor_ID, Distributor_Name; [Region, Status, Address, GSTIN, Contact, Email] |
| `weekly_sales.csv` | SKU_ID, Week (2026-W42), Units_Sold |
| `current_inventory.csv` | SKU_ID, Location, Units_On_Hand, As_Of_Date. Every upload is kept as history; the latest date per SKU and location is current |
| `calendar.csv` | Year_Month, Is_Festival_Month; [Year, Month] |

Every row is checked. Bad rows are skipped and listed (the first 20 with their row numbers), never silently fixed; a file with the wrong columns changes nothing. Sales and stock rows for a SKU that is not in the SKU list are skipped and named. Uploads can be up to 4 MB per file (Vercel's request limit); split bigger files and upload them one after the other.

The optional SKU and distributor columns fill the supplier panel, HSN, rate, tax and amount on the PO. Without them the PO shows "-" and asks the vendor to confirm rates.

## The purchase order

Title, company block, supplier panel (name, address, GSTIN, contact, email, supplier code, PO number, date, expiry), Bill To / Ship To, payment terms, item table (S.No, code, name, HSN, quantity, units, rate, tax, amount), totals, terms and conditions, signature box. One PO per approval. A PO stays "on order" (and counts as stock, so the rules do not flag the SKU again) until someone presses **Mark received**; POs older than `OPEN_PO_DAYS` (21) stop counting anyway.

## Re-evaluating the rules

The thresholds are Raghav's and never change by themselves. Every quantity change and every rejection is logged with its reason and the rule that fired. When one rule is changed or rejected `Open a rule review after this many changes` times (3) within 28 days, it appears under **Rules waiting for a second look**. Gemini can draft a short suggestion from Raghav's own reasons; Raghav and Deepa decide whether to edit the number on the Rules page. If more than **60%** of decisions have a changed quantity or are rejected for four straight weeks, the rules do not match Raghav's judgement: that is the adoption kill criterion.

## Impact and the day-90 kill switch

Finance enters one row per week (stockout losses, overstock write-offs, the perishable part, in rupees lakh). The baseline is the brief's Rs 28 to 34 lakh a quarter spread over 13 weeks. Two graphs update with every entry. A reading needs 4 weeks; at day 90, losses 30% or more below baseline: keep; 10 to 30%: review the rules with Deepa; under 10%: shift back to manual planning. Rising perishable write-offs breach the guardrail whatever the total says.

## Code map (`dashboard/`)

`lib/engine.ts` (rules, pure) · `lib/rules.ts` (defaults and validation) · `lib/planning.ts` (the run) · `lib/decisions.ts` + `lib/po.ts` (Approve/Reject rules) · `lib/orders.ts` + `lib/pdf.ts` (POs) · `lib/importers.ts` + `lib/store.ts` + `lib/csv.ts` (CSV in and out of Neon) · `lib/gemini.ts` · `lib/feedback.ts` · `lib/impact.ts` · `lib/mail.ts` · `db/schema.sql` · `app/` (pages and server actions) · `vercel.json` (the Tue/Fri cron).

## Tests

`cd dashboard && npm test` runs 81 tests: the rules engine against your five CSVs, the importers, Gemini's number guard, decisions and POs, the impact maths, and a whole-flow suite on an in-memory Postgres (import, plan, approve, PO, feedback, shadow mode, adding and removing SKUs, completeness stop). A browser click-through of the real pages (uploads, run, approve, reject, PDF download, rules) also passed, 35 of 35.

## Known limits

- The sample is 15 SKUs and 16 weeks. The backtest and baselines need the full SAP export and Raghav's past recommendations.
- Loss numbers for Impact come from finance by hand: the sales and stock data carry no prices.
- The shared password is fine for a project; real use should move to per-user sign-in.
- The planning run is capped by Vercel's function time (60 s), which is ample for hundreds of SKUs.
