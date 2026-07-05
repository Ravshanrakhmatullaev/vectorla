import type { LucideIcon } from 'lucide-react'
import { MonitorSmartphone, Printer, FileCode2, Lock, Zap } from 'lucide-react'

export interface TrustBadge {
  icon: LucideIcon
  label: string
}

export const trustBadges: TrustBadge[] = [
  { icon: MonitorSmartphone, label: 'Browser-based' },
  { icon: Printer, label: 'Print-ready' },
  { icon: FileCode2, label: 'SVG export' },
  { icon: Lock, label: 'Private processing' },
  { icon: Zap, label: 'Fast preview' },
]
