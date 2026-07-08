import type { Queue } from '@cloudflare/workers-types'

export interface ConversionQueueMessage {
  jobId: string
}

export interface QueueClient {
  send(message: ConversionQueueMessage): Promise<void>
}

/**
 * Thin wrapper over the Cloudflare Queue binding — kept separate from
 * QueueService so the business-facing service layer never touches the raw
 * Workers binding API directly.
 */
export function createQueueClient(queue: Queue<ConversionQueueMessage>): QueueClient {
  return {
    async send(message) {
      await queue.send(message)
    },
  }
}
