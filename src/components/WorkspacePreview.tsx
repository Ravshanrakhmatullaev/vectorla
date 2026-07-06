import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { UploadCloud, Clock, Printer, CheckCircle2, SlidersHorizontal, Eye, Info, RefreshCcw } from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Button } from '@/components/ui/Button'
import { BeforeAfterArt } from '@/components/BeforeAfterArt'
import { workspaceSettings, workspacePresets, recentFiles, exportFormats, printChecklist } from '@/data/workspace'
import { useLanguage } from '@/lib/language'
import { useCompareSlider } from '@/hooks/useCompareSlider'
import { useDropzone } from '@/hooks/useDropzone'
import { cn } from '@/utils/cn'

// TODO(backend): Preview Mode only — no image is uploaded, read, or processed.
// Real AI vectorization is not connected yet; this demonstrates the intended UI only.
export function WorkspacePreview() {
  const [activePreset, setActivePreset] = useState<(typeof workspacePresets)[number]>('logo')
  const [printReady, setPrintReady] = useState(true)
  const [showDemo, setShowDemo] = useState(false)
  const { splitPct, containerRef, containerHandlers, onHandleKeyDown } = useCompareSlider(55)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useLanguage()

  function handleFiles(files: FileList | null) {
    if (!files?.[0]) return
    setShowDemo(true)
  }

  const { isDragOver, dropzoneHandlers } = useDropzone(handleFiles)

  return (
    <section className="px-5 py-20 sm:px-8">
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
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--accent)]">
              <Eye size={11} />
              {t.workspace.previewModeBadge}
            </span>
          </div>

          {/* honest disclosure banner */}
          <div className="flex items-start gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2.5 text-xs text-[var(--ink-muted)]">
            <Info size={14} className="mt-0.5 flex-none text-[var(--accent)]" />
            <span>{t.workspace.previewModeMessage}</span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_260px]">
            {/* Left panel: presets + recent files */}
            <div className="order-3 border-b border-[var(--border)] p-4 lg:order-1 lg:border-b-0 lg:border-r">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-4 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <UploadCloud size={16} />
                {t.workspace.uploadImage}
              </button>

              <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                {t.workspace.presetsLabel}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {workspacePresets.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setActivePreset(preset)}
                    aria-pressed={activePreset === preset}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                      activePreset === preset
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-[var(--bg-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]',
                    )}
                  >
                    {t.workspace.presets[preset]}
                  </button>
                ))}
              </div>

              <p className="mb-2 mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                <Clock size={11} /> {t.workspace.recentFilesLabel}
              </p>
              <div className="flex flex-col gap-1">
                {recentFiles.map((file) => (
                  <button
                    key={file}
                    onClick={() => setShowDemo(true)}
                    className="truncate rounded-md px-2 py-1.5 text-left text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--ink)]"
                  >
                    {file}
                  </button>
                ))}
              </div>
            </div>

            {/* Center panel: upload / before-after preview */}
            <div className="order-1 flex flex-col border-b border-[var(--border)] p-4 lg:order-2 lg:border-b-0 lg:border-r">
              <div
                className="relative flex-1 select-none overflow-hidden rounded-xl bg-[var(--bg-subtle)]"
                style={{ minHeight: 280 }}
              >
                {!showDemo && (
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

                {showDemo && (
                  <motion.div
                    ref={containerRef}
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
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--ink-faint)]">
                <span>
                  {t.workspace.presetPrefix}
                  {t.workspace.presets[activePreset]}
                </span>
                {showDemo && (
                  <button
                    type="button"
                    onClick={() => setShowDemo(false)}
                    className="inline-flex items-center gap-1 font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
                  >
                    <RefreshCcw size={11} />
                    {t.workspace.newImage}
                  </button>
                )}
              </div>
            </div>

            {/* Right panel: settings + print-ready checklist */}
            <div className="order-2 p-4 lg:order-3">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
                <SlidersHorizontal size={11} /> {t.workspace.settingsLabel}
              </p>
              <div className="flex flex-col gap-4">
                {workspaceSettings.map((setting) => (
                  <div key={setting.id}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-[var(--ink-muted)]">{t.workspace.settings[setting.id]}</span>
                      <span className="font-mono font-medium text-[var(--accent)]">
                        {setting.value}
                        {setting.unit ?? ''}
                      </span>
                    </div>
                    <div aria-hidden="true" className="h-1.5 rounded-full bg-[var(--bg-muted)]">
                      <div
                        className="h-1.5 rounded-full bg-[var(--accent)]"
                        style={{ width: `${setting.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <label className="mt-5 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2.5 text-xs font-medium text-[var(--ink)]">
                <span className="flex items-center gap-1.5">
                  <Printer size={13} className="text-[var(--accent)]" />
                  {t.workspace.printReadyMode}
                </span>
                <button
                  onClick={() => setPrintReady((v) => !v)}
                  className={cn(
                    'relative h-5 w-9 rounded-full transition-colors',
                    printReady ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]',
                  )}
                  aria-pressed={printReady}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                      printReady ? 'translate-x-4' : 'translate-x-0.5',
                    )}
                  />
                </button>
              </label>
              <div className="mt-3 flex flex-col gap-1.5">
                {printChecklist.map((id) => (
                  <div
                    key={id}
                    className={cn(
                      'flex items-center gap-1.5 text-[11px] transition-opacity',
                      printReady ? 'text-[var(--ink-muted)] opacity-100' : 'text-[var(--ink-faint)] opacity-50',
                    )}
                  >
                    <CheckCircle2
                      size={13}
                      className={printReady ? 'text-[var(--accent)]' : 'text-[var(--ink-faint)]'}
                    />
                    {t.workspace.printChecklist[id]}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom export bar */}
          <div className="flex flex-col gap-2 border-t border-[var(--border)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[var(--ink-faint)]">{t.workspace.exportAs}</span>
              <div className="flex flex-wrap gap-2">
                {exportFormats.map((format) => (
                  <Button
                    key={format}
                    variant="secondary"
                    size="sm"
                    disabled
                    title={t.workspace.exportDisabledNote}
                  >
                    {format}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-right text-[11px] text-[var(--ink-faint)]">{t.workspace.exportDisabledNote}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
