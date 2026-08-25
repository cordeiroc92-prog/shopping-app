import { supabase } from "./supabase.js";

/* ---------------------------------------------------
   LIKED + TASTE SYNC
   `liked` is a row per product, because liking and unliking are single adds
   and removes — no diffing needed, and it keeps the "To buy" list queryable.
   `taste_profile` is one row per user holding the watchlist and price-tracking
   list, which are only ever read and written whole.

   Liked matters more than it looks: scoreAgainstBoard ranks the Feed against
   it, so until this synced, someone's recommendations were only as good as the
   browser they happened to be using.
--------------------------------------------------- */

export async function fetchLiked(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("liked")
    .select("product")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => r.product).filter(Boolean);
}

export async function addLiked(userId, item) {
  if (!supabase || !userId || !item?.id) return;
  const { error } = await supabase
    .from("liked")
    .upsert(
      { user_id: userId, product_id: String(item.id), product: item },
      { onConflict: "user_id,product_id" }
    );
  if (error) throw error;
}

export async function removeLiked(userId, itemId) {
  if (!supabase || !userId || itemId == null) return;
  const { error } = await supabase
    .from("liked")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", String(itemId));
  if (error) throw error;
}

// Guest hand-off, same rule as closet and trips: only writes into an account
// with nothing liked yet.
export async function adoptLocalLiked(userId, localLiked) {
  if (!supabase || !userId) return null;
  if (!Array.isArray(localLiked) || localLiked.length === 0) return null;

  const existing = await fetchLiked(userId);
  if (existing && existing.length > 0) return existing;

  const rows = localLiked
    .filter((i) => i?.id)
    .map((i) => ({ user_id: userId, product_id: String(i.id), product: i }));
  if (rows.length === 0) return null;

  const { error } = await supabase.from("liked").upsert(rows, { onConflict: "user_id,product_id" });
  if (error) throw error;
  return localLiked;
}

export async function fetchTaste(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("taste_profile")
    .select("watchlist, tracked")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { watchlist: [], tracked: [] };
  return { watchlist: data.watchlist || [], tracked: data.tracked || [] };
}

export async function pushTaste(userId, { watchlist, tracked }) {
  if (!supabase || !userId) return;
  const { error } = await supabase
    .from("taste_profile")
    .upsert(
      { user_id: userId, watchlist: watchlist || [], tracked: tracked || [], updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) throw error;
}
