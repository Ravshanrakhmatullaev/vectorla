import type { LucideIcon } from 'lucide-react'
import {
  Sparkles,
  QrCode,
  PenTool,
  Pencil,
  FileCheck2,
  Scissors,
  Layers,
  Wand2,
  Palette,
  Eraser,
} from 'lucide-react'
import type { FeatureId } from '@/data/i18n'

export interface Feature {
  id: FeatureId
  icon: LucideIcon
}

export const features: Feature[] = [
  { id: 'aiLogoTrace', icon: Sparkles },
  { id: 'aiQrVectorizer', icon: QrCode },
  { id: 'signatureToSvg', icon: PenTool },
  { id: 'sketchToVector', icon: Pencil },
  { id: 'printReadySvg', icon: FileCheck2 },
  { id: 'cncLaserDxfExport', icon: Scissors },
  { id: 'batchVectorization', icon: Layers },
  { id: 'svgOptimizer', icon: Wand2 },
  { id: 'colorReduction', icon: Palette },
  { id: 'backgroundCleanup', icon: Eraser },
]
