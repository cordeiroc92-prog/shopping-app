-- FLY — migration 002: reshape `trips` to match how the app actually uses it
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- Why: the app builds a trip as a single object with a display layer (title,
-- cities, duration, dates, cover) and a planner payload (dates, legs, packing
-- list, forecast). Splitting that across columns meant reconstructing derived
-- strings on every read, and `cities`/`duration` are only cheaply available at
-- save time. Storing the object whole removes a whole class of mapping bugs.
--
-- What's kept as real columns: the fields worth sorting or filtering on later.
-- Everything else lives in `snapshot`, which is the source of truth on read.
--
-- Dropping the unused columns is safe: no trip has ever been written to this
-- table.

alter table public.trips
  add column if not exists client_id text,                              -- the app's own id, e.g. "t-mfx8kq2"
  add column if not exists snapshot  jsonb not null default '{}'::jsonb; -- the exact object the app uses

-- These were speculative. The same data lives inside `snapshot`.
alter table public.trips drop column if exists countries;
alter table public.trips drop column if exists legs;
alter table public.trips drop column if exists suggested;
alter table public.trips drop column if exists other;
alter table public.trips drop column if exists conditions;
alter table public.trips drop column if exists cover;
alter table public.trips drop column if exists manual_split;

-- One row per app-side trip id, per user. This is what lets a re-save update
-- the existing trip instead of piling up duplicates.
create unique index if not exists trips_user_client_idx
  on public.trips(user_id, client_id);
