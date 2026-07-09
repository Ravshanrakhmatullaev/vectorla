// Mirrors backend/src/types/{upload,job,conversion}.ts — kept in sync by hand
// since the frontend and backend are separate deployables with no shared package.

export type UploadStatus = 'pending' | 'stored' | 'failed'

export interface Upload {
  id: string
  userId: string
  originalFileName: string
  mimeType: string
  sizeBytes: number
  status: UploadStatus
  createdAt: string
}

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed'

export interface Job {
  id: string
  userId: string
  uploadId: string
  status: JobStatus
  preset: string | null
  settings: Record<string, number> | null
  errorMessage: string | null
  retryCount: number
  version: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type ExportFormat = 'svg' | 'pdf' | 'eps' | 'dxf' | 'png'

// storageKey is never sent to the client (see backend Phase 17 security notes).
export interface Conversion {
  id: string
  jobId: string
  userId: string
  format: ExportFormat
  fileSizeBytes: number
  downloadUrl: string | null
  createdAt: string
}

// Mirrors backend/src/services/ImageAnalysisService.ts's ImageAnalysisResult (Phase 21/22).
export type ImageType = 'photo' | 'illustration' | 'logo'
export type EstimatedQuality = 'high' | 'medium' | 'low'
export type VectorizationProviderName = 'placeholder' | 'potrace' | 'vision' | 'openai'

export interface ImageAnalysisResult {
  width: number
  height: number
  aspectRatio: number
  colorCountEstimate: number
  hasAlphaChannel: boolean
  hasTransparency: boolean
  dominantColors: string[]
  edgeDensity: number
  noiseLevel: number
  isGrayscale: boolean
  imageType: ImageType
  complexityScore: number
  recommendedProvider: VectorizationProviderName
  estimatedQuality: EstimatedQuality
  estimatedCredits: number
  estimatedProcessingTimeMs: number
}

export interface UploadResult {
  upload: Upload
  job: Job
  /** Null if best-effort analysis failed for this upload — see backend/API.md. */
  analysis: ImageAnalysisResult | null
}

export type JobConversionResult =
  | { status: 'queued' | 'processing' }
  | { status: 'completed'; conversion: Conversion | null }
  | { status: 'failed'; error: string | null }
