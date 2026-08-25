import { supabase } from "./supabase.js";

/* ---------------------------------------------------
   GARMENTS
   Individual pieces of clothing, one row each, each with its own photo. This
   is the wardrobe. `wardrobe_items` remains the archetype-and-quantity model
   the trip flow uses for fast setup — the two coexist, and packing counts both.

   A garment's id is generated client-side so a piece can be created, shown and
   removed instantly without waiting on a round trip. Guests get the same ids
   in localStorage, which makes the sign-up hand-off a straight copy.
--------------------------------------------------- */

export function newGarmentId() {
  // crypto.randomUUID isn't available on older Safari, hence the fallback.
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return "g-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function toGarment(row) {
  return {
    id: row.id,
    photo: row.photo || null,
    name: row.name || "",
    kind: row.kind || null,
    category: row.category || null,
    climate: row.climate || null,
    colour: row.colour || null,
    createdAt: row.created_at || null,
  };
}

function toRow(userId, g) {
  return {
    id: g.id,
    user_id: userId,
    photo: g.photo ?? null,
    name: g.name ?? null,
    kind: g.kind ?? null,
    category: g.category ?? null,
    climate: g.climate ?? null,
    colour: g.colour ?? null,
  };
}

export async function fetchGarments(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("garments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(toGarment);
}

// Adding a wardrobe means adding many at once — someone picks twenty photos
// from their camera roll. One insert, not twenty.
export async function addGarments(userId, garments) {
  if (!supabase || !userId || !garments?.length) return;
  const { error } = await supabase.from("garments").insert(garments.map((g) => toRow(userId, g)));
  if (error) throw error;
}

export async function updateGarment(userId, garment) {
  if (!supabase || !userId || !garment?.id) return;
  const { error } = await supabase
    .from("garments")
    .update(toRow(userId, garment))
    .eq("id", garment.id)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function deleteGarment(userId, id) {
  if (!supabase || !userId || !id) return;
  const { error } = await supabase.from("garments").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

// Guest hand-off, same rule as everything else: only writes into an empty
// wardrobe, so signing in can never bury real garments under a browser's copy.
export async function adoptLocalGarments(userId, local) {
  if (!supabase || !userId) return null;
  if (!Array.isArray(local) || local.length === 0) return null;
  const existing = await fetchGarments(userId);
  if (existing && existing.length > 0) return existing;
  await addGarments(userId, local);
  return local;
}
