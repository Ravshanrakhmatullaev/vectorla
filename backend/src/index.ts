import type { ExportedHandler, MessageBatch } from '@cloudflare/workers-types'
import type { Env } from './env'
import type { ConversionQueueMessage } from './integrations/queue'
import { createJobService } from './services/JobService'
import { createConversionService } from './services/ConversionService'
import { handleHealthRoute } from './routes/health'
import { handleUploadsRoute } from './routes/uploads'
import { handleJobsRoute } from './routes/jobs'
import { handleConversionsRoute } from './routes/conversions'
import { handleDownloadRoute } from './routes/download'
import { handleCreditsRoute } from './routes/credits'
import { handleHistoryRoute } from './routes/history'

const NOT_IMPLEMENTED_STATUS = 501

// The dispatch below is real, working infrastructure — every route handler it
// calls throws "Not implemented" (see routes/*.ts), which this catch block
// turns into a coherent 501 response. That's the only "real" behavior this
// Worker has today.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    try {
      if (url.pathname === '/api/health') return await handleHealthRoute(request, env)
      if (url.pathname.startsWith('/api/uploads')) return await handleUploadsRoute(request, env)
      if (url.pathname.startsWith('/api/jobs')) return await handleJobsRoute(request, env)
      if (url.pathname.startsWith('/api/conversions')) return await handleConversionsRoute(request, env)
      if (url.pathname === '/api/download') return await handleDownloadRoute(request, env)
      if (url.pathname.startsWith('/api/credits')) return await handleCreditsRoute(request, env)
      if (url.pathname.startsWith('/api/history')) return await handleHistoryRoute(request, env)
      return new Response('Not Found', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal Server Error'
      return new Response(message, { status: NOT_IMPLEMENTED_STATUS })
    }
  },

  // TODO(backend): real AI vectorization goes inside ConversionService.processJob
  // — for now it produces a placeholder SVG, so the full pipeline (queued ->
  // processing -> stored -> completed) can be exercised end-to-end.
  async queue(batch: MessageBatch<ConversionQueueMessage>, env: Env): Promise<void> {
    const jobService = createJobService(env)
    const conversionService = createConversionService(env)

    for (const message of batch.messages) {
      try {
        await conversionService.processJob(message.body.jobId)
        message.ack()
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown error'
        await jobService.markFailed(message.body.jobId, reason).catch((markFailedError: unknown) => {
          console.error(`Failed to mark job ${message.body.jobId} as failed:`, markFailedError)
        })
        message.retry()
      }
    }
  },
} satisfies ExportedHandler<Env, ConversionQueueMessage>
