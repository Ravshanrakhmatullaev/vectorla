export type UploadStatus = 'pending' | 'stored' | 'failed'

export interface Upload {
  id: string
  userId: string
  originalFileName: string
  mimeType: string
  sizeBytes: number
  /** R2 object key — see StorageService for the naming convention. */
  storageKey: string
  status: UploadStatus
  createdAt: string
}
