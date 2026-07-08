import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadImage } from '@/lib/api/uploads'
import { getJobConversion } from '@/lib/api/jobs'
import { ApiError } from '@/lib/api/client'
import type { Conversion } from '@/lib/api/types'

const POLL_INTERVAL_MS = 1000

export type UploadFlowState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'queued' | 'processing'; jobId: string }
  | { status: 'completed'; jobId: string; conversion: Conversion | null }
  | { status: 'failed'; message: string }

/** Real upload → job → poll flow against the backend API (see backend/API.md). Replaces the old fake "showDemo" toggle. */
export function useUploadFlow() {
  const [state, setState] = useState<UploadFlowState>({ status: 'idle' })
  const lastFileRef = useRef<File | null>(null)
  const pollJobIdRef = useRef<string | null>(null)

  const upload = useCallback(async (file: File) => {
    lastFileRef.current = file
    setState({ status: 'uploading' })
    try {
      const { job } = await uploadImage(file)
      if (job.status === 'completed' || job.status === 'failed') {
        setState({ status: job.status === 'failed' ? 'failed' : 'completed', jobId: job.id, conversion: null } as UploadFlowState)
      } else {
        setState({ status: job.status, jobId: job.id })
      }
    } catch (error) {
      setState({ status: 'failed', message: describeError(error) })
    }
  }, [])

  const retry = useCallback(() => {
    const file = lastFileRef.current
    if (file) void upload(file)
  }, [upload])

  const reset = useCallback(() => {
    lastFileRef.current = null
    setState({ status: 'idle' })
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
            setState({ status: 'failed', message: result.error ?? 'Conversion failed' })
          } else {
            setState({ status: result.status, jobId })
          }
        } catch (error) {
          if (pollJobIdRef.current !== jobId) return
          setState({ status: 'failed', message: describeError(error) })
        }
      })()
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [state])

  return { state, upload, retry, reset }
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Something went wrong. Please try again.'
}
