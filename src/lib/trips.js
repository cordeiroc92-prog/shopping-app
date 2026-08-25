import { supabase } from "./supabase.js";

/* ---------------------------------------------------
   TRIPS SYNC
   A trip is stored whole, in `snapshot`. The app's own id ("t-mfx8kq2") lives
   in `client_id`; the table's uuid `id` is never seen by the app. That mirrors
   how the closet uses `archetype_id`, and it means saving an existing trip
   updates it rather than creating a duplicate.

   Trips are text-only — no photos — so unlike the closet there's no reason to
   diff writes. A trip is saved as a whole because that's how it's edited.
--------------------------------------------------- */

function toRow(userId, snap) {
  const t = snap.trip || {};
  return {
    user_id: userId,
    client_id: snap.id,
    title: snap.title ?? "Trip",
    start_date: t.startDate || null,
    end_date: t.endDate || null,
    trip_days: t.tripDays ?? null,
    snapshot: snap,
  };
}

export async function fetchTrips(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("trips")
    .select("snapshot")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  // Guard against a row written before `snapshot` existed, or a partial write.
  return (data || []).map((r) => r.snapshot).filter((s) => s && s.id);
}

export async function upsertTrip(userId, snap) {
  if (!supabase || !userId || !snap?.id) return;
  const { error } = await supabase
    .from("trips")
    .upsert(toRow(userId, snap), { onConflict: "user_id,client_id" });
  if (error) throw error;
}

export async function deleteTrip(userId, clientId) {
  if (!supabase || !userId || !clientId) return;
  const { error } = await supabase
    .from("trips")
    .delete()
    .eq("user_id", userId)
    .eq("client_id", clientId);
  if (error) throw error;
}

// Guest hand-off, same rule as the closet: only writes into an account with no
// trips, so it can never bury real trips under whatever this browser holds.
export async function adoptLocalTrips(userId, localTrips) {
  if (!supabase || !userId) return null;
  if (!Array.isArray(localTrips) || localTrips.length === 0) return null;

  const existing = await fetchTrips(userId);
  if (existing && existing.length > 0) return existing;

  const rows = localTrips.filter((t) => t?.id).map((t) => toRow(userId, t));
  if (rows.length === 0) return null;
  const { error } = await supabase.from("trips").upsert(rows, { onConflict: "user_id,client_id" });
  if (error) throw error;
  return localTrips;
}
