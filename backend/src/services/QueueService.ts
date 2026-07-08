import type { Job } from '../types'
import type { QueueClient } from '../integrations/queue'

export class QueueService {
  constructor(private readonly queue: QueueClient) {}

  async enqueueConversionJob(job: Job): Promise<void> {
    await this.queue.send({ jobId: job.id })
  }
}
