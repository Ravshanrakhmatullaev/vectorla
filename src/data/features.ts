import type { LucideIcon } from 'lucide-react'
import {
  Palette,
  Spline,
  Combine,
  Blend,
  Eraser,
  Sparkles,
  QrCode,
  PenTool,
  Pencil,
  FileCode2,
} from 'lucide-react'
import type { FeatureId } from '@/data/i18n'

export interface Feature {
  id: FeatureId
  icon: LucideIcon
}

export const features: Feature[] = [
  { id: 'multiColorTrace', icon: Palette },
  { id: 'smoothCurves', icon: Spline },
  { id: 'gaplessShapes', icon: Combine },
  { id: 'gradients', icon: Blend },
  { id: 'jpegCleanup', icon: Eraser },
  { id: 'professionalTrace', icon: Sparkles },
  { id: 'qrPixelArt', icon: QrCode },
  { id: 'signatureToSvg', icon: PenTool },
  { id: 'sketchToVector', icon: Pencil },
  { id: 'editableSvg', icon: FileCode2 },
]
