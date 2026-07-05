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

export interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

export const features: Feature[] = [
  {
    icon: Sparkles,
    title: 'AI Logo Trace',
    description: 'Clean, print-ready logo vectorization tuned for flat colors and sharp edges.',
  },
  {
    icon: QrCode,
    title: 'AI QR Vectorizer',
    description: 'Perfectly scannable QR codes converted to crisp, infinitely scalable vectors.',
  },
  {
    icon: PenTool,
    title: 'Signature to SVG',
    description: 'Turn a scanned signature into a smooth, single-color vector stroke.',
  },
  {
    icon: Pencil,
    title: 'Sketch to Vector',
    description: 'Preserve the hand-drawn character of sketches while cleaning up stray noise.',
  },
  {
    icon: FileCheck2,
    title: 'Print-Ready SVG',
    description: 'Output validated for CMYK workflows, clean paths, and production print.',
  },
  {
    icon: Scissors,
    title: 'CNC / Laser DXF Export',
    description: 'Export cut-ready DXF files for laser cutters and CNC machines.',
  },
  {
    icon: Layers,
    title: 'Batch Vectorization',
    description: 'Process entire folders of images in one queue, download results as a single archive.',
  },
  {
    icon: Wand2,
    title: 'SVG Optimizer',
    description: 'Merge redundant paths and reduce node count without losing visual fidelity.',
  },
  {
    icon: Palette,
    title: 'Color Reduction',
    description: 'Control exact color counts for cleaner separations and simpler print jobs.',
  },
  {
    icon: Eraser,
    title: 'Background Cleanup',
    description: 'Automatically detect and remove background noise before tracing.',
  },
]
