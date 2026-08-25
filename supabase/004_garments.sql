-- FLY — migration 004: individual garments
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- Why a new table rather than reshaping wardrobe_items:
--
-- `wardrobe_items` stores archetypes with quantities — "Tank tops / camis ×3".
-- That's a packing abstraction, and it's genuinely good at its job: during trip
-- setup you want to say "I own about three tank tops" in one swipe, without
-- photographing anything. The trip flow depends on it and it stays.
--
-- But it isn't a wardrobe. Nobody thinks "I own 3 tank tops" — they think "my
-- white ribbed Aritzia tank". A wardrobe is individual things, each with its
-- own photo. Attaching several photos to one archetype row could never express
-- that: there's no way to say which photo is which garment.
--
-- So: two tables, each doing what it's good at. Archetypes for fast rough
-- setup, garments for the real wardrobe. Packing counts both.

create table if not exists public.garments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  photo      text,                 -- the point of the thing; a garment is its photo
  name       text,                 -- optional. "White ribbed tank". Blank is fine.
  kind       text,                 -- matches WARDROBE_ARCHETYPES.kind, drives packing
  category   text,                 -- tops, dresses, shoes…
  climate    text,                 -- warm | cool | any, inherited from the kind
  colour     text,                 -- hex, for the taste engine
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists garments_user_idx on public.garments(user_id, created_at desc);
create index if not exists garments_kind_idx on public.garments(user_id, kind);

alter table public.garments enable row level security;

drop policy if exists "own garments" on public.garments;
create policy "own garments" on public.garments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Same opt-in public read as the closet, written now rather than retrofitted
-- once real photos exist.
drop policy if exists "public closets show garments" on public.garments;
create policy "public closets show garments" on public.garments
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = garments.user_id and p.closet_public = true
    )
  );

drop trigger if exists touch_garments on public.garments;
create trigger touch_garments
  before update on public.garments
  for each row execute function public.touch_updated_at();
