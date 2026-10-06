import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
export function publicSupabase() {
  if (!url || !publishableKey) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  return createClient(url, publishableKey, { auth: { persistSession: false } });
}
export function staffSupabase(accessToken: string) {
  if (!url || !publishableKey) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  return createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}
export function serverSupabase() {
  if (!url || !secretKey) throw new Error("Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  return createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
