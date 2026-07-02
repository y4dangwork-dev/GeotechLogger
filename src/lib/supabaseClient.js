// Official Supabase client — used for Auth (login/session) and, going
// forward, for any request that needs RLS to see the real logged-in user.
// src/lib/supabase.js's hand-rolled fetch() calls stay for now but should be
// migrated to use this client's .from(...) so RLS/auth context applies to
// every request, not just auth calls.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = 'https://hsntuqzxqxnblomfmhod.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzbnR1cXp4cXhuYmxvbWZtaG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDI4MzMsImV4cCI6MjA5ODAxODgzM30.PaU5nU8wDNYrOVTvhnON_W1MiNNRKW7NleiyjlUMmH0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no browser URL to inspect in a native app
  },
});

// @geopacific.ca is enforced server-side (see supabase_auth_setup.sql trigger)
// — this is just a fast client-side check so users get an immediate, friendly
// error instead of waiting on a round trip that will fail anyway.
export function isAllowedEmail(email) {
  return /^[^@]+@geopacific\.ca$/i.test((email || '').trim());
}
