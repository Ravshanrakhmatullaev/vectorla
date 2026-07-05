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
import type { UseCaseId } from '@/data/i18n'

export interface UseCase {
  id: UseCaseId
  icon: LucideIcon
}

export const useCases: UseCase[] = [
  { id: 'designers', icon: PenSquare },
  { id: 'printShops', icon: Printer },
  { id: 'advertisingAgencies', icon: Megaphone },
  { id: 'cncLaserCutting', icon: Cpu },
  { id: 'stickerProduction', icon: Sticker },
  { id: 'uvPrinting', icon: Droplets },
  { id: 'dtfTextilePrinting', icon: Shirt },
  { id: 'logoCleanup', icon: Eraser },
  { id: 'qrCodeVectorization', icon: QrCode },
]
