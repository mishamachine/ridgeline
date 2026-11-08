// Ridgeline creates its own profile row from app code. There is deliberately no trigger on auth.users,
// and no name is stored: the provider's name stays in Supabase Auth only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_DATA_SCHEMA } from './config';

export async function ensureProfile(c: Pick<SupabaseClient, 'schema'>, userId: string): Promise<void> {
  // ignoreDuplicates: an existing profile is left untouched.
  const { error } = await c.schema(APP_DATA_SCHEMA).from('profiles').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
  if (error) throw new Error('profile: ' + error.message);
}
