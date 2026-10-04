// SupabaseUploadsRepository.storedBytesByUser: summed by the database
// function from migration 0003; until 0003 is applied (PGRST202), paged in
// 1000-row pages, because PostgREST returns at most 1000 rows per request,
// so a single select would undercount.
//
// Run with: npx tsx src/repositories/SupabaseUploadsRepository.smoke-test.ts (from inside backend/)
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseUploadsRepository } from './SupabaseUploadsRepository'

function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

/** Just enough of the Supabase client: rpc() and from().select().eq().order().range(), capped at 1000 rows like PostgREST. */
function fakeClient(rows: number, rpc: { data?: number; error?: { code: string; message: string } }) {
  const ranges: Array<[number, number]> = []
  const client = {
    async rpc(name: string, args: { p_user_id: string }) {
      assertTrue(name === 'user_stored_bytes' && args.p_user_id === 'u1', 'calls user_stored_bytes for the user')
      return rpc.error ? { data: null, error: rpc.error } : { data: rpc.data, error: null }
    },
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        range(from: number, to: number) {
          ranges.push([from, to])
          const end = Math.min(to + 1, rows, from + 1000)
          const data = Array.from({ length: Math.max(0, end - from) }, () => ({ size_bytes: 1000 }))
          return { returns: async () => ({ data, error: null }) }
        },
      }
      return query
    },
  }
  return { client: client as unknown as SupabaseClient, ranges }
}

async function run(): Promise<void> {
  const viaRpc = fakeClient(0, { data: 1_500_000 })
  assertTrue((await new SupabaseUploadsRepository(viaRpc.client).storedBytesByUser('u1')) === 1_500_000, 'the database sum is used')
  assertTrue(viaRpc.ranges.length === 0, 'no rows are fetched when the function exists')
  console.log('PASS: storedBytesByUser uses user_stored_bytes() (migration 0003)')

  const paged = fakeClient(2500, { error: { code: 'PGRST202', message: 'function not found' } })
  assertTrue((await new SupabaseUploadsRepository(paged.client).storedBytesByUser('u1')) === 2_500_000, 'all 2500 rows are summed')
  assertTrue(paged.ranges.length === 3, `3 pages fetched (got ${paged.ranges.length})`)
  console.log('PASS: without 0003, storedBytesByUser pages past the 1000-row cap (2500 rows summed)')

  let threw = false
  await new SupabaseUploadsRepository(fakeClient(0, { error: { code: '57014', message: 'timeout' } }).client).storedBytesByUser('u1').catch(() => (threw = true))
  assertTrue(threw, 'other errors are not swallowed (the upload is refused rather than unchecked)')
  console.log('PASS: other database errors propagate')

  console.log('\nAll SupabaseUploadsRepository smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  process.exit(1)
})
