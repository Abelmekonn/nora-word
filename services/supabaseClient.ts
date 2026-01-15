import { createClient } from '@supabase/supabase-js';

// Use Vite environment variables (prefixed with VITE_)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Assistant decision: expose a configuration flag and avoid hard-throw to enable graceful fallbacks elsewhere.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
if (!isSupabaseConfigured) {
  console.warn("Supabase credentials missing! Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local. Falling back to local behaviors where possible.");
}

// Note: Verify the anon key format in Supabase Dashboard > Settings > API
// Standard keys usually start with 'eyJ...' (JWT format)
// If authentication fails, check your Supabase Project Settings > API > Anon/Public key
if (isSupabaseConfigured && !supabaseAnonKey.startsWith('eyJ') && !supabaseAnonKey.startsWith('sb_')) {
  console.warn(
    "⚠️ Unusual Supabase anon key format detected. Expected JWT starting with 'eyJ' or 'sb_'. " +
    "Authentication may fail. Please verify your key in Supabase Dashboard."
  );
}

// Export a client when configured; otherwise export null (typed as any for compatibility at callsites).
// Auth config ensures: session persists across refreshes, tokens auto-refresh, OAuth redirects work.
export const supabase: any = isSupabaseConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
      }
    }) 
  : null; 