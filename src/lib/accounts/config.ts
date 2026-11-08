// Public identifiers only. The URL and the publishable key are meant to ship in client code (RLS protects the data).
// Apple and Google private keys live in the Supabase dashboard and Edge Function secrets, never here.
export const SUPABASE_URL = 'https://ywcrzkvwamjchjjkfrve.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_Mqep-YSoDCfQ0eLYez5ZDw_VaZpDL0M';
export const APP_DATA_SCHEMA = 'ridgeline';
export const CALLBACK_PATH = 'auth/callback';

// Client IDs for the native Google sheet. Not secret; set at build time once the IDs exist (VITE_GOOGLE_IOS_CLIENT_ID, VITE_GOOGLE_WEB_CLIENT_ID).
export const GOOGLE_IOS_CLIENT_ID = (import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID as string | undefined) ?? '';
export const GOOGLE_WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string | undefined) ?? '';
