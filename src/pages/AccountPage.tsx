import { useEffect } from 'react'
import { AlertTriangle, ArrowLeft, Coins, History, Info, LogIn, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Link } from '@/components/ui/Link'
import { useLanguage } from '@/lib/language'
import { useCredits } from '@/lib/useCredits'
import { requestAuthDialog } from '@/lib/authDialogEvents'
import { CREDIT_HISTORY_LIMIT } from '@/lib/api/credits'
import type { CreditTransaction } from '@/lib/api/types'
import { formatCredits } from '@/utils/formatCredits'
import { cn } from '@/utils/cn'
import type { Translation } from '@/data/i18n'

const CARD = 'rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 sm:p-6'

// The grant_key/reason the backend writes for the signup grant (migration 0002).
const SIGNUP_GRANT_REASON = 'Free signup credits'

function describe(transaction: CreditTransaction, reasons: Translation['credits']['reasons']): string {
  if (transaction.type === 'debit' && transaction.jobId) return reasons.trace
  if (transaction.type === 'refund') return reasons.refund
  if (transaction.type === 'credit' && transaction.reason === SIGNUP_GRANT_REASON) return reasons.signup
  return transaction.reason
}

function signedAmount(transaction: CreditTransaction): string {
  return `${transaction.type === 'debit' ? '−' : '+'}${transaction.amount}`
}

function HistorySkeleton() {
  return (
    <ul aria-hidden="true" className="divide-y divide-[var(--border)]">
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index} className="flex items-center justify-between gap-4 py-4">
          <div className="flex flex-col gap-2">
            <div className="h-3.5 w-32 animate-pulse rounded bg-[var(--bg-muted)]" />
            <div className="h-3 w-48 animate-pulse rounded bg-[var(--bg-muted)]" />
          </div>
          <div className="h-5 w-10 animate-pulse rounded bg-[var(--bg-muted)]" />
        </li>
      ))}
    </ul>
  )
}

/** /account — the signed-in user's credit balance and credit history (GET /credits). */
export function AccountPage() {
  const { t, language } = useLanguage()
  const credits = useCredits()
  const { status, balance, transactions, refresh } = credits
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })

  // Pick up anything that changed since the balance was last loaded.
  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <section className="px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          <ArrowLeft size={15} />
          {t.credits.backHome}
        </Link>

        <h1 className="mt-6 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--ink)] sm:text-4xl">
          {t.credits.pageTitle}
        </h1>
        <p className="mt-2 text-base text-[var(--ink-muted)]">{t.credits.pageDescription}</p>

        {status === 'unavailable' && (
          <div className={cn(CARD, 'mt-8 flex items-start gap-3 text-sm text-[var(--ink-muted)]')}>
            <Info size={18} className="mt-0.5 flex-none text-[var(--accent)]" />
            <p>{t.credits.notConfigured}</p>
          </div>
        )}

        {status === 'signed-out' && (
          <div className={cn(CARD, 'mt-8 flex flex-col items-center gap-3 py-10 text-center')}>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              <LogIn size={20} />
            </div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">{t.credits.signInTitle}</h2>
            <p className="max-w-sm text-sm text-[var(--ink-muted)]">{t.credits.signInDescription}</p>
            <Button className="mt-2" onClick={() => requestAuthDialog('sign-in')}>
              {t.credits.signIn}
            </Button>
          </div>
        )}

        {(status === 'loading' || status === 'ready' || status === 'error') && (
          <>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className={CARD}>
                <p className="flex items-center gap-2 text-sm font-medium text-[var(--ink-muted)]">
                  <Coins size={16} className="text-[var(--accent)]" />
                  {t.credits.balanceLabel}
                </p>
                {status === 'ready' && balance !== null ? (
                  <p className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-[var(--ink)]">
                    {formatCredits(balance, language, t.credits.unit)}
                  </p>
                ) : status === 'loading' ? (
                  <div aria-hidden="true" className="mt-3 h-10 w-40 animate-pulse rounded-lg bg-[var(--bg-muted)]" />
                ) : (
                  <p className="mt-3 text-4xl font-bold text-[var(--ink-faint)]">—</p>
                )}
              </div>

              <div className={CARD}>
                <p className="text-sm font-medium text-[var(--ink-muted)]">{t.credits.costsTitle}</p>
                <ul className="mt-3 flex flex-col gap-2 text-sm text-[var(--ink)]">
                  <li>{t.credits.costQuick}</li>
                  <li>{t.credits.costProfessional}</li>
                  <li className="text-[var(--ink-muted)]">{t.credits.costRefund}</li>
                </ul>
              </div>
            </div>

            <div className={cn(CARD, 'mt-4')} aria-busy={status === 'loading'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
                  <History size={18} className="text-[var(--accent)]" />
                  {t.credits.historyTitle}
                </h2>
                {status === 'ready' && transactions.length >= CREDIT_HISTORY_LIMIT && (
                  <p className="text-xs text-[var(--ink-faint)]">
                    {t.credits.historyLatest.replace('{count}', String(transactions.length))}
                  </p>
                )}
              </div>

              {status === 'loading' && <HistorySkeleton />}

              {status === 'error' && (
                <div role="alert" className="mt-4 flex flex-col items-start gap-3 rounded-xl bg-[var(--bg-subtle)] p-4 text-sm text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-500" />
                    {t.credits.loadError}
                  </p>
                  <Button variant="secondary" size="sm" onClick={refresh}>
                    <RefreshCcw size={13} />
                    {t.credits.retry}
                  </Button>
                </div>
              )}

              {status === 'ready' && transactions.length === 0 && (
                <div className="flex flex-col items-center gap-1 py-10 text-center">
                  <p className="text-sm font-semibold text-[var(--ink)]">{t.credits.historyEmpty}</p>
                  <p className="text-sm text-[var(--ink-muted)]">{t.credits.historyEmptyHint}</p>
                </div>
              )}

              {status === 'ready' && transactions.length > 0 && (
                <ul className="mt-2 divide-y divide-[var(--border)]">
                  {transactions.map((transaction) => (
                    <li key={transaction.id} className="flex items-center justify-between gap-4 py-3.5">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ink)]">
                          <span
                            className={cn(
                              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              transaction.type === 'debit'
                                ? 'bg-[var(--bg-muted)] text-[var(--ink-muted)]'
                                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
                            )}
                          >
                            {t.credits.types[transaction.type]}
                          </span>
                          <span className="truncate">{describe(transaction, t.credits.reasons)}</span>
                        </p>
                        <p className="mt-1 text-xs text-[var(--ink-faint)]">
                          <time dateTime={transaction.createdAt}>{dateFormat.format(new Date(transaction.createdAt))}</time>
                        </p>
                      </div>
                      <p
                        className={cn(
                          'flex-none font-mono text-base font-semibold tabular-nums',
                          transaction.type === 'debit' ? 'text-[var(--ink)]' : 'text-emerald-700 dark:text-emerald-400',
                        )}
                      >
                        {signedAmount(transaction)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
