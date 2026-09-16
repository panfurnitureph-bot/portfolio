/* DEMO SHIM — cookie-bound auth client is not needed; return the fake client. */
import { createFakeSupabase } from '../../../db/fake-supabase'
export async function createAuthClient() { return createFakeSupabase() as unknown as import('@supabase/supabase-js').SupabaseClient }
