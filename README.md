# Freshroots Demand Planning

Twice-weekly stock recommendations for Raghav. **Drive + Sheets + Apps Script** run the rules; **Gemini** words the reasons; Raghav **presses Approve or Reject in a web dashboard** (Vercel + Neon): the rules only recommend, and every approval creates a PO. Each approval creates one **numbered purchase order in a standard PO format**, which can be downloaded or emailed from the dashboard. A graph tracks whether losses are actually falling, with a day-90 verdict. Nothing is generated without Raghav's approval.

Components map: `docs/demand_planning_components_map_v5.png`. Sample PO: `docs/sample_purchase_order.pdf` (illustrative details).

## How it works

```
SAP export (CSV, Tue/Fri) -> Drive folder
  -> Ingest.js    validates (completeness > 95%), loads clean tabs, keeps every inventory snapshot
  -> On-order POs POs the dashboard generated and nobody has marked received count as stock on order
  -> Engine.js    Raghav's 5 rules, one recommendation per SKU, priority score, manual lane
  -> Gemini.js    one-line reason per flag + run summary (numbers checked, template fallback)
  -> Sync.js      pushes the run (and vendor details) to the dashboard (Neon)
  -> Dashboard    one card per SKU with the rule metrics. Raghav presses Approve (quantity box pre-filled, editable)
                  or Reject (a reason is required). Changing the quantity also needs a reason
  -> PO           Approve with a quantity above 0 creates that line's PO straight away, numbered DP-YYYY-NNNN
  -> Download / email   buttons on the Purchase orders page; email goes from your Gmail via an Apps Script web app
  -> Sheet        decisions and PO numbers are mirrored back (Decision_Log, Approved, Rejections)
  -> Rule_Review  a rule overridden 3+ times in 28 days opens a review; rules never edit themselves
  -> Impact       finance enters weekly losses; graph vs the pre-AI baseline; day-90 keep / review / revert verdict
```

| Where | File | Job |
|---|---|---|
| Apps Script | `Config.js`, `Engine.js` | Tab names and default rules; the pure rules engine (unit-tested in Node) |
| | `Ingest.js`, `Gemini.js` | Drive CSV to Sheets with the completeness gate; explanations with a number guard |
| | `Sync.js` | Push runs to the dashboard; pull decisions and on-order stock back |
| | `Mail.js` | Optional web app: lets the dashboard email a PO from your Gmail |
| | `Review.js`, `Main.js`, `Setup.js` | Sheet-only review (fallback), override feedback loop, pipeline, menu, triggers |
| Dashboard | `app/review`, `app/orders` | Approve / Reject cards; POs with Preview, Download, Send by email, Mark received |
| | `app/impact` | Weekly loss entries, graphs, day counter, day-90 verdict |
| | `app/` overview, log, rules, cost | KPIs, guardrails vs kill criteria, review log, rule change rates, Gemini cost |
| | `lib/po.ts`, `lib/orders.ts`, `lib/pdf.ts`, `lib/impact.ts`, `lib/mail.ts` | Decision rules and numbering, PO generation, the PDF, impact maths, email |

Tests: `npm test` (15 engine tests) and `cd dashboard && npm test` (34 tests: metrics, decisions, PO numbering and layout, on-order stock, impact maths).

## The purchase order

The PDF follows the standard layout of a supplier PO: title, company block, supplier panel (name, address, GSTIN, contact, email, supplier code, PO number, date, expiry), Bill To / Ship To, payment terms, an item table (S.No, product code, product name, HSN, quantity, units, rate, tax, amount), totals, terms and conditions, and a signature box.

It uses what the data has and shows "-" where it does not. To fill the rest, add **optional columns** to your CSVs:

| File | Optional columns | Used for |
|---|---|---|
| `sku_master.csv` | `HSN_Code`, `Unit_Cost`, `Tax_Pct` (and the existing `Unit_of_Measure`) | HSN, rate, tax and amount per line, and the PO total |
| `distributor_master.csv` | `Address`, `GSTIN`, `Contact`, `Email` | The supplier panel; the vendor's email pre-fills the "Send by email" box |

Company details come from Vercel environment variables (all optional): `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_GSTIN`, `COMPANY_CONTACT`, `COMPANY_EMAIL`, `SHIP_TO` (lines separated by `|`), `PO_EXPIRY_DAYS` (7), `PAYMENT_TERMS`, `PO_TERMS` (clauses separated by `|`). Without prices the Amount column and grand total say so, and the terms ask the vendor to confirm rates.

1. Raghav presses **Approve** on a card. The quantity box starts at the recommendation; if he types a different quantity it is recorded as a change and needs a reason. A quantity above zero creates that line's PO immediately: one approval, one PO, with the vendor from the Distributor_ID in `sku_master.csv`. If creating the PO ever fails, the card shows a **Create PO** button and the Purchase orders page has **Create the missing POs**.
2. Each PO gets a number from a database sequence and a frozen copy of its lines and vendor details, so the PDF never changes after the fact.
3. On the **Purchase orders** page: **Preview**, **Download PDF**, **Send by email**, **Mark received**.
4. Until marked received, a PO's quantities count as stock on order, so a SKU that already has an order out is not flagged again (POs older than `OPEN_PO_DAYS`, default 21, stop counting).

### Setting up "Send by email" (optional, about 5 minutes)
Download always works. Email needs one small web app in the Apps Script project, so it is sent from your own Gmail and there is no email service to sign up for:
1. In the Apps Script editor add `Mail.js` and replace `appsscript.json` with the one in this repo (it declares the web app).
2. Make sure `SYNC_SECRET` is set (Demand Planning > Configure).
3. **Deploy > New deployment > Select type: Web app > Execute as: Me > Who has access: Anyone > Deploy.** Allow the permissions.
4. Copy the **Web app URL** and add it in Vercel as `MAIL_WEBHOOK_URL`. Redeploy.
5. The "Send by email" button on each PO now works. The script refuses any request that does not carry the shared secret.
Gmail's own daily sending limit applies (about 100 a day on a free account).

## Impact tracker and the day-90 kill switch

The dashboard's **Impact** page answers "are losses actually falling?" without needing 90 days of data on screen.
- **Finance enters one row per week**: lost sales from stockouts, overstock write-offs, and how much of the write-off was perishable, in rupees lakh. Saving the same week again corrects it.
- The **baseline** is what planning errors cost before the system (the brief says Rs 28 to 34 lakh a quarter), turned into a weekly figure (middle of the range over 13 weeks, about Rs 2.38 lakh). Editable under *Baseline and go-live settings*.
- **Go-live** defaults to the date of the first live run.
- Two graphs update with every entry: weekly losses (stockout + overstock) against the baseline line, and the running total saved.
- A reading needs 4 weekly entries. It is shown as "not final" until day 90. At day 90: losses **30% or more below baseline** keep the system; **10 to 30%** below review the rules with Deepa; **under 10%**, or higher, **shift back to manual planning**. If perishable write-offs rise above their baseline, the guardrail is breached whatever the total says.
- The overview's Guardrails card shows the same reading as a check.

## Setup

### 1. Google side (about 15 minutes)
1. **Drive:** one folder with `weekly_sales.csv`, `sku_master.csv`, `current_inventory.csv`, `calendar.csv`, `distributor_master.csv`. The newest file per name prefix wins.
2. **Sheet + script:** create a Sheet, Extensions > Apps Script, add the files from `apps-script/` (Config first) and `appsscript.json`, or `clasp push` from `apps-script/`.
3. Reload the Sheet. **Demand Planning > 1. Set up**, then **2. Configure**: Drive folder ID, Gemini key, `REVIEWER_EMAIL`, `BACKUP_EMAIL`, and later `DASHBOARD_URL` and `SYNC_SECRET`. `PROCUREMENT_EMAIL` is only used by the Sheet-only review mode and can stay empty.
4. **Run pipeline now.** First runs are in shadow mode (`SHADOW_MODE = TRUE` in Rules_Config): recommendations go to `Shadow_Log`.

### 2. Dashboard (Neon + Vercel)
1. **Neon:** create a project; copy the pooled connection string.
2. Vercel project root directory `dashboard`. Environment variables: `DATABASE_URL`, `SYNC_SECRET` (long random string, same value in Apps Script), `DASHBOARD_PASSWORD`. Everything else is optional (see `dashboard/.env.example`).
3. Deploy. The build creates the tables itself (`npm run db:migrate` runs when `DATABASE_URL` is present).
4. Set `DASHBOARD_URL` and `SYNC_SECRET` in the Apps Script Configure dialog. Then set `SHADOW_MODE` to `FALSE`, run the pipeline, open `/review` and sign in with your name and the team password.

Without `DATABASE_URL` the dashboard runs in **practice mode**: it shows the real rules engine on your sample CSVs with nothing decided, and every Approve and Reject you click is kept in your own browser only (a **Clear my practice decisions** button resets it). The Impact graphs use clearly labelled illustrative numbers. Run it locally with `cd dashboard && npm run dev`. With a database but no `DASHBOARD_PASSWORD` it refuses to load.

## How the rules get re-evaluated

The rules are Raghav's fixed thresholds (20% trend, 6 and 14 weeks, +25% festival, 3 to 4 weeks for perishables). They never change by themselves. Every override or rejection is logged with its reason and the rule flags that triggered it. When the same rule is overridden or rejected 3 or more times within 28 days, a row opens in `Rule_Review` and on the dashboard's Rules page. **Ask Gemini to propose rule changes** drafts a short suggestion from the reviewers' own reasons. Raghav and Deepa decide whether to edit `Rules_Config`. If more than 60% of all decisions have a changed quantity or are rejected for four straight weeks, the rules are not matching Raghav's judgement and the adoption kill criterion is hit.

## Decisions the build makes (all editable in Rules_Config)

- **Standard quantity** = `Standard_Reorder_Qty` in `sku_master.csv`.
- **Festival uplift** (+25%) applies to the demand behind weeks-of-cover, not to the 4-week vs 12-week trend. The festival month comes from the inventory as-of date.
- **Perishables** (`Perishability = High`) use a 3-4 week window; reorder quantities are capped so cover after the order stays within the maximum.
- **Precedence:** stockout (+/- high-demand) reorders, 1.5x if high-demand; high-demand alone reorders 1.5x; overstock alone pauses; overstock + high-demand and SKUs with under 12 weeks of history go to Raghav as `MANUAL_REVIEW`.
- **Priority score** (1-100) replaces "confidence": how far past its threshold a SKU is, boosted for perishables.

## Guardrails

- Gemini only words numbers the engine computed. A reply with any other number is discarded and the template reason used.
- A run aborts, without overwriting anything, if sales completeness is below 95%. Owners are emailed.
- Each recommendation is decided once. Reject needs a reason; so does changing the quantity (that is stored as an "Override" in the logs: Raghav approved, but not as the rules recommended). A manual-review row has no recommended quantity, so Raghav types one and says why. A PAUSE recommendation starts at 0: Approve skips the order, a quantity orders anyway.
- PO generation claims lines before numbering them, so two simultaneous requests cannot put a line on two POs; a failure puts the lines back so the next call retries.
- The email web app and the machine endpoints need `SYNC_SECRET`; the dashboard needs a password.

## Known limits

- The sample is 15 SKUs and 16 weeks. The backtest gate and baselines need the full SAP export and Raghav's past recommendations.
- Loss numbers for the Impact page come from finance by hand: the sales and stock data carry no prices.
- Zoho Inventory is not used (it could not be set up). POs are generated in the app; sending them to a vendor is a download or an email, not an ERP push.
- The shared password gate is fine for a project. For real use, move to per-user sign-in.

## Look and feel

The dashboard is styled for Freshroots: soft glass cards over a light garden background, translucent fruit and vegetables floating behind, a vine that grows down the right edge as you scroll (click or drag it to jump), and little sprouts and leaves popping up on the corners of the cards. Animations switch off for visitors who prefer reduced motion.
