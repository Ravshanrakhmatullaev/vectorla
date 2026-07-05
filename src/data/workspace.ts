export interface WorkspaceSetting {
  label: string
  value: number
  unit?: string
}

export const workspaceSettings: WorkspaceSetting[] = [
  { label: 'Colors', value: 12 },
  { label: 'Detail', value: 64, unit: '%' },
  { label: 'Smoothness', value: 40, unit: '%' },
  { label: 'Noise removal', value: 20, unit: '%' },
  { label: 'Curve precision', value: 80, unit: '%' },
]

export const workspacePresets = ['Logo', 'Signature', 'Sketch', 'Icon', 'QR Code', 'Blueprint']

export const recentFiles = ['brand-mark.png', 'signature-scan.jpg', 'sticker-design.png', 'cut-line.png']

export const exportFormats = ['SVG', 'PDF', 'DXF', 'EPS', 'PNG']
