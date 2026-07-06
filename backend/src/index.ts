import type { ExportedHandler, MessageBatch } from '@cloudflare/workers-types'
import type { Env } from './env'
import type { ConversionQueueMessage } from './integrations/queue'
import { handleHealthRoute } from './routes/health'
import { handleUploadsRoute } from './routes/uploads'
import { handleJobsRoute } from './routes/jobs'
import { handleConversionsRoute } from './routes/conversions'
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
      if (url.pathname.startsWith('/api/credits')) return await handleCreditsRoute(request, env)
      if (url.pathname.startsWith('/api/history')) return await handleHistoryRoute(request, env)
      return new Response('Not Found', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal Server Error'
      return new Response(message, { status: NOT_IMPLEMENTED_STATUS })
    }
  },

  async queue(_batch: MessageBatch<ConversionQueueMessage>, _env: Env): Promise<void> {
    throw new Error('Not implemented')
  },
} satisfies ExportedHandler<Env, ConversionQueueMessage>
