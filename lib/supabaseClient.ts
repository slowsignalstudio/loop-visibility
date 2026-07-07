import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser / read-side client, backed by the anon key. Use this for querying and
 * rendering traces in the viewer.
 *
 * Memoised into a single instance per browser tab. Calling createClient repeatedly
 * spins up multiple GoTrueClients sharing one storage key, which the SDK warns about
 * and which can cause undefined behaviour under concurrent use.
 */
let browserClient: SupabaseClient | null = null;

export function createBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.",
    );
  }
  browserClient = createClient(url, anonKey);
  return browserClient;
}

/**
 * Server-only client, backed by the service-role key. Use this for WRITING trace
 * rows. Never import this into client components — it bypasses RLS.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See .env.example.",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
