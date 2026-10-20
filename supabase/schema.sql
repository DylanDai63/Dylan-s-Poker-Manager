-- Poker Helper · bankroll schema v4 (2026-10-20)
--
-- Run the whole file once in Supabase → SQL Editor. It DROPS the v1 "sessions"
-- table (old records are cleared on purpose) and creates the v4 tables.
-- Privacy model is unchanged from v1: no login, RLS off, the publishable key
-- in js/config.js can read and write. Keep the project URL private.

-- ───────── v1 cleanup ─────────
drop table if exists public.sessions;

-- ───────── venues (game types) ─────────
-- kind: 'live' → amounts entered in USD; 'online' → entered in big blinds and
-- converted with the chosen stakes.
create table public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        text not null check (kind in ('live', 'online')),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.venues disable row level security;

-- ───────── stakes (online levels) ─────────
-- bb_usd: what one big blind is worth in USD. z2 and NL2 are both 0.01/0.02.
create table public.stakes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  bb_usd      numeric(10, 4) not null check (bb_usd > 0),
  label       text,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.stakes disable row level security;

-- ───────── sessions ─────────
-- buy_in / cash_out are ALWAYS USD (the app converts bb → USD on save).
-- buy_in_bb / cash_out_bb / hands / stakes_id are only set for online venues.
create table public.sessions (
  id                        uuid primary key default gen_random_uuid(),
  venue_id                  uuid not null references public.venues (id),
  stakes_id                 uuid references public.stakes (id),
  started_at                timestamptz not null,
  ended_at                  timestamptz not null,
  buy_in                    numeric(12, 2) not null check (buy_in >= 0),
  cash_out                  numeric(12, 2) not null check (cash_out >= 0),
  buy_in_bb                 numeric(12, 2),
  cash_out_bb               numeric(12, 2),
  hands                     int check (hands >= 0),
  planned_duration_minutes  int,
  break_minutes             int not null default 0 check (break_minutes >= 0),
  notes                     text,
  created_at                timestamptz not null default now(),
  check (ended_at > started_at)
);
create index sessions_started_at_idx on public.sessions (started_at);
alter table public.sessions disable row level security;

-- ───────── keep-alive ─────────
-- Supabase pauses Free projects after ~7 days without database activity.
-- A daily Windows scheduled task (scripts/keepalive.ps1) POSTs
-- /rest/v1/rpc/keepalive; the row it writes is what the app shows as "上次保活".
create table public.keepalive_log (
  id         bigserial primary key,
  pinged_at  timestamptz not null default now(),
  source     text
);
alter table public.keepalive_log disable row level security;

create or replace function public.keepalive(src text default 'cron')
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.keepalive_log (source) values (coalesce(src, 'cron'));
  delete from public.keepalive_log where pinged_at < now() - interval '90 days';
  select now();
$$;

-- ───────── seed ─────────
insert into public.venues (name, kind, sort_order) values
  ('Wind Creek',   'live',   1),
  ('Home game',    'live',   2),
  ('Online poker', 'online', 3);

insert into public.stakes (code, bb_usd, label, sort_order) values
  ('z2',  0.02, '0.01/0.02 急速桌', 1),
  ('NL2', 0.02, '0.01/0.02 常规桌', 2);

-- PostgREST picks up new tables/functions by itself; this just hurries it.
notify pgrst, 'reload schema';
