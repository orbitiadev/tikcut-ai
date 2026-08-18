import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://msjnvqwtguakmoaqlhvo.supabase.co';
const fallbackPublishableKey = 'sb_publishable_fO2-R7IHb7juhewrFinkKA_uC_LShmZ';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || fallbackUrl;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || fallbackPublishableKey;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

export function isCloudSyncConfigured(): boolean {
  return Boolean(supabase);
}
