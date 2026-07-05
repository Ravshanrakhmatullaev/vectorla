import { useState } from 'react'
import {
  UploadCloud,
  Clock,
  Sparkles,
  Printer,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { Button } from '@/components/ui/Button'
import { workspaceSettings, workspacePresets, recentFiles, exportFormats } from '@/data/workspace'

// TODO(backend): wire this preview to the real vectorization engine.
// Slider values below are local UI state only — no tracing happens yet.
export function WorkspacePreview() {
  const [activePreset, setActivePreset] = useState('Logo')
  const [printReady, setPrintReady] = useState(true)
  const [splitPct, setSplitPct] = useState(55)

  return (
    <section className="px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow="Workspace"
        title="A workspace built for production, not toy demos"
        description="Every control a print professional expects — presets, precision settings, and print-ready validation in one place."
      />

      <div className="mx-auto mt-12 max-w-6xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-2xl shadow-black/5">
        {/* fake window chrome for realism */}
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-xs font-medium text-[var(--ink-faint)]">
            app.vectorla.app/workspace
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_260px]">
          {/* Left panel */}
          <div className="border-b border-[var(--border)] p-4 lg:border-b-0 lg:border-r">
            <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-4 text-xs font-semibold text-[var(--ink-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
              <UploadCloud size={16} />
              Upload image
            </button>

            <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              Presets
            </p>
            <div className="flex flex-wrap gap-1.5">
              {workspacePresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setActivePreset(preset)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    activePreset === preset
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--bg-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>

            <p className="mb-2 mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              <Clock size={11} /> Recent files
            </p>
            <div className="flex flex-col gap-1">
              {recentFiles.map((file) => (
                <div
                  key={file}
                  className="truncate rounded-md px-2 py-1.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--bg-muted)]"
                >
                  {file}
                </div>
              ))}
            </div>
          </div>

          {/* Center preview */}
          <div className="flex flex-col border-b border-[var(--border)] p-4 lg:border-b-0 lg:border-r">
            <div
              className="relative flex-1 select-none overflow-hidden rounded-xl bg-[var(--bg-subtle)]"
              style={{ minHeight: 280 }}
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                const move = (ev: PointerEvent) => {
                  const pct = ((ev.clientX - rect.left) / rect.width) * 100
                  setSplitPct(Math.min(100, Math.max(0, pct)))
                }
                const up = () => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-28 w-28 rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[#4C1D95] opacity-70 blur-[1px]" />
              </div>
              <div
                className="absolute inset-0 flex items-center justify-center overflow-hidden"
                style={{ width: `${splitPct}%` }}
              >
                <div className="flex h-28 w-28 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[#4C1D95]">
                  <CheckCircle2 className="text-white" size={30} />
                </div>
              </div>
              <div
                className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.12)]"
                style={{ left: `${splitPct}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-[var(--ink-faint)]">
              <span>Preset: {activePreset}</span>
              <span className="flex items-center gap-1">
                <Sparkles size={12} className="text-[var(--accent)]" /> Live preview
              </span>
            </div>
          </div>

          {/* Right panel: settings */}
          <div className="p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-faint)]">
              <SlidersHorizontal size={11} /> Vector settings
            </p>
            <div className="flex flex-col gap-4">
              {workspaceSettings.map((setting) => (
                <div key={setting.label}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="text-[var(--ink-muted)]">{setting.label}</span>
                    <span className="font-mono font-medium text-[var(--accent)]">
                      {setting.value}
                      {setting.unit ?? ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--bg-muted)]">
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
                Print-ready mode
              </span>
              <button
                onClick={() => setPrintReady((v) => !v)}
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  printReady ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
                }`}
                aria-pressed={printReady}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    printReady ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </label>
            {printReady && (
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--ink-faint)]">
                DPI check passed &middot; CMYK-ready &middot; clean paths &middot; reduced nodes &middot;
                transparent background &middot; cut lines included.
              </p>
            )}
          </div>
        </div>

        {/* Bottom export bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
          <span className="text-xs text-[var(--ink-faint)]">Export as:</span>
          <div className="flex flex-wrap gap-2">
            {exportFormats.map((format) => (
              <Button key={format} variant="secondary" size="sm">
                {format}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
