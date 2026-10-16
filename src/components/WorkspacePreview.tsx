import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  UploadCloud,
  CheckCircle2,
  Eye,
  Info,
  RefreshCcw,
  Loader2,
  AlertTriangle,
  Lock,
  Coins,
  Download,
  Sparkles,
  Image as ImageIcon,
  Camera,
  Palette,
  ArrowRight,
} from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Button } from '@/components/ui/Button'
import { BeforeAfterArt } from '@/components/BeforeAfterArt'
import { ResultViewer } from '@/components/ResultViewer'
import { TraceModeSelector, type TraceModeContext } from '@/components/TraceModeSelector'
import { Link } from '@/components/ui/Link'
import { useLanguage } from '@/lib/language'
import { useCredits } from '@/lib/useCredits'
import { requestAuthDialog } from '@/lib/authDialogEvents'
import { formatCredits } from '@/utils/formatCredits'
import { useCompareSlider } from '@/hooks/useCompareSlider'
import { useDropzone } from '@/hooks/useDropzone'
import { TRACE_MODE_CREDITS, useUploadFlow, type TraceMode, type UploadFailureKind } from '@/hooks/useUploadFlow'
import type { Translation } from '@/data/i18n'
import { TRACE_SAMPLES, type TraceSampleId } from '@/data/traceSamples'
import { isBackendConfigured } from '@/lib/api/client'
import { fetchConversionFile } from '@/lib/api/conversions'
import { cn } from '@/utils/cn'

const backendConfigured = isBackendConfigured()

const IMAGE_TYPE_ICONS = { photo: Camera, illustration: Palette, logo: ImageIcon } as const

function formatEstimatedTime(ms: number): string {
  return ms < 1000 ? `~${ms}ms` : `~${(ms / 1000).toFixed(1)}s`
}

/** A fetched result: the SVG as an object URL (for <img> and download) and as text (for the outline). */
interface FetchedResult {
  conversionId: string
  url: string
  text: string
}

/**
 * When the backend isn't configured, this stays Preview Mode only (no image
 * is uploaded, read, or processed) — see PROJECT_CONTEXT.md's honesty
 * requirement. When it is configured, uploads go through the real API v1
 * flow: upload → job → poll every second → completed/failed (see
 * src/hooks/useUploadFlow.ts). Real results, and the pre-traced samples,
 * open in ResultViewer.
 */
export function WorkspacePreview() {
  const [showDemo, setShowDemo] = useState(false)
  const { splitPct, containerHandlers, onHandleKeyDown } = useCompareSlider(55)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t, language } = useLanguage()
  const credits = useCredits()
  const { refresh: refreshCredits } = credits
  const { state: uploadState, analysis, traceMode: selectedMode, upload, retry, reset, selectTraceMode } = useUploadFlow()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<FetchedResult | null>(null)
  const [resultFetchError, setResultFetchError] = useState<string | null>(null)
  const fetchedConversionIdRef = useRef<string | null>(null)
  const [sampleId, setSampleId] = useState<TraceSampleId | null>(null)
  const [sampleTexts, setSampleTexts] = useState<Record<string, string>>({})
  const [sampleErrorUrl, setSampleErrorUrl] = useState<string | null>(null)
  const [sampleAttempt, setSampleAttempt] = useState(0)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const resultUrl = result?.url ?? null
  useEffect(() => {
    return () => {
      if (resultUrl) URL.revokeObjectURL(resultUrl)
    }
  }, [resultUrl])

  const fetchResult = useCallback(async (conversionId: string, downloadUrl: string) => {
    setResultFetchError(null)
    try {
      const blob = await fetchConversionFile(downloadUrl)
      const text = await blob.text()
      // A slow download for an earlier conversion must not replace a newer result.
      if (fetchedConversionIdRef.current !== conversionId) return
      setResult({ conversionId, url: URL.createObjectURL(blob), text })
    } catch (error) {
      setResultFetchError(error instanceof Error ? error.message : 'Could not load the result. Please try again.')
    }
  }, [])

  // Fetches the actual SVG bytes exactly once per completed conversion — a
  // plain <img src={downloadUrl}> can't work here, since GET /download
  // requires the same auth header as every other route (see
  // lib/api/conversions.ts's fetchConversionFile).
  useEffect(() => {
    if (uploadState.status !== 'completed' || !uploadState.conversion) return
    const conversion = uploadState.conversion
    if (fetchedConversionIdRef.current === conversion.id) return
    fetchedConversionIdRef.current = conversion.id
    if (conversion.downloadUrl) void fetchResult(conversion.id, conversion.downloadUrl)
  }, [uploadState, fetchResult])

  // A finished or failed job changes the balance (a charge, or a refund).
  useEffect(() => {
    if (uploadState.status === 'completed' || uploadState.status === 'failed') refreshCredits()
  }, [uploadState.status, refreshCredits])

  // Samples are static files: the SVG text is fetched once per file (the
  // viewer's outline reads it) and kept for switching back and forth.
  // sampleAttempt re-runs the fetch when a failed sample is opened again.
  const sample = sampleId ? (TRACE_SAMPLES.find((entry) => entry.id === sampleId) ?? null) : null
  const sampleUrl = sample ? (selectedMode === 'professional' ? sample.professional : sample.quick) : null
  const sampleText = sampleUrl ? sampleTexts[sampleUrl] : undefined
  useEffect(() => {
    if (!sampleUrl || sampleTexts[sampleUrl] !== undefined) return
    let cancelled = false
    fetch(sampleUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.text()
      })
      .then((text) => setSampleTexts((previous) => ({ ...previous, [sampleUrl]: text })))
      .catch(() => {
        if (!cancelled) setSampleErrorUrl(sampleUrl)
      })
    return () => {
      cancelled = true
    }
  }, [sampleUrl, sampleTexts, sampleAttempt])

  function clearResult() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setResult(null)
    setResultFetchError(null)
    fetchedConversionIdRef.current = null
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setSampleId(null)

    if (!backendConfigured) {
      setShowDemo(true)
      return
    }

    clearResult()
    setPreviewUrl(URL.createObjectURL(file))
    void upload(file)
  }

  function handleNewImage() {
    setShowDemo(false)
    setSampleId(null)
    reset()
    clearResult()
  }

  function openSample(id: TraceSampleId) {
    setSampleErrorUrl(null)
    setSampleAttempt((attempt) => attempt + 1)
    setSampleId(id)
  }

  function closeSampleAndBrowse() {
    setSampleId(null)
    fileInputRef.current?.click()
  }

  function triggerDownload() {
    if (!result || !completedFormat) return
    const anchor = document.createElement('a')
    anchor.href = result.url
    anchor.download = `vectorla-export.${completedFormat.toLowerCase()}`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const { isDragOver, dropzoneHandlers } = useDropzone(handleFiles)
  const isWorking = backendConfigured && (uploadState.status === 'uploading' || uploadState.status === 'queued' || uploadState.status === 'processing')
  const isCompleted = backendConfigured && uploadState.status === 'completed'
  const isFailed = backendConfigured && uploadState.status === 'failed'
  const isActive = backendConfigured ? isWorking || isCompleted || isFailed : showDemo
  const sampleOpen = !isActive && sample !== null
  const completedConversion = uploadState.status === 'completed' ? uploadState.conversion : null
  // Only the result of the conversion on screen: right after a mode switch
  // completes, the previous mode's SVG is still loaded until the new one arrives.
  const currentResult = isCompleted && result && completedConversion && result.conversionId === completedConversion.id ? result : null
  const completedFormat = currentResult && completedConversion ? completedConversion.format.toUpperCase() : null
  const failureTitle =
    uploadState.status === 'failed'
      ? uploadState.kind === 'auth'
        ? t.workspace.authRequiredTitle
        : uploadState.kind === 'insufficient-credits'
          ? t.workspace.insufficientCreditsTitle
          : uploadState.kind === 'rate-limited'
            ? t.workspace.rateLimitedTitle
            : uploadState.kind === 'quota'
              ? t.workspace.quotaTitle
              : uploadState.stage === 'upload'
                ? t.workspace.uploadFailedTitle
                : t.workspace.statusFailedTitle
      : ''
  // Translated per failure kind: the server's error text can be internal and is English-only.
  const failureMessage = uploadState.status === 'failed' ? failureMessageFor(uploadState.kind, uploadState.stage, t.workspace.failureMessages) : ''
  const FailureIcon = uploadState.status === 'failed' && uploadState.kind === 'auth' ? Lock : uploadState.status === 'failed' && uploadState.kind === 'insufficient-credits' ? Coins : AlertTriangle
  const isAiRecommended = analysis ? analysis.recommendedProvider === 'vision' || analysis.recommendedProvider === 'openai' : false
  const ImageTypeIcon = analysis ? IMAGE_TYPE_ICONS[analysis.imageType] : ImageIcon
  const modeTitles: Record<TraceMode, string> = {
    quick: t.workspace.analysis.quickTraceTitle,
    professional: t.workspace.analysis.professionalTraceTitle,
  }

  const modeContext: TraceModeContext = sampleOpen
    ? 'sample'
    : isWorking
      ? 'busy'
      : isCompleted
        ? 'retrace'
        : uploadState.status === 'failed' && uploadState.stage === 'processing'
          ? 'retry'
          : 'next-upload'
  // Re-tracing refunds the current result first, so its credits count toward the new trace.
  const spendableBalance =
    credits.status === 'ready' && credits.balance !== null ? credits.balance + (modeContext === 'retrace' ? TRACE_MODE_CREDITS[selectedMode] : 0) : null

  return (
    <section id="workspace" className="scroll-mt-20 px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow={t.workspace.eyebrow}
        title={t.workspace.title}
        description={t.workspace.description}
      />

      <div className="relative mx-auto mt-12 max-w-6xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-10 -top-8 -z-10 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent-soft),transparent)]"
        />

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl shadow-black/5">
          {/* fake window chrome for realism */}
          <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 text-xs font-medium text-[var(--ink-faint)]">
              {t.workspace.windowUrl}
            </span>
            {!backendConfigured && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)]">
                <Eye size={11} />
                {t.workspace.previewModeBadge}
              </span>
            )}
          </div>

          {/* honest disclosure banner — only shown while there's no real backend to talk to */}
          {!backendConfigured && (
            <div className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2.5 text-xs text-[var(--ink-muted)]">
              <Info size={14} className="mt-0.5 flex-none text-[var(--accent)]" />
              <span>{t.workspace.previewModeMessage}</span>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              // Picking the same file again must still fire a change.
              e.target.value = ''
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px]">
            {/* Center panel: upload / before-after preview */}
            <div className="flex min-w-0 flex-col border-b border-[var(--border)] p-4 lg:border-b-0 lg:border-r">
              {currentResult && previewUrl ? (
                <ResultViewer
                  key={previewUrl}
                  originalUrl={previewUrl}
                  vectorUrl={currentResult.url}
                  svgText={currentResult.text}
                  overlay={
                    <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-lg bg-black/55 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-white">
                        <CheckCircle2 size={13} className="flex-none text-emerald-400" />
                        <span className="truncate">
                          {completedFormat} · {modeTitles[selectedMode]}
                        </span>
                      </span>
                      <Button size="sm" onClick={triggerDownload}>
                        <Download size={14} />
                        {t.workspace.download}
                      </Button>
                    </div>
                  }
                />
              ) : sampleOpen && sample && sampleUrl && sampleText !== undefined ? (
                <ResultViewer
                  key={sample.id}
                  originalUrl={sample.source}
                  vectorUrl={sampleUrl}
                  svgText={sampleText}
                  overlay={
                    <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-lg bg-black/75 px-3 py-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-white">
                        <span className="flex-none rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          {t.workspace.samples.badge}
                        </span>
                        <span className="truncate">
                          {t.workspace.samples.items[sample.id]} · {modeTitles[selectedMode]}
                          {sample.credit ? ` · ${sample.credit}` : ''}
                        </span>
                      </span>
                      <Button size="sm" onClick={closeSampleAndBrowse} className="flex-none">
                        <UploadCloud size={14} />
                        <span className="hidden sm:inline">{t.workspace.samples.uploadOwn}</span>
                        <span className="sm:hidden">{t.workspace.browseFiles}</span>
                      </Button>
                    </div>
                  }
                />
              ) : (
                <div
                  className="relative flex flex-1 select-none flex-col overflow-hidden rounded-xl bg-[var(--bg-subtle)]"
                  style={{ minHeight: 280 }}
                >
                  {sampleOpen && (
                    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                      {sampleErrorUrl === sampleUrl ? (
                        <>
                          <AlertTriangle className="text-red-500" size={28} />
                          <p className="text-sm font-semibold text-[var(--ink)]">{t.workspace.samples.loadError}</p>
                          <Button variant="secondary" size="sm" onClick={() => sample && openSample(sample.id)}>
                            <RefreshCcw size={14} />
                            {t.workspace.retry}
                          </Button>
                        </>
                      ) : (
                        <Loader2 className="animate-spin text-[var(--accent)]" size={28} aria-label={t.common.loading} />
                      )}
                    </div>
                  )}

                  {!isActive && !sampleOpen && (
                    <div className="flex flex-1 flex-col">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
                        }}
                        {...dropzoneHandlers}
                        className={cn(
                          'flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                          isDragOver
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : 'border-[var(--border-strong)] hover:border-[var(--accent)]',
                        )}
                      >
                        <UploadCloud className="text-[var(--accent)]" size={28} />
                        <p className="text-sm font-semibold text-[var(--ink)]">{t.workspace.dropTitle}</p>
                        <p className="text-xs text-[var(--ink-faint)]">{t.workspace.dropSubtitle}</p>
                        {/* Looks like a button; the whole dropzone is the control (no nested controls). */}
                        <span className="mt-1 inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-muted)] px-3.5 py-2 text-sm font-semibold text-[var(--ink)]">
                          {t.workspace.browseFiles}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-3 text-xs text-[var(--ink-muted)]">
                        <span>{t.workspace.samples.title}</span>
                        {TRACE_SAMPLES.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => openSample(entry.id)}
                            className="rounded-full border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-1 font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                          >
                            {t.workspace.samples.items[entry.id]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {isActive && !backendConfigured && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="relative flex-1"
                      {...containerHandlers}
                    >
                      <div className="absolute inset-0 flex items-center justify-center p-6">
                        <div className="h-full w-full max-w-[160px]">
                          <BeforeAfterArt crisp={false} />
                        </div>
                      </div>
                      <div
                        className="absolute inset-0 flex items-center justify-center p-6"
                        style={{ clipPath: `inset(0 0 0 ${splitPct}%)` }}
                      >
                        <div className="h-full w-full max-w-[160px]">
                          <BeforeAfterArt crisp />
                        </div>
                      </div>
                      <div
                        role="slider"
                        tabIndex={0}
                        aria-label={t.common.compareSliderLabel}
                        aria-orientation="horizontal"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(splitPct)}
                        onKeyDown={onHandleKeyDown}
                        className="absolute inset-y-0 w-0.5 cursor-ew-resize bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                        style={{ left: `${splitPct}%` }}
                      />
                      <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
                        {t.hero.original}
                      </span>
                      <span className="absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
                        {t.hero.vectorized}
                      </span>
                    </motion.div>
                  )}

                  {isActive && backendConfigured && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                      className="relative flex-1"
                    >
                      {/* Original: shown the instant a file is selected, never blank while we wait on the backend. */}
                      {previewUrl && (
                        <div className="absolute inset-0 flex items-center justify-center p-6">
                          <img src={previewUrl} alt="" className="h-full w-full object-contain" />
                        </div>
                      )}
                      {previewUrl && (
                        <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
                          {t.hero.original}
                        </span>
                      )}

                      {/* Loading overlay: uploading/queued/processing, and the brief window after completion while the result is still being fetched. */}
                      {(isWorking || (isCompleted && !currentResult && !resultFetchError)) && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-elevated)]/85 text-center">
                          <Loader2 className="animate-spin text-[var(--accent)]" size={28} />
                          <p className="text-sm font-semibold text-[var(--ink)]">
                            {uploadState.status === 'uploading' && t.workspace.statusUploading}
                            {uploadState.status === 'queued' && t.workspace.statusQueued}
                            {uploadState.status === 'processing' && t.workspace.statusProcessing}
                            {isCompleted && t.workspace.statusFetchingResult}
                          </p>
                          {isWorking && uploadState.status !== 'uploading' && (
                            <p className="text-xs text-[var(--ink-muted)]">{modeTitles[selectedMode]}</p>
                          )}
                        </div>
                      )}

                      {isFailed && uploadState.status === 'failed' && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-elevated)]/95 p-6 text-center">
                          <FailureIcon className="text-red-500" size={28} />
                          <p className="text-sm font-semibold text-[var(--ink)]">{failureTitle}</p>
                          <p className="max-w-[220px] text-xs text-[var(--ink-faint)]">{failureMessage}</p>
                          <Button variant="secondary" size="sm" onClick={retry}>
                            <RefreshCcw size={14} />
                            {t.workspace.retry}
                          </Button>
                        </div>
                      )}

                      {isCompleted && resultFetchError && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-elevated)]/95 p-6 text-center">
                          <AlertTriangle className="text-red-500" size={28} />
                          <p className="text-sm font-semibold text-[var(--ink)]">{t.workspace.fetchResultFailedTitle}</p>
                          <p className="max-w-[220px] text-xs text-[var(--ink-faint)]">{resultFetchError}</p>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              if (completedConversion?.downloadUrl) void fetchResult(completedConversion.id, completedConversion.downloadUrl)
                            }}
                          >
                            <RefreshCcw size={14} />
                            {t.workspace.retry}
                          </Button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              )}

              {(backendConfigured || sampleOpen) && (
                <TraceModeSelector
                  value={selectedMode}
                  onChange={(mode) => void selectTraceMode(mode)}
                  context={modeContext}
                  balance={spendableBalance}
                  recommended={isAiRecommended ? 'professional' : null}
                />
              )}

              {backendConfigured && analysis && (
                <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                    {t.workspace.analysis.title}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-muted)] px-2.5 py-1 text-[10px] font-semibold text-[var(--ink-muted)]">
                      <ImageTypeIcon size={11} />
                      {t.workspace.analysis.imageTypes[analysis.imageType]}
                    </span>
                    {analysis.imageType === 'logo' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)]">
                        {t.workspace.analysis.badges.bestForLogos}
                      </span>
                    )}
                    {analysis.imageType === 'photo' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)]">
                        {t.workspace.analysis.badges.bestForPhotos}
                      </span>
                    )}
                    {analysis.estimatedQuality === 'high' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={11} />
                        {t.workspace.analysis.badges.printReady}
                      </span>
                    )}
                    {isAiRecommended && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)]">
                        <Sparkles size={11} />
                        {t.workspace.analysis.badges.aiRecommended}
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] sm:grid-cols-4">
                    <div>
                      <span className="text-[var(--ink-faint)]">{t.workspace.analysis.complexityLabel}: </span>
                      <span className="font-medium text-[var(--ink)]">{Math.round(analysis.complexityScore * 100)}%</span>
                    </div>
                    <div>
                      <span className="text-[var(--ink-faint)]">{t.workspace.analysis.qualityLabel}: </span>
                      <span className="font-medium text-[var(--ink)]">{t.workspace.analysis.qualityLevels[analysis.estimatedQuality]}</span>
                    </div>
                    <div>
                      <span className="text-[var(--ink-faint)]">{t.workspace.analysis.timeLabel}: </span>
                      <span className="font-medium text-[var(--ink)]">{formatEstimatedTime(analysis.estimatedProcessingTimeMs)}</span>
                    </div>
                    <div>
                      <span className="text-[var(--ink-faint)]">{t.workspace.analysis.providerLabel}: </span>
                      <span className="font-medium text-[var(--ink)]">{t.workspace.analysis.providers[analysis.recommendedProvider]}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--ink-faint)]">
                {(isActive || sampleOpen) && (
                  <button
                    type="button"
                    onClick={handleNewImage}
                    className="inline-flex items-center gap-1 font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                  >
                    <RefreshCcw size={11} />
                    {sampleOpen ? t.workspace.samples.uploadOwn : t.workspace.newImage}
                  </button>
                )}
              </div>
            </div>

            {/* Right panel: the signed-in user's credits */}
            <aside className="p-4" aria-labelledby="workspace-credits-title">
              <p
                id="workspace-credits-title"
                className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]"
              >
                {t.credits.panelTitle}
              </p>
              {credits.status === 'ready' && credits.balance !== null ? (
                <>
                  <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--ink)]">
                    {formatCredits(credits.balance, language, t.credits.unit)}
                  </p>
                  <ul className="mt-3 flex flex-col gap-1.5 text-xs text-[var(--ink-muted)]">
                    <li>{t.credits.costQuick}</li>
                    <li>{t.credits.costProfessional}</li>
                    <li>{t.credits.costRefund}</li>
                  </ul>
                  <Link
                    href="/account"
                    className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)]"
                  >
                    {t.credits.viewHistory}
                    <ArrowRight size={12} />
                  </Link>
                </>
              ) : credits.status === 'loading' ? (
                <div aria-busy="true" aria-label={t.common.loading} className="flex flex-col gap-2">
                  <div className="h-7 w-24 animate-pulse rounded-md bg-[var(--bg-muted)]" />
                  <div className="h-3 w-full animate-pulse rounded bg-[var(--bg-muted)]" />
                  <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--bg-muted)]" />
                </div>
              ) : credits.status === 'error' ? (
                <div className="flex flex-col items-start gap-2 text-xs text-[var(--ink-muted)]">
                  <p>{t.credits.loadError}</p>
                  <Button variant="secondary" size="sm" onClick={credits.refresh}>
                    <RefreshCcw size={12} />
                    {t.credits.retry}
                  </Button>
                </div>
              ) : credits.status === 'signed-out' ? (
                <div className="flex flex-col items-start gap-3 text-xs text-[var(--ink-muted)]">
                  <p>{t.credits.panelSignedOut}</p>
                  <Button size="sm" onClick={() => requestAuthDialog('sign-in')}>
                    {t.credits.signIn}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-[var(--ink-muted)]">{t.credits.notConfigured}</p>
              )}
            </aside>
          </div>

          {/* Bottom output bar: SVG is the only format the engine produces */}
          <div className="flex flex-col gap-2 border-t border-[var(--border)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[var(--ink-faint)]">{t.workspace.exportAs}</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!currentResult}
                title={currentResult ? undefined : t.workspace.exportDisabledNote}
                onClick={currentResult ? triggerDownload : undefined}
              >
                <Download size={14} />
                SVG
              </Button>
            </div>
            {!currentResult && (
              <p className="text-right text-[11px] text-[var(--ink-faint)]">{t.workspace.exportDisabledNote}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function failureMessageFor(
  kind: UploadFailureKind,
  stage: 'upload' | 'processing',
  messages: Translation['workspace']['failureMessages'],
): string {
  switch (kind) {
    case 'auth':
      return messages.auth
    case 'insufficient-credits':
      return messages.insufficientCredits
    case 'rate-limited':
      return messages.rateLimited
    case 'quota':
      return messages.quota
    case 'too-large':
      return messages.tooLarge
    case 'unsupported':
      return messages.unsupported
    default:
      return stage === 'upload' ? messages.upload : messages.processing
  }
}
