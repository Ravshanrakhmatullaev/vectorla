import type { Conversion } from '../types'

export interface ConversionsRepository {
  create(conversion: Conversion): Promise<Conversion>
  findById(id: string): Promise<Conversion | null>
  /** Today's pipeline (see ConversionService.processJob) produces exactly one Conversion per Job. */
  findByJobId(jobId: string): Promise<Conversion | null>
  findByUserId(userId: string): Promise<Conversion[]>
}
