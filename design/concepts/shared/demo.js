// Example account data for the prototypes' history and credit views. The
// conversions are real Vectorla traces (samples/); the dates and the ledger
// are illustrative and marked as example data in every concept. The ledger
// follows the product's rules: 10 signup credits, Quick 1, Professional 2,
// and switching modes refunds the earlier trace of the same image.
window.VL_DEMO = {
  today: '2026-10-14',
  conversions: [
    { sample: 'globe', mode: 'pro', date: '2026-10-11T16:20:00Z' },
    { sample: 'horse', mode: 'quick', date: '2026-10-09T10:05:00Z' },
    { sample: 'alpine-patch', mode: 'pro', date: '2026-10-07T14:42:00Z' },
    { sample: 'summit-logo', mode: 'quick', date: '2026-10-05T09:12:00Z' },
    { sample: 'crest', mode: 'pro', date: '2026-10-03T18:30:00Z' },
  ],
  ledger: [
    { amount: 1, reason: 'switchRefund', sample: 'globe', date: '2026-10-11T16:20:00Z' },
    { amount: -2, reason: 'trace', sample: 'globe', mode: 'pro', date: '2026-10-11T16:20:00Z' },
    { amount: -1, reason: 'trace', sample: 'globe', mode: 'quick', date: '2026-10-11T16:12:00Z' },
    { amount: -1, reason: 'trace', sample: 'horse', mode: 'quick', date: '2026-10-09T10:05:00Z' },
    { amount: -2, reason: 'trace', sample: 'alpine-patch', mode: 'pro', date: '2026-10-07T14:42:00Z' },
    { amount: -1, reason: 'trace', sample: 'summit-logo', mode: 'quick', date: '2026-10-05T09:12:00Z' },
    { amount: -2, reason: 'trace', sample: 'crest', mode: 'pro', date: '2026-10-03T18:30:00Z' },
    { amount: 10, reason: 'signup', date: '2026-10-02T08:00:00Z' },
  ],
}
window.VL_DEMO.balance = window.VL_DEMO.ledger.reduce((sum, entry) => sum + entry.amount, 0)
window.VL_DEMO.daysLeft = (iso) => Math.max(0, 30 - Math.floor((Date.parse(window.VL_DEMO.today) - Date.parse(iso.slice(0, 10))) / 86400000))
