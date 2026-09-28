import type { ConversionQueueMessage } from './integrations/queue'
import type { ConversionService } from './services/ConversionService'
import { isPermanentJobError } from './services/ConversionService'
import type { JobService } from './services/JobService'
import { ConflictError, JobLeaseHeldError } from './errors'
import { MAX_JOB_ATTEMPTS, STALE_PROCESSING_JOB_MS, STALE_QUEUED_JOB_MS } from './config'

/** The subset of a Workers queue Message this consumer uses (kept small so tests can fake it). */
export interface ConversionMessage {
  readonly body: ConversionQueueMessage
  readonly attempts: number
  ack(): void
  retry(options?: { delaySeconds?: number }): void
}

/** Dead-letter queues are named "<queue>-dlq" in every environment (wrangler.toml). */
export function isDeadLetterQueue(queueName: string): boolean {
  return queueName.endsWith('-dlq')
}

const RETRY_BASE_DELAY_SECONDS = 15

/**
 * Processes conversion jobs. Every job ends in exactly one terminal state
 * (completed, or failed + refunded); nothing is left 'processing':
 *
 *  - success                     -> ack
 *  - job leased by a live worker -> retry after the lease expires, then
 *                                   take it over if that worker died
 *  - lost a concurrent claim     -> ack (the winner owns the job)
 *  - permanent error, or the
 *    last allowed attempt        -> fail terminally + refund, ack
 *  - transient error             -> back to 'queued', retry with backoff
 *
 * A Worker that dies mid-job never reaches the catch block; the runtime
 * redelivers the message and the lease logic recovers the job. Messages
 * that exhaust the queue's max_retries land on the dead-letter queue, where
 * handleDeadLetters fails and refunds them.
 */
export async function handleConversionMessages(
  messages: readonly ConversionMessage[],
  conversions: ConversionService,
  jobs: JobService,
): Promise<void> {
  for (const message of messages) {
    const { jobId } = message.body
    try {
      await conversions.processJob(jobId)
      message.ack()
    } catch (error) {
      if (error instanceof JobLeaseHeldError) {
        message.retry({ delaySeconds: Math.min(error.retryAfterSeconds + 5, 900) })
        continue
      }
      if (error instanceof ConflictError) {
        console.warn(`Job ${jobId}: another delivery owns it — acking duplicate (${error.message})`)
        message.ack()
        continue
      }
      const reason = error instanceof Error ? error.message : 'Unknown error'
      if (isPermanentJobError(error) || message.attempts >= MAX_JOB_ATTEMPTS) {
        console.error(`Job ${jobId} failed terminally after ${message.attempts} attempt(s): ${reason}`)
        await conversions.failJob(jobId, reason).catch((failError: unknown) => {
          console.error(`Failed to fail job ${jobId}:`, failError)
        })
        message.ack()
        continue
      }
      console.warn(`Job ${jobId} attempt ${message.attempts} failed, will retry: ${reason}`)
      await jobs.releaseAfterError(jobId, reason).catch((releaseError: unknown) => {
        console.error(`Failed to release job ${jobId} after error:`, releaseError)
      })
      message.retry({ delaySeconds: RETRY_BASE_DELAY_SECONDS * 2 ** (message.attempts - 1) })
    }
  }
}

/** Dead-letter queue: jobs whose messages exhausted every retry are failed and refunded. */
export async function handleDeadLetters(messages: readonly ConversionMessage[], conversions: ConversionService): Promise<void> {
  for (const message of messages) {
    await conversions
      .failJob(message.body.jobId, 'Processing did not complete after repeated attempts')
      .catch((error: unknown) => console.error(`Failed to fail dead-lettered job ${message.body.jobId}:`, error))
    message.ack()
  }
}

/**
 * Scheduled backstop for lost messages: jobs stuck 'processing' or
 * 'queued' far longer than any real run are failed and refunded, so users
 * never poll forever and never pay for work that didn't happen.
 */
export async function sweepStaleJobs(conversions: ConversionService, jobs: JobService, now: number = Date.now()): Promise<number> {
  let swept = 0
  for (const [status, olderThan] of [
    ['processing', STALE_PROCESSING_JOB_MS],
    ['queued', STALE_QUEUED_JOB_MS],
  ] as const) {
    for (const job of await jobs.findStaleJobs(status, olderThan, 50, now)) {
      try {
        await conversions.failJob(job.id, `Job was stuck in "${status}" and timed out`)
        swept++
      } catch (error) {
        console.error(`Failed to sweep stale job ${job.id}:`, error)
      }
    }
  }
  return swept
}
