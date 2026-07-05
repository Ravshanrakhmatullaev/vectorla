import { useRef, useState } from 'react'
import { UploadCloud, Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { trustBadges } from '@/data/trustBadges'
import { useLanguage } from '@/lib/language'

/** Illustrative mark used only for the before/after demo — not a real upload yet. */
function DemoMark({ crisp }: { crisp: boolean }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className="h-full w-full"
      style={!crisp ? { filter: 'blur(1.1px) saturate(0.85)' } : undefined}
    >
      <defs>
        <linearGradient id="demo-grad" x1="0" y1="0" x2="200" y2="200" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D28D9" />
          <stop offset="1" stopColor="#4C1D95" />
        </linearGradient>
      </defs>
      <rect x="20" y="20" width="160" height="160" rx="28" fill="url(#demo-grad)" opacity={crisp ? 1 : 0.9} />
      <path
        d="M60 100 L90 140 L145 65"
        stroke="white"
        strokeWidth={crisp ? 14 : 16}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={crisp ? 1 : 0.85}
      />
    </svg>
  )
}

export function Hero() {
  const [splitPct, setSplitPct] = useState(52)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const { t } = useLanguage()

  function updateFromClientX(clientX: number) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pct = ((clientX - rect.left) / rect.width) * 100
    setSplitPct(Math.min(100, Math.max(0, pct)))
  }

  return (
    <section id="top" className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
      {/* soft background gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,var(--accent-soft),transparent)]"
      />

      <div className="mx-auto max-w-3xl text-center">
        <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-subtle)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {t.hero.badge}
        </span>

        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-[var(--ink)] sm:text-6xl">
          {t.hero.title}
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-base text-[var(--ink-muted)] sm:text-lg">
          {t.hero.description}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg">
            <UploadCloud size={18} />
            {t.hero.startVectorizing}
          </Button>
          <Button variant="secondary" size="lg">
            <Play size={16} />
            {t.hero.viewDemo}
          </Button>
        </div>
      </div>

      {/* Upload demo + before/after preview */}
      <div className="mx-auto mt-14 max-w-4xl">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-xl shadow-black/5 sm:p-4">
          <div
            ref={containerRef}
            className="relative aspect-[16/9] select-none overflow-hidden rounded-xl bg-[var(--bg-subtle)]"
            onPointerDown={(e) => {
              draggingRef.current = true
              updateFromClientX(e.clientX)
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) updateFromClientX(e.clientX)
            }}
            onPointerUp={() => {
              draggingRef.current = false
            }}
          >
            {/* checkerboard to suggest transparency */}
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-40 [background-image:linear-gradient(45deg,var(--border)_25%,transparent_25%),linear-gradient(-45deg,var(--border)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--border)_75%),linear-gradient(-45deg,transparent_75%,var(--border)_75%)] [background-position:0_0,0_10px,10px_-10px,-10px_0] [background-size:20px_20px]"
            />

            <div className="absolute inset-0 flex items-center justify-center p-10">
              <div className="h-full w-full max-w-xs opacity-90">
                <DemoMark crisp={false} />
              </div>
            </div>

            <div
              className="absolute inset-0 flex items-center justify-center overflow-hidden p-10"
              style={{ width: `${splitPct}%` }}
            >
              <div className="h-full w-full max-w-xs" style={{ width: '320px', maxWidth: 'none' }}>
                <DemoMark crisp />
              </div>
            </div>

            <div
              className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1)]"
              style={{ left: `${splitPct}%` }}
            />
            <div
              className="absolute top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg"
              style={{ left: `${splitPct}%` }}
            >
              <div className="flex gap-0.5">
                <div className="h-3 w-0.5 rounded bg-[var(--ink-faint)]" />
                <div className="h-3 w-0.5 rounded bg-[var(--ink-faint)]" />
              </div>
            </div>

            <span className="absolute left-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
              {t.hero.original}
            </span>
            <span className="absolute right-3 top-3 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white">
              {t.hero.vectorized}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3">
            <p className="text-xs text-[var(--ink-faint)]">{t.hero.dragHint}</p>
            <Button variant="secondary" size="sm">
              <UploadCloud size={14} />
              {t.hero.uploadImage}
            </Button>
          </div>
        </div>
      </div>

      {/* trust badges */}
      <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {trustBadges.map((badge) => (
          <div key={badge.id} className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            <badge.icon size={15} className="text-[var(--accent)]" />
            {t.trustBadges[badge.id]}
          </div>
        ))}
      </div>
    </section>
  )
}
