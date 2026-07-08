import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Creates the Supabase client every service uses for reads/writes against
 * Postgres. See backend/supabase/schema.sql for the tables this queries.
 */
export function createSupabaseClient(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
