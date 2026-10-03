import type { LucideIcon } from 'lucide-react'
import { MonitorSmartphone, FileCode2, Lock, Zap } from 'lucide-react'
import type { TrustBadgeId } from '@/data/i18n'

export interface TrustBadge {
  id: TrustBadgeId
  icon: LucideIcon
}

export const trustBadges: TrustBadge[] = [
  { id: 'browserBased', icon: MonitorSmartphone },
  { id: 'svgExport', icon: FileCode2 },
  { id: 'privateProcessing', icon: Lock },
  { id: 'fastPreview', icon: Zap },
]
