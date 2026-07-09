import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadImage } from '@/lib/api/uploads'
import { getJobConversion } from '@/lib/api/jobs'
import { ApiError } from '@/lib/api/client'
import type { Conversion, ImageAnalysisResult } from '@/lib/api/types'

const POLL_INTERVAL_MS = 1000

/** Which of the task's four required error states a failure maps to. */
export type UploadFailureKind = 'auth' | 'insufficient-credits' | 'generic'

export type UploadFlowState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'queued' | 'processing'; jobId: string }
  | { status: 'completed'; jobId: string; conversion: Conversion | null }
  | { status: 'failed'; stage: 'upload' | 'processing'; kind: UploadFailureKind; message: string }

/** Real upload → job → poll flow against the backend API (see backend/API.md). Replaces the old fake "showDemo" toggle. */
export function useUploadFlow() {
  const [state, setState] = useState<UploadFlowState>({ status: 'idle' })
  // Available as soon as the upload responds, independent of job status (see
  // WorkspacePreview.tsx's analysis card) — not part of UploadFlowState since
  // it doesn't change across queued/processing/completed for the same upload.
  const [analysis, setAnalysis] = useState<ImageAnalysisResult | null>(null)
  const lastFileRef = useRef<File | null>(null)
  const pollJobIdRef = useRef<string | null>(null)

  const upload = useCallback(async (file: File) => {
    lastFileRef.current = file
    setState({ status: 'uploading' })
    setAnalysis(null)
    try {
      const { job, analysis: uploadAnalysis } = await uploadImage(file)
      setAnalysis(uploadAnalysis)
      if (job.status === 'failed') {
        setState({ status: 'failed', stage: 'processing', kind: classifyFailureMessage(job.errorMessage), message: job.errorMessage ?? 'Conversion failed' })
      } else if (job.status === 'completed') {
        setState({ status: 'completed', jobId: job.id, conversion: null })
      } else {
        setState({ status: job.status, jobId: job.id })
      }
    } catch (error) {
      setState({ status: 'failed', stage: 'upload', kind: classifyError(error), message: describeError(error) })
    }
  }, [])

  const retry = useCallback(() => {
    const file = lastFileRef.current
    if (file) void upload(file)
  }, [upload])

  const reset = useCallback(() => {
    lastFileRef.current = null
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

  return { state, analysis, upload, retry, reset }
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
