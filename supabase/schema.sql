-- FLY — database schema and row-level security
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.
--
-- Shape note: wardrobe pieces and liked products are rows, because they're
-- created, edited and deleted one at a time (a photo upload shouldn't rewrite
-- the whole closet). A trip keeps its legs and packing list as JSONB, because
-- the app always reads and writes a trip as a whole and that mirrors the
-- current in-app shape — which keeps the migration small. If packing data ever
-- needs querying across trips, trip_items can be normalised out later.

-- ---------------------------------------------------------------
-- PROFILES — one row per account, created automatically on signup
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  closet_public boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Create the profile row automatically so the app never has to check.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- WARDROBE — the closet. One row per piece.
-- ---------------------------------------------------------------
create table if not exists public.wardrobe_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  archetype_id text not null,            -- e.g. 'w-tank', matches WARDROBE_ARCHETYPES
  label        text not null,
  kind         text,
  category     text,
  climate      text,
  qty          integer not null default 1 check (qty >= 0),
  photo        text,                     -- user's own photo (data URL now, Storage URL later)
  product      jsonb,                    -- linked product ref from productRefFrom()
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, archetype_id)         -- one row per archetype per person
);

create index if not exists wardrobe_items_user_idx on public.wardrobe_items(user_id);

-- ---------------------------------------------------------------
-- TRIPS — saved trips. Legs and packing lists stay JSONB.
-- ---------------------------------------------------------------
create table if not exists public.trips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  start_date    date,
  end_date      date,
  trip_days     integer,
  countries     jsonb not null default '[]'::jsonb,
  legs          jsonb not null default '[]'::jsonb,
  suggested     jsonb not null default '[]'::jsonb,  -- packing list incl. packed + have_qty
  other         jsonb not null default '[]'::jsonb,  -- essentials
  conditions    jsonb,                               -- stored forecast, so the Feed can re-gate
  cover         jsonb,
  manual_split  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists trips_user_idx on public.trips(user_id, updated_at desc);

-- ---------------------------------------------------------------
-- LIKED — the "To buy" list, and the taste signal behind ranking
-- ---------------------------------------------------------------
create table if not exists public.liked (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  product_id text not null,              -- catalogue or feed product id
  product    jsonb not null,             -- snapshot: title, store, price, colour, kind, sourceUrl
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists liked_user_idx on public.liked(user_id);

-- ---------------------------------------------------------------
-- TASTE PROFILE — one row per user for watchlist / price tracking
-- ---------------------------------------------------------------
create table if not exists public.taste_profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  watchlist  jsonb not null default '[]'::jsonb,
  tracked    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- Without these, the publishable key would let anyone read everything.
-- Enabling RLS with no policy denies all access, so each table needs its own.
-- ---------------------------------------------------------------
alter table public.profiles       enable row level security;
alter table public.wardrobe_items enable row level security;
alter table public.trips          enable row level security;
alter table public.liked          enable row level security;
alter table public.taste_profile  enable row level security;

-- profiles: you own your row
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- wardrobe: you own your pieces
drop policy if exists "own wardrobe" on public.wardrobe_items;
create policy "own wardrobe" on public.wardrobe_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- wardrobe: anyone may READ pieces belonging to someone whose closet is public.
-- Written now because retrofitting a read policy after data exists is where
-- accidental exposure happens. Read-only, and only when the owner opted in.
drop policy if exists "public closets are readable" on public.wardrobe_items;
create policy "public closets are readable" on public.wardrobe_items
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = wardrobe_items.user_id and p.closet_public = true
    )
  );

-- trips: yours only
drop policy if exists "own trips" on public.trips;
create policy "own trips" on public.trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- liked: yours only
drop policy if exists "own liked" on public.liked;
create policy "own liked" on public.liked
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- taste: yours only
drop policy if exists "own taste" on public.taste_profile;
create policy "own taste" on public.taste_profile
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles       on public.profiles;
drop trigger if exists touch_wardrobe_items on public.wardrobe_items;
drop trigger if exists touch_trips          on public.trips;
drop trigger if exists touch_taste_profile  on public.taste_profile;

create trigger touch_profiles       before update on public.profiles       for each row execute function public.touch_updated_at();
create trigger touch_wardrobe_items before update on public.wardrobe_items for each row execute function public.touch_updated_at();
create trigger touch_trips          before update on public.trips          for each row execute function public.touch_updated_at();
create trigger touch_taste_profile  before update on public.taste_profile  for each row execute function public.touch_updated_at();
