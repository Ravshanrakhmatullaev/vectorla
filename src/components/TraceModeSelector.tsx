import { useId, useRef, type KeyboardEvent } from 'react'
import { Check, Info, Sparkles, Zap } from 'lucide-react'
import { useLanguage } from '@/lib/language'
import { formatCredits } from '@/utils/formatCredits'
import { TRACE_MODE_CREDITS, type TraceMode } from '@/hooks/useUploadFlow'
import { cn } from '@/utils/cn'

const MODES: readonly TraceMode[] = ['quick', 'professional']

/**
 * - `next-upload`: nothing uploaded yet; the choice is sent with the upload.
 * - `retrace`: a result exists; choosing the other mode traces it again
 *   and refunds the current result.
 * - `retry`: the trace failed (and was refunded); choosing a mode traces again.
 * - `busy`: a trace is running; the choice is locked until it ends.
 * - `sample`: a pre-traced sample is open; switching is free.
 */
export type TraceModeContext = 'next-upload' | 'retrace' | 'retry' | 'busy' | 'sample'

interface TraceModeSelectorProps {
  value: TraceMode
  onChange: (mode: TraceMode) => void
  context: TraceModeContext
  /** The signed-in balance, to flag a mode that costs more; null when unknown. */
  balance: number | null
  recommended?: TraceMode | null
}

/** Quick / Professional as a radio group: what each mode does and what it costs. */
export function TraceModeSelector({ value, onChange, context, balance, recommended = null }: TraceModeSelectorProps) {
  const { t, language } = useLanguage()
  const copy = t.workspace.modes
  const baseId = useId()
  const titleId = `${baseId}-title`
  const radioRefs = useRef<Record<TraceMode, HTMLButtonElement | null>>({ quick: null, professional: null })
  const locked = context === 'busy'

  const details: Record<TraceMode, { title: string; points: string[]; Icon: typeof Zap }> = {
    quick: { title: t.workspace.analysis.quickTraceTitle, points: copy.quickPoints, Icon: Zap },
    professional: { title: t.workspace.analysis.professionalTraceTitle, points: copy.professionalPoints, Icon: Sparkles },
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (locked) return
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if (!forward && !backward) return
    event.preventDefault()
    const index = MODES.indexOf(value)
    const next = MODES[(index + (forward ? 1 : MODES.length - 1)) % MODES.length]!
    onChange(next)
    radioRefs.current[next]?.focus()
  }

  const notes: Record<TraceModeContext, string> = {
    'next-upload': copy.nextUploadNote,
    retrace: copy.switchNote,
    retry: copy.retraceNote,
    busy: copy.busyNote,
    sample: copy.sampleNote,
  }

  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-subtle)] p-3">
      <p id={titleId} className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {copy.title}
      </p>
      <div role="radiogroup" aria-labelledby={titleId} aria-disabled={locked || undefined} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MODES.map((mode) => {
          const { title, points, Icon } = details[mode]
          const selected = value === mode
          const cost = TRACE_MODE_CREDITS[mode]
          const short = context !== 'sample' && balance !== null && balance < cost
          return (
            <button
              key={mode}
              ref={(element) => {
                radioRefs.current[mode] = element
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={locked || undefined}
              aria-labelledby={`${baseId}-${mode}-name ${baseId}-${mode}-cost`}
              aria-describedby={`${baseId}-${mode}-points`}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                if (!locked && !selected) onChange(mode)
              }}
              onKeyDown={onKeyDown}
              className={cn(
                'relative flex flex-col rounded-lg border p-3 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                selected
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)]',
                locked && 'cursor-not-allowed',
                locked && !selected && 'opacity-60',
              )}
            >
              {recommended === mode && (
                <span className="absolute -top-2 right-2 rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-white dark:text-[var(--bg)]">
                  {t.workspace.analysis.recommendedBadge}
                </span>
              )}
              <span className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-4 w-4 flex-none items-center justify-center rounded-full border-2',
                      selected ? 'border-[var(--accent)]' : 'border-[var(--border-strong)]',
                    )}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}
                  </span>
                  <span id={`${baseId}-${mode}-name`} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
                    <Icon size={14} className="text-[var(--accent)]" aria-hidden="true" />
                    {title}
                  </span>
                </span>
                <span
                  id={`${baseId}-${mode}-cost`}
                  className={cn(
                    'flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    selected ? 'bg-[var(--accent)] text-white dark:text-[var(--bg)]' : 'bg-[var(--bg-muted)] text-[var(--ink-muted)]',
                  )}
                >
                  {formatCredits(cost, language, t.credits.unit)}
                </span>
              </span>
              <span id={`${baseId}-${mode}-points`} className="mt-2 flex flex-col gap-1 pl-6 text-[11px] leading-snug text-[var(--ink-muted)]">
                {points.map((point) => (
                  <span key={point} className="flex items-start gap-1.5">
                    <Check size={12} className="mt-px flex-none text-[var(--accent)]" aria-hidden="true" />
                    {point}
                  </span>
                ))}
                {short && <span className="mt-1 font-semibold text-amber-700 dark:text-amber-400">{copy.notEnoughCredits}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--ink-muted)]">
        <Info size={12} className="mt-0.5 flex-none text-[var(--accent)]" aria-hidden="true" />
        {notes[context]}
      </p>
    </div>
  )
}
