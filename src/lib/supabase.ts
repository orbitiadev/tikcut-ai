import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://msjnvqwtguakmoaqlhvo.supabase.co';
const fallbackPublicKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zam52cXd0Z3Vha21vYXFsaHZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1MTgxOTMsImV4cCI6MjEwMjA5NDE5M30.03TNx30VTfuYmaq9a8jwinDt4nClDuJg1SDyxOU2sSQ';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || fallbackUrl;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || fallbackPublicKey;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

export function isCloudSyncConfigured(): boolean {
  return Boolean(supabase);
}
