import type { Conversion } from '../types'

export interface ConversionsRepository {
  create(conversion: Conversion): Promise<Conversion>
  findById(id: string): Promise<Conversion | null>
}
