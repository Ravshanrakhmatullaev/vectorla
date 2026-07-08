export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface Job {
  id: string
  userId: string
  uploadId: string
  status: JobStatus
  /** Matches the frontend's WorkspacePresetId concept (logo/signature/sketch/etc.). */
  preset: string | null
  /** Matches the frontend's vector settings (colors/detail/smoothness/etc.). */
  settings: Record<string, number> | null
  errorMessage: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
