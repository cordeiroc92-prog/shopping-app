-- FLY — migration 003: a closet piece can hold several photos
-- Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
--
-- Why: a piece is an archetype with a quantity — "Tank tops / camis, ×3" is one
-- row representing three real garments. A single `photo` column meant you could
-- only ever picture one of them.

alter table public.wardrobe_items
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- Carry any existing single photo across so nothing already uploaded is lost.
update public.wardrobe_items
   set photos = jsonb_build_array(photo)
 where photo is not null
   and photo <> ''
   and (photos is null or jsonb_array_length(photos) = 0);

-- `photo` is left in place rather than dropped: it costs nothing, and if
-- anything about the migration went wrong the original value is still there.
-- Drop it once you've confirmed closets look right:
--   alter table public.wardrobe_items drop column photo;
