// Matches the frontend's exportFormats in src/data/workspace.ts.
export type ExportFormat = 'svg' | 'pdf' | 'eps' | 'dxf' | 'png'

export interface Conversion {
  id: string
  jobId: string
  userId: string
  format: ExportFormat
  /** R2 object key of the generated output file. */
  storageKey: string
  fileSizeBytes: number
  /** Populated on demand via StorageService.getSignedDownloadUrl — never stored. */
  downloadUrl: string | null
  createdAt: string
}
