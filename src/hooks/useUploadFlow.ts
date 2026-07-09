import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadImage } from '@/lib/api/uploads'
import { createJob, getJob, getJobConversion } from '@/lib/api/jobs'
import { ApiError } from '@/lib/api/client'
import type { Conversion, ImageAnalysisResult, Job } from '@/lib/api/types'

const POLL_INTERVAL_MS = 1000

/** Which of the task's four required error states a failure maps to. */
export type UploadFailureKind = 'auth' | 'insufficient-credits' | 'generic'

export type UploadFlowState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'queued' | 'processing'; jobId: string }
  | { status: 'completed'; jobId: string; conversion: Conversion | null }
  | { status: 'failed'; stage: 'upload' | 'processing'; kind: UploadFailureKind; message: string }

export type TraceMode = 'quick' | 'professional'

/** Mirrors backend/src/pipeline/ProfessionalTracePipeline.ts's PROFESSIONAL_TRACE_JOB_PRESET. */
export const PROFESSIONAL_TRACE_PRESET = 'professional'

/** Real upload → job → poll flow against the backend API (see backend/API.md). Replaces the old fake "showDemo" toggle. */
export function useUploadFlow() {
  const [state, setState] = useState<UploadFlowState>({ status: 'idle' })
  // Available as soon as the upload responds, independent of job status (see
  // WorkspacePreview.tsx's analysis card) — not part of UploadFlowState since
  // it doesn't change across queued/processing/completed for the same upload.
  const [analysis, setAnalysis] = useState<ImageAnalysisResult | null>(null)
  const [traceMode, setTraceMode] = useState<TraceMode>('quick')
  const lastFileRef = useRef<File | null>(null)
  const pollJobIdRef = useRef<string | null>(null)
  // Quick Trace's job is always the one uploadImage auto-creates (see
  // backend/README.md's Job Queue section) — never re-created here.
  // Professional Trace's job is created on demand, the first time it's
  // selected, and reused after that (see selectTraceMode).
  const uploadIdRef = useRef<string | null>(null)
  const jobIdsRef = useRef<{ quick: string | null; professional: string | null }>({ quick: null, professional: null })

  const applyJob = useCallback((job: Job) => {
    if (job.status === 'failed') {
      setState({ status: 'failed', stage: 'processing', kind: classifyFailureMessage(job.errorMessage), message: job.errorMessage ?? 'Conversion failed' })
    } else if (job.status === 'completed') {
      setState({ status: 'completed', jobId: job.id, conversion: null })
    } else {
      setState({ status: job.status, jobId: job.id })
    }
  }, [])

  const upload = useCallback(async (file: File) => {
    lastFileRef.current = file
    uploadIdRef.current = null
    jobIdsRef.current = { quick: null, professional: null }
    setTraceMode('quick')
    setState({ status: 'uploading' })
    setAnalysis(null)
    try {
      const { upload: storedUpload, job, analysis: uploadAnalysis } = await uploadImage(file)
      uploadIdRef.current = storedUpload.id
      jobIdsRef.current.quick = job.id
      setAnalysis(uploadAnalysis)
      applyJob(job)
    } catch (error) {
      setState({ status: 'failed', stage: 'upload', kind: classifyError(error), message: describeError(error) })
    }
  }, [applyJob])

  /**
   * Switches the active trace mode. Quick Trace's job already exists (it's
   * the one uploadImage auto-created), so this only ever re-syncs state to
   * it. Professional Trace's job is created — with preset:
   * PROFESSIONAL_TRACE_PRESET, billing the backend's Professional Trace
   * credit rate — the first time it's selected for this upload, then just
   * re-synced on subsequent selections (no duplicate job/charge).
   *
   * No-ops while the current job is still uploading/queued/processing: the
   * backend's active-job dedup (JobService.createJob) would just hand back
   * that same in-flight job regardless of which mode we asked for, which
   * would otherwise get mis-cached here as if it belonged to the new mode.
   * Switching only makes sense once the current job is completed or failed.
   *
   * If the mode being switched away from already completed (and so was
   * billed), its job id is passed as supersedesJobId so the backend refunds
   * that charge before billing the new job — switching modes is never
   * additive on top of a prior charge (see backend/API.md's POST /jobs).
   */
  const selectTraceMode = useCallback(
    async (mode: TraceMode) => {
      const uploadId = uploadIdRef.current
      if (!uploadId) return
      if (state.status === 'uploading' || state.status === 'queued' || state.status === 'processing') return
      setTraceMode(mode)
      try {
        const existingJobId = jobIdsRef.current[mode]
        if (existingJobId) {
          applyJob(await getJob(existingJobId))
          return
        }
        const supersedesJobId = state.status === 'completed' ? state.jobId : undefined
        const job = await createJob(uploadId, mode === 'professional' ? PROFESSIONAL_TRACE_PRESET : undefined, supersedesJobId)
        jobIdsRef.current[mode] = job.id
        applyJob(job)
      } catch (error) {
        setState({ status: 'failed', stage: 'processing', kind: classifyError(error), message: describeError(error) })
      }
    },
    [applyJob, state],
  )

  const retry = useCallback(() => {
    const file = lastFileRef.current
    if (file) void upload(file)
  }, [upload])

  const reset = useCallback(() => {
    lastFileRef.current = null
    uploadIdRef.current = null
    jobIdsRef.current = { quick: null, professional: null }
    setTraceMode('quick')
    setState({ status: 'idle' })
    setAnalysis(null)
  }, [])

  useEffect(() => {
    if (state.status !== 'queued' && state.status !== 'processing') {
      pollJobIdRef.current = null
      return
    }
    const jobId = state.jobId
    pollJobIdRef.current = jobId

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const result = await getJobConversion(jobId)
          if (pollJobIdRef.current !== jobId) return // a newer upload superseded this poll

          if (result.status === 'completed') {
            setState({ status: 'completed', jobId, conversion: result.conversion })
          } else if (result.status === 'failed') {
            setState({ status: 'failed', stage: 'processing', kind: classifyFailureMessage(result.error), message: result.error ?? 'Conversion failed' })
          } else {
            setState({ status: result.status, jobId })
          }
        } catch (error) {
          if (pollJobIdRef.current !== jobId) return
          setState({ status: 'failed', stage: 'processing', kind: classifyError(error), message: describeError(error) })
        }
      })()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [state])

  return { state, analysis, traceMode, upload, retry, reset, selectTraceMode }
}

function classifyError(error: unknown): UploadFailureKind {
  if (error instanceof ApiError) {
    if (error.code === 'UNAUTHORIZED') return 'auth'
    if (error.code === 'INSUFFICIENT_CREDITS') return 'insufficient-credits'
  }
  return 'generic'
}

// A job that fails during processing (e.g. insufficient credits, see
// CreditsService.ensureEnoughCredits) surfaces as a plain error string on
// Job.errorMessage, not a structured ApiErrorCode — string-matching is the
// only signal available here.
function classifyFailureMessage(message: string | null | undefined): UploadFailureKind {
  return message && /credit/i.test(message) ? 'insufficient-credits' : 'generic'
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Something went wrong. Please try again.'
}
