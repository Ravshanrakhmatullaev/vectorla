import type { WorkspacePresetId, WorkspaceSettingId } from '@/data/i18n'

export interface WorkspaceSetting {
  id: WorkspaceSettingId
  value: number
  unit?: string
}

export const workspaceSettings: WorkspaceSetting[] = [
  { id: 'colors', value: 12 },
  { id: 'detail', value: 64, unit: '%' },
  { id: 'smoothness', value: 40, unit: '%' },
  { id: 'noiseRemoval', value: 20, unit: '%' },
  { id: 'curvePrecision', value: 80, unit: '%' },
]

export const workspacePresets: WorkspacePresetId[] = [
  'logo',
  'signature',
  'sketch',
  'icon',
  'qrCode',
  'blueprint',
]

export const recentFiles = ['brand-mark.png', 'signature-scan.jpg', 'sticker-design.png', 'cut-line.png']

export const exportFormats = ['SVG', 'PDF', 'DXF', 'EPS', 'PNG']
