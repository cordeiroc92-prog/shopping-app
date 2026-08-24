import { supabase } from "./supabase.js";

/* ---------------------------------------------------
   CLOSET SYNC
   Translates between the app's wardrobe shape and the `wardrobe_items` table.

   In the app a piece is identified by its archetype id ("w-tank"). In the
   database that's `archetype_id`, unique per user, while `id` is a row uuid the
   app never sees. Keeping the app's shape unchanged means the rest of the code
   — closetMatchesFor, pieceColor, the packing maths — carries on working
   untouched.

   Writes are diffed rather than replaced wholesale. A piece can hold a ~59KB
   photo, so upserting the whole closet on every quantity nudge would push
   megabytes for a one-field change.
--------------------------------------------------- */

// DB row -> app piece
function toPiece(row) {
  return {
    id: row.archetype_id,
    label: row.label,
    kind: row.kind || undefined,
    category: row.category || undefined,
    climate: row.climate || undefined,
    qty: row.qty ?? 1,
    ...(row.photo ? { photo: row.photo } : {}),
    ...(row.product ? { product: row.product } : {}),
  };
}

// app piece -> DB row
function toRow(userId, w) {
  return {
    user_id: userId,
    archetype_id: w.id,
    label: w.label ?? "",
    kind: w.kind ?? null,
    category: w.category ?? null,
    climate: w.climate ?? null,
    qty: w.qty ?? 1,
    photo: w.photo ?? null,
    product: w.product ?? null,
  };
}

export async function fetchCloset(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("wardrobe_items")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  return (data || []).map(toPiece);
}

// Only sends what actually changed. Returns nothing; throws on failure so the
// caller can surface it rather than failing silently.
export async function pushClosetDiff(userId, prev, next) {
  if (!supabase || !userId) return;

  const prevById = new Map((prev || []).map((w) => [w.id, w]));
  const nextIds = new Set((next || []).map((w) => w.id));

  const changed = (next || []).filter((w) => {
    const before = prevById.get(w.id);
    if (!before) return true;
    return (
      before.qty !== w.qty ||
      before.photo !== w.photo ||
      JSON.stringify(before.product ?? null) !== JSON.stringify(w.product ?? null)
    );
  });

  const removedIds = (prev || []).filter((w) => !nextIds.has(w.id)).map((w) => w.id);

  if (changed.length > 0) {
    const { error } = await supabase
      .from("wardrobe_items")
      .upsert(changed.map((w) => toRow(userId, w)), { onConflict: "user_id,archetype_id" });
    if (error) throw error;
  }

  if (removedIds.length > 0) {
    const { error } = await supabase
      .from("wardrobe_items")
      .delete()
      .eq("user_id", userId)
      .in("archetype_id", removedIds);
    if (error) throw error;
  }
}

// Guest hand-off: someone browsed, built a closet, then created an account.
// Only runs when the cloud closet is genuinely empty, so it can never overwrite
// a real closet with whatever happens to be in this browser.
export async function adoptLocalCloset(userId, localWardrobe) {
  if (!supabase || !userId) return null;
  if (!Array.isArray(localWardrobe) || localWardrobe.length === 0) return null;

  const existing = await fetchCloset(userId);
  if (existing && existing.length > 0) return existing;

  await pushClosetDiff(userId, [], localWardrobe);
  return localWardrobe;
}

export async function fetchClosetPublic(userId) {
  if (!supabase || !userId) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("closet_public")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data?.closet_public;
}

export async function pushClosetPublic(userId, isPublic) {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .from("profiles")
    .update({ closet_public: isPublic })
    .eq("id", userId);
  if (error) throw error;
}
