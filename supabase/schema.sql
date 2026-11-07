-- Bolt Fleet Ledger: database schema for Supabase (Postgres)
-- Each signed-in account owns its own vehicles, drivers, entries and settings.
-- Row-level security makes every table private to its owner.

create table if not exists public.drivers (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  phone       text,
  licence_no  text,
  nida        text,
  deposit     numeric(14,2) not null default 0,
  start_date  date,
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  plate           text not null,
  model           text,
  year            text,
  purchase_price  numeric(14,2) not null default 0,
  purchase_date   date,
  weekly_target   numeric(14,2) not null default 350000,
  status          text not null default 'active' check (status in ('active','repair','inactive')),
  driver_id       uuid references public.drivers (id) on delete set null,
  history         jsonb not null default '[]'::jsonb,
  notes           text,
  created_at      timestamptz not null default now()
);

-- A driver can only be on one car at a time
create unique index if not exists vehicles_one_car_per_driver
  on public.vehicles (driver_id) where driver_id is not null;

create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type        text not null check (type in ('income','expense')),
  category    text not null,
  amount      numeric(14,2) not null check (amount > 0),
  date        date not null,
  vehicle_id  uuid references public.vehicles (id) on delete set null,
  driver_id   uuid references public.drivers (id) on delete set null,
  note        text,
  distance_km numeric(10,1) check (distance_km is null or distance_km >= 0), -- km since last collection, from the GPS app
  created_at  timestamptz not null default now()
);

create table if not exists public.settings (
  owner_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  loan_amount     numeric(14,2) not null default 40000000,
  rate            numeric(6,4)  not null default 0.14,
  years           integer       not null default 7 check (years between 1 and 30),
  start_month     text          not null default '2026-12' check (start_month ~ '^\d{4}-\d{2}$'),
  break_even      numeric(14,2) not null default 219000,
  default_target  numeric(14,2) not null default 350000
);

-- Indexes for owner lookups and foreign keys
create index if not exists drivers_owner_idx   on public.drivers (owner_id);
create index if not exists vehicles_owner_idx  on public.vehicles (owner_id);
create index if not exists entries_owner_idx   on public.entries (owner_id);
create index if not exists entries_date_idx    on public.entries (owner_id, date desc);
create index if not exists entries_vehicle_idx on public.entries (vehicle_id);
create index if not exists entries_driver_idx  on public.entries (driver_id);

-- Row-level security: each account sees and changes only its own rows
alter table public.drivers  enable row level security;
alter table public.vehicles enable row level security;
alter table public.entries  enable row level security;
alter table public.settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['drivers','vehicles','entries','settings'] loop
    execute format('drop policy if exists "%1$s: owner select" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner delete" on public.%1$I', t);
    execute format('create policy "%1$s: owner select" on public.%1$I for select to authenticated using (owner_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (owner_id = (select auth.uid()))', t);
  end loop;
end $$;
