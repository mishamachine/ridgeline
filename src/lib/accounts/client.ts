// One lazy Supabase client. Nothing here runs, and supabase-js is never downloaded, while features.accounts is off.
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountsLive } from './flags';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

let client: Promise<SupabaseClient> | null = null;

/** The client, or null when accounts are switched off. */
export function getClient(enabled: boolean = accountsLive()): Promise<SupabaseClient> | null {
  if (!enabled) return null;
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      // pkce + detectSessionInUrl completes the web redirect on /auth/callback. Sessions persist in this origin's storage.
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    }));
  return client;
}
