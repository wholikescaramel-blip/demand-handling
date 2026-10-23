-- Idempotent: safe to run repeatedly (npm run db:migrate). Neon is the single source of truth.

-- ---------- master data (edited on the Data page, or by uploading CSVs) ----------
create table if not exists distributors (
  distributor_id text primary key,
  name           text not null,
  region         text,
  status         text not null default 'Active',
  address        text,
  gstin          text,
  contact        text,
  email          text
);

create table if not exists skus (
  sku_id             text primary key,
  name               text not null,
  category           text,
  perishability      text not null default 'Low',     -- Low | High
  std_reorder_qty    integer not null default 0,
  unit               text,
  distributor_id     text,
  hsn                text,
  unit_cost          double precision,
  tax_pct            double precision,
  active             boolean not null default true
);

create table if not exists sales_weekly (
  sku_id text not null,
  week   text not null,                                -- 2026-W42
  units  integer not null,
  primary key (sku_id, week)
);

create table if not exists inventory_snapshots (
  sku_id        text not null,
  location      text not null,
  units_on_hand integer not null,
  as_of         date not null,
  primary key (sku_id, location, as_of)
);

create table if not exists calendar_months (
  year_month text primary key,                         -- 2026-10
  year       integer not null,
  month      integer not null,
  is_festival boolean not null default false
);

create table if not exists rules (
  key   text primary key,
  value text
);

-- What a person typed in for a SKU the rules cannot judge yet (new, or no sales/stock data). Used only while real data is missing.
create table if not exists sku_manual (
  sku_id        text primary key,
  on_hand       integer,
  weekly_demand double precision,
  note          text,
  entered_by    text,
  updated_at    timestamptz not null default now()
);

create table if not exists data_files (
  id          serial primary key,
  kind        text not null,
  filename    text,
  rows        integer,
  skipped     integer not null default 0,
  mode        text,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  note        text
);

-- ---------- planning runs and decisions ----------
create table if not exists runs (
  run_id          text primary key,
  run_at          timestamptz not null,
  as_of           text,
  mode            text,                          -- SHADOW | LIVE
  status          text not null default 'OK',    -- OK | ABORTED | FAILED
  skus            integer,
  completeness    double precision,
  flagged         integer,
  healthy         integer,
  n_reorder       integer not null default 0,
  n_pause         integer not null default 0,
  n_manual        integer not null default 0,
  festival        boolean,
  gemini_reasons  text,
  gemini_tokens   integer not null default 0,
  summary         text,
  notes           text,
  review_due_at   timestamptz,
  triggered_by    text
);

create table if not exists recommendations (
  id            serial primary key,
  run_id        text not null references runs(run_id) on delete cascade,
  sku           text not null,
  name          text,
  perishable    boolean,
  action        text not null,                   -- REORDER | PAUSE | MANUAL_REVIEW
  rec_qty       integer,
  priority      integer,
  on_hand       integer,
  open_po       integer,
  cover_weeks   double precision,
  trend_pct     double precision,
  flags         text,
  reason        text,
  reason_source text,                            -- gemini | template
  data_notes    text,
  distributor_id   text,
  distributor_name text,
  unit          text,
  hsn           text,
  unit_cost     double precision,
  tax_pct       double precision,
  unique (run_id, sku)
);

create table if not exists decisions (
  id              serial primary key,
  decided_at      timestamptz not null,
  run_id          text not null,
  sku             text not null,
  action          text,
  rec_qty         integer,
  flags           text,
  priority        integer,
  decision        text not null,                 -- Approve | Override | Reject | EXPIRED
  final_qty       integer,
  reason          text,
  reviewer        text,
  hours_to_decide double precision,
  po_status       text not null default 'NONE',  -- NONE | READY | CREATED
  po_number       text,
  po_id           text,
  po_vendor       text,
  po_error        text,
  po_created_at   timestamptz,
  unique (run_id, sku)
);

create table if not exists rule_reviews (
  id         serial primary key,
  opened_at  timestamptz not null,
  rule       text not null,
  changed    integer,
  total      integer,
  rate       text,
  proposal   text,
  status     text not null default 'OPEN',
  unique (opened_at, rule)
);

-- ---------- purchase orders ----------
create sequence if not exists po_seq;

create table if not exists purchase_orders (
  po_number    text primary key,
  created_at   timestamptz not null default now(),
  vendor_key   text not null,
  vendor_name  text,
  vendor       jsonb,                            -- address, GSTIN, contact, email at the time of the PO
  run_ids      text,
  created_by   text,
  total_qty    integer not null default 0,
  total_amount double precision,                 -- only when every line has a rate
  lines        jsonb not null default '[]'::jsonb,
  sent_at      timestamptz,
  sent_to      text,
  received_at  timestamptz
);

-- ---------- impact tracker ----------
create table if not exists loss_entries (
  week_start         date primary key,           -- Monday of the week
  stockout_loss      bigint not null default 0,  -- rupees of sales lost to stockouts
  overstock_writeoff bigint not null default 0,  -- rupees written off for overstock
  perishable_part    bigint not null default 0,  -- of the overstock write-off, how much was perishable
  note               text,
  entered_by         text,
  entered_at         timestamptz not null default now()
);

create table if not exists settings (
  key   text primary key,
  value text
);

create index if not exists runs_run_at_idx on runs (run_at desc);
create index if not exists decisions_decided_at_idx on decisions (decided_at desc);
create index if not exists decisions_po_status_idx on decisions (po_status);
create index if not exists purchase_orders_created_idx on purchase_orders (created_at desc);
create index if not exists sales_weekly_sku_idx on sales_weekly (sku_id, week);
create index if not exists inventory_sku_idx on inventory_snapshots (sku_id, as_of desc);
