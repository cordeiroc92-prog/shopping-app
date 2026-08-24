import { createClient } from "@supabase/supabase-js";

/* ---------------------------------------------------
   SUPABASE CLIENT
   One client for the whole app. Imported wherever data is read or written,
   never re-created — a second client means a second auth session listener and
   subtle bugs where one half of the app thinks you're signed out.

   Both values are safe in the browser bundle. The publishable key grants
   nothing on its own; row-level security is what protects the data, and every
   table is locked to auth.uid() = user_id. The service_role key must never
   appear here or anywhere else in the frontend.
--------------------------------------------------- */

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// A preview deploy or a fresh clone without a .env would otherwise crash on
// import. Guarding here lets the app keep working in guest mode — which is a
// real supported state — and lets the UI say something honest instead of
// showing a broken sign-in form.
export const supabaseReady = Boolean(url && key);

if (!supabaseReady && typeof window !== "undefined") {
  console.warn(
    "[FLY] Supabase env vars missing — running without accounts. " +
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = supabaseReady
  ? createClient(url, key, {
      auth: {
        persistSession: true,     // stay signed in across reloads
        autoRefreshToken: true,   // refresh before expiry so long sessions don't drop
        detectSessionInUrl: true, // needed for magic links and OAuth redirects
      },
    })
  : null;
