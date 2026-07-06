import type { Job } from '../types'
import type { QueueClient } from '../integrations/queue'

// TODO(backend): wire to the CONVERSION_QUEUE binding once ConversionService can process jobs.
export class QueueService {
  constructor(private readonly queue: QueueClient) {}

  async enqueueConversionJob(_job: Job): Promise<void> {
    throw new Error('Not implemented')
  }
}
