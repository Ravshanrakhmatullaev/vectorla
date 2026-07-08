// Local smoke test for POST /api/jobs and GET /api/jobs/:id — calls the real
// route handler directly with a fake Env, no wrangler dev needed.
//
// Run with: npx tsx src/routes/jobs.smoke-test.ts (from inside backend/)
import { handleJobsRoute } from './jobs'
import { handleUploadsRoute } from './uploads'
import type { Env } from '../env'
import type { R2Bucket, Queue } from '@cloudflare/workers-types'
import type { ConversionQueueMessage } from '../integrations/queue'

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function toArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

function createFakeEnv(): Env {
  const store = new Map<string, ArrayBuffer>()
  const bucket: R2Bucket = {
    async put(key: string, value: ArrayBuffer) {
      store.set(key, value)
      return null
    },
    async get(key: string) {
      return store.has(key) ? ({ body: null } as never) : null
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as R2Bucket

  const queue: Queue<ConversionQueueMessage> = {
    async send() {},
    async sendBatch() {},
  } as unknown as Queue<ConversionQueueMessage>

  return {
    UPLOADS_BUCKET: bucket,
    CONVERSION_QUEUE: queue,
    SUPABASE_URL: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    ENVIRONMENT: 'development',
  }
}

function makeUploadRequest(fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return new Request('http://localhost/api/uploads', { method: 'POST', body: form })
}

async function run() {
  const env = createFakeEnv()

  // Seed an upload the same way a real client would, via the real upload route.
  const file = new File([toArrayBuffer('bytes')], 'jobs-route-test.png', { type: 'image/png' })
  const uploadRes = await handleUploadsRoute(makeUploadRequest({ file, userId: 'jobs-user' }), env)
  const { upload } = (await uploadRes.json()) as { upload: { id: string } }

  // POST /api/jobs — create another job for the same upload (e.g. re-processing)
  const createRes = await handleJobsRoute(
    new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ userId: 'jobs-user', uploadId: upload.id, preset: 'logo' }),
    }),
    env,
  )
  assertEqual(createRes.status, 201, 'status for POST /api/jobs')
  const job = (await createRes.json()) as { id: string; status: string; preset: string }
  assertEqual(job.status, 'queued', 'created job status')
  assertEqual(job.preset, 'logo', 'created job preset')
  console.log('PASS: 201 Created for POST /api/jobs')

  // 400 — missing uploadId
  const badCreateRes = await handleJobsRoute(
    new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ userId: 'jobs-user' }),
    }),
    env,
  )
  assertEqual(badCreateRes.status, 400, 'status for missing uploadId')
  console.log('PASS: 400 Bad Request when "uploadId" is missing')

  // 400 — uploadId that doesn't exist
  const missingUploadRes = await handleJobsRoute(
    new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ userId: 'jobs-user', uploadId: 'does-not-exist' }),
    }),
    env,
  )
  assertEqual(missingUploadRes.status, 400, 'status for unknown uploadId')
  console.log('PASS: 400 Bad Request for an unknown uploadId')

  // GET /api/jobs/:id
  const getRes = await handleJobsRoute(new Request(`http://localhost/api/jobs/${job.id}`, { method: 'GET' }), env)
  assertEqual(getRes.status, 200, 'status for GET /api/jobs/:id')
  const fetchedJob = (await getRes.json()) as { id: string }
  assertEqual(fetchedJob.id, job.id, 'fetched job id matches')
  console.log('PASS: 200 OK for GET /api/jobs/:id')

  // 404 — unknown job id
  const notFoundRes = await handleJobsRoute(
    new Request('http://localhost/api/jobs/does-not-exist', { method: 'GET' }),
    env,
  )
  assertEqual(notFoundRes.status, 404, 'status for unknown job id')
  console.log('PASS: 404 Not Found for an unknown job id')

  // 405 — DELETE not supported
  const wrongMethodRes = await handleJobsRoute(
    new Request(`http://localhost/api/jobs/${job.id}`, { method: 'DELETE' }),
    env,
  )
  assertEqual(wrongMethodRes.status, 405, 'status for unsupported method')
  console.log('PASS: 405 Method Not Allowed for DELETE')

  console.log('\nAll /api/jobs route smoke tests passed.')
}

run().catch((error: unknown) => {
  console.error('Smoke test failed:', error)
  throw error
})
