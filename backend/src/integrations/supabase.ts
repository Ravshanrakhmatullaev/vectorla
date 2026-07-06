import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Creates the Supabase client every service uses for reads/writes against
 * Postgres. See backend/supabase/schema.sql for the tables this will query
 * once implemented.
 */
export function createSupabaseClient(_url: string, _serviceRoleKey: string): SupabaseClient {
  throw new Error('Not implemented')
}
