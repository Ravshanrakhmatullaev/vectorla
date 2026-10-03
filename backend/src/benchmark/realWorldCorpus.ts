/**
 * Real-world benchmark corpus (in addition to the core corpus in corpus.ts).
 *
 * Two kinds of cases:
 *  - Ground-truth vector cases (`svg`): rendered to a raster, optionally
 *    degraded (blur, heavy JPEG, tiny size), traced, and diffed against the
 *    vector at 4x — exactly like the core corpus.
 *  - Raster-only cases (`raster`): real photographs and scans with no vector
 *    truth. They are traced and the result is compared with the source
 *    raster at its own size, which measures fidelity, not "correctness".
 *
 * Every asset is legally usable; see assets/SOURCES.md:
 *  - assets/fluent/*.svg — Microsoft Fluent Emoji, MIT License.
 *  - Lucide icons below — ISC License, (c) Lucide Icons and Contributors.
 *  - assets/photos/* — scikit-image sample data, public domain / CC0.
 *  - Everything else is authored for this benchmark.
 */
import type { BenchmarkVariant } from './corpus'

export interface RealWorldCase {
  id: string
  category: 'logo' | 'text' | 'icon' | 'illustration' | 'gradient' | 'thin-lines' | 'intricate' | 'geometric' | 'photo' | 'scan'
  /** Ground-truth SVG markup, or a file under src/benchmark/assets/ (".svg"). */
  svg?: string
  svgFile?: string
  /** Raster-only source under src/benchmark/assets/ (no vector truth). */
  raster?: string
  variants: BenchmarkVariant[]
}

const PNG = (size: number, extra: Partial<BenchmarkVariant> = {}): BenchmarkVariant => ({ size, format: 'png', ...extra })
const JPG = (size: number, extra: Partial<BenchmarkVariant> = {}): BenchmarkVariant => ({ size, format: 'jpeg', ...extra })
const ORIGINAL: BenchmarkVariant[] = [{ size: 0, format: 'png' }]

const svg = (body: string, w = 512, h = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

// Lucide icons (ISC License, Copyright (c) Lucide Icons and Contributors).
// Stroked line icons on a transparent background, in a dark ink color.
const lucide = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

const LUCIDE: Record<string, string> = {
  camera:
    '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  settings:
    '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  'shopping-cart':
    '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  heart:
    '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
}

const ornamentPetals = Array.from({ length: 24 }, (_, i) => `<ellipse cx="256" cy="120" rx="14" ry="64" transform="rotate(${i * 15} 256 256)" fill="#7c2d92"/>`).join('')
const ornamentDots = Array.from({ length: 36 }, (_, i) => {
  const a = (i * 10 * Math.PI) / 180
  return `<circle cx="${(256 + 210 * Math.cos(a)).toFixed(1)}" cy="${(256 + 210 * Math.sin(a)).toFixed(1)}" r="6" fill="#e0a526"/>`
}).join('')

const hexagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => `${(cx + r * Math.cos((Math.PI / 3) * i)).toFixed(2)},${(cy + r * Math.sin((Math.PI / 3) * i)).toFixed(2)}`).join(' ')
const MOSAIC_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#111827']
const mosaic = (() => {
  const parts: string[] = []
  let k = 0
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = 48 + col * 84 + (row % 2) * 42
      const cy = 56 + row * 96
      parts.push(`<polygon points="${hexagon(cx, cy, 48)}" fill="${MOSAIC_COLORS[k++ % MOSAIC_COLORS.length]}"/>`)
    }
  }
  return parts.join('')
})()

export const REAL_WORLD_CORPUS: RealWorldCase[] = [
  // --- Illustrations and cartoons (Fluent Emoji Flat): flat colors, transparent background.
  { id: 'emoji-grinning', category: 'illustration', svgFile: 'fluent/grinning_face_flat.svg', variants: [PNG(256), PNG(64), JPG(256)] },
  { id: 'emoji-rocket', category: 'illustration', svgFile: 'fluent/rocket_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-apple', category: 'illustration', svgFile: 'fluent/red_apple_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-cat', category: 'illustration', svgFile: 'fluent/cat_face_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-fox', category: 'illustration', svgFile: 'fluent/fox_flat.svg', variants: [PNG(256), PNG(256, { blur: 1.2 })] },
  { id: 'emoji-rainbow', category: 'illustration', svgFile: 'fluent/rainbow_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-house', category: 'illustration', svgFile: 'fluent/house_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-pizza', category: 'illustration', svgFile: 'fluent/pizza_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-unicorn', category: 'illustration', svgFile: 'fluent/unicorn_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-butterfly', category: 'illustration', svgFile: 'fluent/butterfly_flat.svg', variants: [PNG(256)] },
  { id: 'emoji-teacup', category: 'illustration', svgFile: 'fluent/teacup_without_handle_flat.svg', variants: [PNG(256)] },

  // --- Gradients and soft shading (Fluent Emoji Color): many linear/radial gradients, some blur filters.
  { id: 'emoji3d-grinning', category: 'gradient', svgFile: 'fluent/grinning_face_color.svg', variants: [PNG(256)] },
  { id: 'emoji3d-apple', category: 'gradient', svgFile: 'fluent/red_apple_color.svg', variants: [PNG(256)] },
  { id: 'emoji3d-rocket', category: 'gradient', svgFile: 'fluent/rocket_color.svg', variants: [PNG(256)] },
  { id: 'emoji3d-sun', category: 'gradient', svgFile: 'fluent/sun_with_face_color.svg', variants: [PNG(256)] },
  { id: 'emoji3d-bulb', category: 'gradient', svgFile: 'fluent/light_bulb_color.svg', variants: [PNG(256), JPG(256)] },
  { id: 'emoji3d-globe', category: 'gradient', svgFile: 'fluent/globe_showing_americas_color.svg', variants: [PNG(256)] },

  // --- Line icons (Lucide): 2 px strokes; 48 px is a realistic tiny favicon-sized upload.
  ...Object.entries(LUCIDE).map(
    ([name, body]): RealWorldCase => ({ id: `icon-${name}`, category: 'icon', svg: lucide(body), variants: [PNG(48), PNG(192)] }),
  ),

  // --- Logos.
  {
    id: 'logo-complex',
    category: 'logo',
    variants: [PNG(128), PNG(512), JPG(512, { quality: 40 }), PNG(256, { blur: 1.5 })],
    svg: svg(`
      <rect width="512" height="512" fill="#ffffff"/>
      <circle cx="256" cy="230" r="170" fill="none" stroke="#0b3d91" stroke-width="22"/>
      <circle cx="256" cy="230" r="138" fill="#e9f0ff"/>
      <path d="M150 300 L230 150 L280 240 L310 195 L370 300 Z" fill="#0b3d91"/>
      <path d="M150 300 L230 150 L250 188 L205 300 Z" fill="#1d6fe0"/>
      <circle cx="330" cy="150" r="26" fill="#f6b100"/>
      <path d="M120 330 Q256 380 392 330" fill="none" stroke="#f6b100" stroke-width="4"/>
      <text x="256" y="455" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="54" fill="#0b3d91">SUMMIT</text>
      <text x="256" y="490" text-anchor="middle" font-family="DejaVu Sans" font-size="22" fill="#4b5563">outdoor equipment co.</text>
    `),
  },

  // --- Typography.
  {
    id: 'typo-serif',
    category: 'text',
    variants: [PNG(1024), PNG(512)],
    svg: svg(
      `
      <rect width="1024" height="512" fill="#fdf6e3"/>
      <text x="64" y="120" font-family="DejaVu Serif" font-weight="bold" font-size="72" fill="#1b1b1b">Quarterly Review</text>
      <text x="64" y="200" font-family="DejaVu Serif" font-size="30" fill="#1b1b1b">The quick brown fox jumps over the lazy dog,</text>
      <text x="64" y="245" font-family="DejaVu Serif" font-size="30" fill="#1b1b1b">while sphinx of black quartz judges my vow.</text>
      <text x="64" y="320" font-family="DejaVu Serif" font-style="italic" font-size="26" fill="#9a3412">Typography with serifs, italics and fine detail — 0123456789</text>
      <text x="64" y="400" font-family="DejaVu Sans" font-size="18" fill="#374151">Small print: 18 px sans-serif text should stay legible after tracing.</text>
    `,
      1024,
      512,
    ),
  },
  {
    id: 'typo-inverse',
    category: 'text',
    variants: [PNG(768), JPG(768)],
    svg: svg(
      `
      <rect width="768" height="384" fill="#0f172a"/>
      <text x="384" y="170" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="110" fill="#ffffff">NIGHT</text>
      <text x="384" y="250" text-anchor="middle" font-family="DejaVu Sans" font-size="40" fill="#38bdf8" transform="rotate(-6 384 250)">market &amp; café</text>
      <rect x="160" y="300" width="448" height="6" fill="#facc15"/>
    `,
      768,
      384,
    ),
  },

  // --- Thin lines and hairlines.
  {
    id: 'thin-lines',
    category: 'thin-lines',
    variants: [PNG(512), PNG(256)],
    svg: svg(`
      <rect width="512" height="512" fill="#ffffff"/>
      <g stroke="#111827" fill="none">
        <line x1="32" y1="40" x2="480" y2="40" stroke-width="1"/>
        <line x1="32" y1="70" x2="480" y2="70" stroke-width="2"/>
        <line x1="32" y1="100" x2="480" y2="100" stroke-width="3"/>
        <line x1="32" y1="140" x2="480" y2="260" stroke-width="2"/>
        <line x1="32" y1="260" x2="480" y2="140" stroke-width="1.5"/>
        <line x1="60" y1="290" x2="140" y2="480" stroke-width="2"/>
        <circle cx="330" cy="380" r="100" stroke-width="1.5"/>
        <circle cx="330" cy="380" r="70" stroke-width="2"/>
        <circle cx="330" cy="380" r="40" stroke-width="3"/>
      </g>
      <g stroke="#2563eb" stroke-width="1">
        <path d="M170 300 V480 M190 300 V480 M210 300 V480 M170 300 H210 M170 340 H210 M170 380 H210 M170 420 H210 M170 460 H210"/>
      </g>
    `),
  },

  // --- Intricate detail.
  {
    id: 'ornament',
    category: 'intricate',
    variants: [PNG(512), PNG(160)],
    svg: svg(`
      <rect width="512" height="512" fill="#fffbeb"/>
      ${ornamentPetals}
      <circle cx="256" cy="256" r="70" fill="#fffbeb"/>
      <circle cx="256" cy="256" r="52" fill="#e0a526"/>
      <circle cx="256" cy="256" r="20" fill="#7c2d92"/>
      ${ornamentDots}
    `),
  },

  // --- Geometric shapes with many 3-color junctions.
  { id: 'hex-mosaic', category: 'geometric', variants: [PNG(512), JPG(512)], svg: svg(`<rect width="512" height="512" fill="#ffffff"/>${mosaic}`) },

  // --- Photographs and scans (raster-only: no vector truth).
  { id: 'photo-astronaut', category: 'photo', raster: 'photos/astronaut.jpg', variants: ORIGINAL },
  { id: 'photo-coffee', category: 'photo', raster: 'photos/coffee.jpg', variants: ORIGINAL },
  { id: 'photo-chelsea', category: 'photo', raster: 'photos/chelsea.jpg', variants: ORIGINAL },
  { id: 'photo-rocket', category: 'photo', raster: 'photos/rocket.jpg', variants: ORIGINAL },
  { id: 'photo-camera', category: 'photo', raster: 'photos/camera.jpg', variants: ORIGINAL },
  { id: 'photo-coins', category: 'photo', raster: 'photos/coins.jpg', variants: ORIGINAL },
  { id: 'scan-horse', category: 'scan', raster: 'photos/horse.png', variants: ORIGINAL },
  { id: 'scan-text', category: 'scan', raster: 'photos/text.png', variants: ORIGINAL },
]
