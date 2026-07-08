import type { Upload } from '../types'

export interface UploadsRepository {
  create(upload: Upload): Promise<Upload>
  findById(id: string): Promise<Upload | null>
  findByUserAndFilename(userId: string, fileName: string): Promise<Upload | null>
}
