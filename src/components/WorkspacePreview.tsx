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
  Zap,
  Sparkles,
  Image as ImageIcon,
  Camera,
  Palette,
  ArrowRight,
} from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Button } from '@/components/ui/Button'
import { BeforeAfterArt } from '@/components/BeforeAfterArt'
import { Link } from '@/components/ui/Link'
import { useLanguage } from '@/lib/language'
import { useCredits } from '@/lib/useCredits'
import { requestAuthDialog } from '@/lib/authDialogEvents'
import { formatCredits } from '@/utils/formatCredits'
import { useCompareSlider } from '@/hooks/useCompareSlider'
import { useDropzone } from '@/hooks/useDropzone'
import { useUploadFlow } from '@/hooks/useUploadFlow'
import { isBackendConfigured } from '@/lib/api/client'
import { fetchConversionFile } from '@/lib/api/conversions'
import { cn } from '@/utils/cn'

const backendConfigured = isBackendConfigured()

// Mirrors backend's PROFESSIONAL_TRACE_CREDIT_MULTIPLIER (2) — see
// backend/src/pipeline/ProfessionalTracePipeline.ts and
// ConversionService.processJob, which actually bills this rate for a
// PROFESSIONAL_TRACE_PRESET job (Phase 26). A fixed display figure
// (Professional Trace's cost doesn't vary per image), not derived from
// analysis.estimatedCredits (which only reflects the *recommended* provider
// for this specific image, not "what Professional Trace costs").
const PROFESSIONAL_TRACE_CREDITS = 2

const IMAGE_TYPE_ICONS = { photo: Camera, illustration: Palette, logo: ImageIcon } as const

function formatEstimatedTime(ms: number): string {
  return ms < 1000 ? `~${ms}ms` : `~${(ms / 1000).toFixed(1)}s`
}

/**
 * When the backend isn't configured, this stays Preview Mode only (no image
 * is uploaded, read, or processed) — see PROJECT_CONTEXT.md's honesty
 * requirement. When it is configured, uploads go through the real API v1
 * flow: upload → job → poll every second → completed/failed (see
 * src/hooks/useUploadFlow.ts).
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
  const [vectorizedUrl, setVectorizedUrl] = useState<string | null>(null)
  const [resultFetchError, setResultFetchError] = useState<string | null>(null)
  const fetchedConversionIdRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    return () => {
      if (vectorizedUrl) URL.revokeObjectURL(vectorizedUrl)
    }
  }, [vectorizedUrl])

  const fetchResult = useCallback(async (downloadUrl: string) => {
    setResultFetchError(null)
    try {
      const blob = await fetchConversionFile(downloadUrl)
      setVectorizedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
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
    if (conversion.downloadUrl) void fetchResult(conversion.downloadUrl)
  }, [uploadState, fetchResult])

  // A finished or failed job changes the balance (a charge, or a refund).
  useEffect(() => {
    if (uploadState.status === 'completed' || uploadState.status === 'failed') refreshCredits()
  }, [uploadState.status, refreshCredits])

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    if (!backendConfigured) {
      setShowDemo(true)
      return
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    if (vectorizedUrl) URL.revokeObjectURL(vectorizedUrl)
    setVectorizedUrl(null)
    setResultFetchError(null)
    fetchedConversionIdRef.current = null
    void upload(file)
  }

  function handleNewImage() {
    setShowDemo(false)
    reset()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    if (vectorizedUrl) URL.revokeObjectURL(vectorizedUrl)
    setVectorizedUrl(null)
    setResultFetchError(null)
    fetchedConversionIdRef.current = null
  }

  function triggerDownload() {
    if (!vectorizedUrl || !completedFormat) return
    const anchor = document.createElement('a')
    anchor.href = vectorizedUrl
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
  const completedFormat =
    isCompleted && uploadState.status === 'completed' && uploadState.conversion
      ? uploadState.conversion.format.toUpperCase()
      : null
  const failureTitle =
    uploadState.status === 'failed'
      ? uploadState.kind === 'auth'
        ? t.workspace.authRequiredTitle
        : uploadState.kind === 'insufficient-credits'
          ? t.workspace.insufficientCreditsTitle
          : uploadState.stage === 'upload'
            ? t.workspace.uploadFailedTitle
            : t.workspace.statusFailedTitle
      : ''
  const FailureIcon = uploadState.status === 'failed' && uploadState.kind === 'auth' ? Lock : uploadState.status === 'failed' && uploadState.kind === 'insufficient-credits' ? Coins : AlertTriangle
  const isAiRecommended = analysis ? analysis.recommendedProvider === 'vision' || analysis.recommendedProvider === 'openai' : false
  const ImageTypeIcon = analysis ? IMAGE_TYPE_ICONS[analysis.imageType] : ImageIcon

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
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px]">
            {/* Center panel: upload / before-after preview */}
            <div className="flex flex-col border-b border-[var(--border)] p-4 lg:border-b-0 lg:border-r">
              <div
                className="relative flex-1 select-none overflow-hidden rounded-xl bg-[var(--bg-subtle)]"
                style={{ minHeight: 280 }}
              >
                {!isActive && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
                    }}
                    {...dropzoneHandlers}
                    className={cn(
                      'flex h-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                      isDragOver
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'border-[var(--border-strong)] hover:border-[var(--accent)]',
                    )}
                  >
                    <UploadCloud className="text-[var(--accent)]" size={28} />
                    <p className="text-sm font-semibold text-[var(--ink)]">{t.workspace.dropTitle}</p>
                    <p className="text-xs text-[var(--ink-faint)]">{t.workspace.dropSubtitle}</p>
                    <Button variant="secondary" size="sm" className="mt-1">
                      {t.workspace.browseFiles}
                    </Button>
                  </div>
                )}

                {isActive && !backendConfigured && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="relative h-full w-full"
                    {...containerHandlers}
                  >
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                      <div className="h-full w-full max-w-[160px]">
                        <BeforeAfterArt crisp={false} />
                      </div>
                    </div>
                    <div
                      className="absolute inset-0 flex items-center justify-center p-6"
                      style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
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
                    className="relative h-full w-full"
                    {...(isCompleted && vectorizedUrl ? containerHandlers : {})}
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

                    {/* Vectorized: only once the job is done and the real SVG bytes are fetched. */}
                    {isCompleted && vectorizedUrl && (
                      <>
                        <div
                          className="absolute inset-0 flex items-center justify-center p-6"
                          style={{ clipPath: `inset(0 ${100 - splitPct}% 0 0)` }}
                        >
                          <img src={vectorizedUrl} alt="" className="h-full w-full object-contain" />
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
                        <span className="absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
                          {t.hero.vectorized}
                        </span>
                        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-lg bg-black/55 px-3 py-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-medium text-white">
                            <CheckCircle2 size={13} className="text-emerald-400" />
                            {completedFormat}
                          </span>
                          <Button size="sm" onClick={triggerDownload}>
                            <Download size={14} />
                            {t.workspace.download}
                          </Button>
                        </div>
                      </>
                    )}

                    {/* Loading overlay: uploading/queued/processing, and the brief window after completion while the result is still being fetched. */}
                    {(isWorking || (isCompleted && !vectorizedUrl && !resultFetchError)) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-elevated)]/85 text-center">
                        <Loader2 className="animate-spin text-[var(--accent)]" size={28} />
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {uploadState.status === 'uploading' && t.workspace.statusUploading}
                          {uploadState.status === 'queued' && t.workspace.statusQueued}
                          {uploadState.status === 'processing' && t.workspace.statusProcessing}
                          {isCompleted && t.workspace.statusFetchingResult}
                        </p>
                      </div>
                    )}

                    {isFailed && uploadState.status === 'failed' && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg-elevated)]/95 p-6 text-center">
                        <FailureIcon className="text-red-500" size={28} />
                        <p className="text-sm font-semibold text-[var(--ink)]">{failureTitle}</p>
                        <p className="max-w-[220px] text-xs text-[var(--ink-faint)]">{uploadState.message}</p>
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
                            if (uploadState.status === 'completed' && uploadState.conversion?.downloadUrl) {
                              void fetchResult(uploadState.conversion.downloadUrl)
                            }
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

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void selectTraceMode('quick')}
                      aria-pressed={selectedMode === 'quick'}
                      className={cn(
                        'rounded-lg border p-2.5 text-left transition-colors',
                        selectedMode === 'quick'
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-[var(--border)] hover:border-[var(--border-strong)]',
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                        <Zap size={13} className="text-[var(--accent)]" />
                        {t.workspace.analysis.quickTraceTitle}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--ink-faint)]">{t.workspace.analysis.quickTraceDescription}</p>
                      <p className="mt-1 text-[11px] font-medium text-[var(--ink-muted)]">
                        {formatCredits(1, language, t.credits.unit)}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => void selectTraceMode('professional')}
                      aria-pressed={selectedMode === 'professional'}
                      className={cn(
                        'relative rounded-lg border p-2.5 text-left transition-colors',
                        selectedMode === 'professional'
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-[var(--border)] hover:border-[var(--border-strong)]',
                      )}
                    >
                      {isAiRecommended && (
                        <span className="absolute -top-2 right-2 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-white">
                          {t.workspace.analysis.recommendedBadge}
                        </span>
                      )}
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
                        <Sparkles size={13} className="text-[var(--accent)]" />
                        {t.workspace.analysis.professionalTraceTitle}
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--ink-faint)]">{t.workspace.analysis.professionalTraceDescription}</p>
                      <p className="mt-1 text-[11px] font-medium text-[var(--ink-muted)]">
                        {formatCredits(PROFESSIONAL_TRACE_CREDITS, language, t.credits.unit)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--accent)]">
                        {t.workspace.analysis.qualityImprovement[analysis.estimatedQuality]}
                      </p>
                    </button>
                  </div>

                  {selectedMode === 'professional' && (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--ink-faint)]">
                      <Info size={12} className="mt-0.5 flex-none text-[var(--accent)]" />
                      {t.workspace.analysis.professionalTraceNote}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--ink-faint)]">
                {isActive && (
                  <button
                    type="button"
                    onClick={handleNewImage}
                    className="inline-flex items-center gap-1 font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                  >
                    <RefreshCcw size={11} />
                    {t.workspace.newImage}
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
                disabled={!(isCompleted && vectorizedUrl)}
                title={isCompleted && vectorizedUrl ? undefined : t.workspace.exportDisabledNote}
                onClick={isCompleted && vectorizedUrl ? triggerDownload : undefined}
              >
                <Download size={14} />
                SVG
              </Button>
            </div>
            {!isCompleted && (
              <p className="text-right text-[11px] text-[var(--ink-faint)]">{t.workspace.exportDisabledNote}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
