import type { LucideIcon } from 'lucide-react'
import {
  PenSquare,
  Printer,
  Megaphone,
  Cpu,
  Sticker,
  Droplets,
  Shirt,
  Eraser,
  QrCode,
} from 'lucide-react'

export interface UseCase {
  icon: LucideIcon
  title: string
  description: string
}

export const useCases: UseCase[] = [
  {
    icon: PenSquare,
    title: 'Designers',
    description: 'Turn raster references and rough concepts into editable, layered vector artwork.',
  },
  {
    icon: Printer,
    title: 'Print Shops',
    description: 'Prepare production-ready files with clean paths and predictable output every time.',
  },
  {
    icon: Megaphone,
    title: 'Advertising Agencies',
    description: 'Convert client logos and assets quickly without waiting on a designer.',
  },
  {
    icon: Cpu,
    title: 'CNC & Laser Cutting',
    description: 'Export precise DXF cut lines straight from a photo or scanned drawing.',
  },
  {
    icon: Sticker,
    title: 'Sticker Production',
    description: 'Generate clean cut-contours ready for die-cut or kiss-cut sticker printing.',
  },
  {
    icon: Droplets,
    title: 'UV Printing',
    description: 'Get crisp vector layers suited for UV printers and textured substrates.',
  },
  {
    icon: Shirt,
    title: 'DTF / Textile Printing',
    description: 'Vectorize artwork for direct-to-film and textile transfer workflows.',
  },
  {
    icon: Eraser,
    title: 'Logo Cleanup',
    description: 'Rebuild a low-resolution or damaged logo into a crisp, scalable master file.',
  },
  {
    icon: QrCode,
    title: 'QR Code Vectorization',
    description: 'Guarantee scannability at any print size with true vector QR codes.',
  },
]
