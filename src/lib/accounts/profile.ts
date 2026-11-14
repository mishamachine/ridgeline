// Ridgeline creates its own profile row from app code. There is deliberately no trigger on auth.users,
// and no name is stored: the provider's name stays in Supabase Auth only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_DATA_SCHEMA } from './config';
import { accountsLive } from './flags';

/** Creates the bare profile row. Never while sign-in is paused (a re-sign-in only to delete must write nothing). */
export async function ensureProfile(c: Pick<SupabaseClient, 'schema'>, userId: string, live: boolean = accountsLive()): Promise<void> {
  if (!live) return;
  // ignoreDuplicates: an existing profile is left untouched.
  const { error } = await c.schema(APP_DATA_SCHEMA).from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw new Error('profile: ' + error.message);
}
