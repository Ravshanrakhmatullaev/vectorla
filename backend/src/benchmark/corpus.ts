/**
 * Ground-truth vector corpus for the render-and-diff benchmark.
 *
 * Each case is a hand-authored SVG representing a real customer category.
 * The benchmark rasterizes it (anti-aliased, like any exported PNG/JPEG),
 * traces the raster, then renders the traced SVG back at 4x and compares it
 * with the ground truth rendered at 4x. Because the truth is a vector, this
 * measures what customers actually care about: does the result match the
 * original artwork when zoomed in — shape accuracy, corner sharpness, curve
 * smoothness, color fidelity, and no gaps between shapes.
 */

export interface BenchmarkVariant {
  /** Raster size (longest side) the ground truth is rendered at before tracing. */
  size: number
  format: 'png' | 'jpeg'
}

export interface BenchmarkCase {
  id: string
  category: string
  svg: string
  variants: BenchmarkVariant[]
}

const STANDARD: BenchmarkVariant[] = [
  { size: 128, format: 'png' },
  { size: 512, format: 'png' },
  { size: 512, format: 'jpeg' },
]

const svg = (body: string, w = 512, h = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

export const BENCHMARK_CORPUS: BenchmarkCase[] = [
  {
    id: 'flat-logo',
    category: 'logo',
    variants: STANDARD,
    svg: svg(`
      <rect width="512" height="512" fill="#ffffff"/>
      <circle cx="256" cy="220" r="150" fill="#1f4fd8"/>
      <polygon points="256,95 290,185 385,185 308,240 337,330 256,275 175,330 204,240 127,185 222,185" fill="#ffc21a"/>
      <rect x="96" y="400" width="320" height="56" rx="28" fill="#e2323c"/>
    `),
  },
  {
    id: 'wordmark',
    category: 'text',
    variants: [
      { size: 256, format: 'png' },
      { size: 768, format: 'png' },
      { size: 768, format: 'jpeg' },
    ],
    svg: svg(
      `
      <rect width="768" height="256" fill="#ffffff"/>
      <text x="384" y="150" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="120" fill="#111827">Vectorla</text>
      <text x="384" y="215" text-anchor="middle" font-family="DejaVu Sans" font-size="36" fill="#2563eb">raster to vector</text>
    `,
      768,
      256,
    ),
  },
  {
    id: 'line-icon',
    category: 'icon',
    variants: [
      { size: 64, format: 'png' },
      { size: 256, format: 'png' },
    ],
    svg: svg(`
      <rect width="512" height="512" fill="#ffffff"/>
      <g fill="none" stroke="#0f172a" stroke-width="28" stroke-linejoin="round" stroke-linecap="round">
        <path d="M96 240 L256 104 L416 240"/>
        <path d="M144 208 V408 H368 V208"/>
        <path d="M224 408 V304 H288 V408"/>
      </g>
    `),
  },
  {
    id: 'sticker',
    category: 'sticker',
    variants: [
      { size: 160, format: 'png' },
      { size: 512, format: 'png' },
    ],
    svg: svg(`
      <path d="M256 36 C392 36 476 120 476 256 C476 392 392 476 256 476 C120 476 36 392 36 256 C36 120 120 36 256 36 Z" fill="#ffffff"/>
      <path d="M256 66 C376 66 446 136 446 256 C446 376 376 446 256 446 C136 446 66 376 66 256 C66 136 136 66 256 66 Z" fill="#10b981"/>
      <path d="M170 270 L230 330 L350 190" fill="none" stroke="#ffffff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
    `),
  },
  {
    id: 'fine-detail',
    category: 'badge',
    variants: [
      { size: 256, format: 'png' },
      { size: 768, format: 'png' },
    ],
    svg: svg(`
      <rect width="512" height="512" fill="#fbf7ef"/>
      <circle cx="256" cy="256" r="200" fill="none" stroke="#7c2d12" stroke-width="10"/>
      <circle cx="256" cy="256" r="178" fill="none" stroke="#7c2d12" stroke-width="3"/>
      <circle cx="256" cy="256" r="120" fill="#7c2d12"/>
      <g fill="#7c2d12">
        ${Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * Math.PI * 2
          return `<circle cx="${(256 + Math.cos(a) * 152).toFixed(2)}" cy="${(256 + Math.sin(a) * 152).toFixed(2)}" r="6"/>`
        }).join('')}
      </g>
      <polygon points="256,166 277,226 340,226 289,262 308,322 256,286 204,322 223,262 172,226 235,226" fill="#fbf7ef"/>
    `),
  },
  {
    id: 'wedges',
    category: 'logo',
    variants: STANDARD,
    svg: svg(`
      <rect width="512" height="512" fill="#ffffff"/>
      ${['#e63c3c', '#f0a01e', '#e6dc28', '#32b45a', '#286edc', '#8c3cc8']
        .map((color, i) => {
          const a0 = (i / 6) * Math.PI * 2
          const a1 = ((i + 1) / 6) * Math.PI * 2
          const r = 210
          const x0 = (256 + Math.cos(a0) * r).toFixed(2)
          const y0 = (256 + Math.sin(a0) * r).toFixed(2)
          const x1 = (256 + Math.cos(a1) * r).toFixed(2)
          const y1 = (256 + Math.sin(a1) * r).toFixed(2)
          return `<path d="M256 256 L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z" fill="${color}"/>`
        })
        .join('')}
      <circle cx="256" cy="256" r="70" fill="#ffffff"/>
    `),
  },
  {
    id: 'mascot',
    category: 'illustration',
    variants: [
      { size: 200, format: 'png' },
      { size: 600, format: 'png' },
      { size: 600, format: 'jpeg' },
    ],
    svg: svg(`
      <rect width="512" height="512" fill="#dff3ff"/>
      <ellipse cx="256" cy="350" rx="150" ry="120" fill="#f59e0b" stroke="#1f2937" stroke-width="8"/>
      <circle cx="256" cy="190" r="110" fill="#fcd9b6" stroke="#1f2937" stroke-width="8"/>
      <circle cx="215" cy="180" r="16" fill="#1f2937"/>
      <circle cx="297" cy="180" r="16" fill="#1f2937"/>
      <circle cx="221" cy="174" r="5" fill="#ffffff"/>
      <circle cx="303" cy="174" r="5" fill="#ffffff"/>
      <path d="M210 232 Q256 270 302 232" fill="none" stroke="#1f2937" stroke-width="8" stroke-linecap="round"/>
      <ellipse cx="185" cy="220" rx="18" ry="10" fill="#f9a8a8"/>
      <ellipse cx="327" cy="220" rx="18" ry="10" fill="#f9a8a8"/>
    `),
  },
  {
    id: 'gradient-mark',
    category: 'gradient',
    variants: [{ size: 256, format: 'png' }],
    svg: svg(`
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff5f6d"/>
          <stop offset="1" stop-color="#ffc371"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" fill="#ffffff"/>
      <rect x="76" y="76" width="360" height="360" rx="80" fill="url(#g)"/>
      <circle cx="256" cy="256" r="90" fill="#ffffff"/>
    `),
  },
  {
    id: 'gradient-banner',
    category: 'gradient',
    variants: [
      { size: 384, format: 'png' },
      { size: 384, format: 'jpeg' },
    ],
    svg: svg(
      `
      <defs>
        <linearGradient id="b" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#4f46e5"/>
          <stop offset="0.5" stop-color="#db2777"/>
          <stop offset="1" stop-color="#f59e0b"/>
        </linearGradient>
      </defs>
      <rect width="768" height="384" fill="#ffffff"/>
      <rect x="32" y="32" width="704" height="320" rx="40" fill="url(#b)"/>
      <circle cx="384" cy="192" r="92" fill="#ffffff"/>
      <rect x="344" y="152" width="80" height="80" rx="12" fill="#111827"/>
    `,
      768,
      384,
    ),
  },
  {
    id: 'radial-glow',
    category: 'gradient',
    variants: [{ size: 256, format: 'png' }],
    svg: svg(`
      <defs>
        <radialGradient id="r" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fde047"/>
          <stop offset="1" stop-color="#ea580c"/>
        </radialGradient>
      </defs>
      <rect width="512" height="512" fill="#0f172a"/>
      <circle cx="256" cy="256" r="200" fill="url(#r)"/>
    `),
  },
  {
    id: 'qr-like',
    category: 'qr',
    variants: [{ size: 256, format: 'png' }],
    svg: (() => {
      let seed = 7
      const rnd = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
      }
      const cells: string[] = []
      const N = 25
      const s = 512 / (N + 4)
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const finder = (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7)
          let on = rnd() > 0.5
          if (finder) {
            const fx = x < 7 ? x : x - (N - 7)
            const fy = y < 7 ? y : y - (N - 7)
            const ring = Math.max(Math.abs(fx - 3), Math.abs(fy - 3))
            on = ring !== 2
          }
          // One path for all modules: separate abutting <rect>s would render
          // with anti-aliasing seams between them in the ground truth itself.
          if (on) cells.push(`M${((x + 2) * s).toFixed(3)} ${((y + 2) * s).toFixed(3)}h${s.toFixed(3)}v${s.toFixed(3)}h-${s.toFixed(3)}z`)
        }
      }
      return svg(`<rect width="512" height="512" fill="#ffffff"/><path fill="#000000" d="${cells.join('')}"/>`)
    })(),
  },
  {
    id: 'blueprint',
    category: 'lineart',
    variants: [{ size: 512, format: 'png' }],
    svg: svg(`
      <rect width="512" height="512" fill="#ffffff"/>
      <g fill="none" stroke="#1e3a8a" stroke-width="4">
        <rect x="60" y="80" width="392" height="300"/>
        <line x1="60" y1="80" x2="452" y2="380"/>
        <circle cx="256" cy="230" r="90"/>
        <path d="M100 440 H412 M100 430 V450 M412 430 V450"/>
      </g>
    `),
  },
  {
    id: 'signature',
    category: 'signature',
    variants: [{ size: 384, format: 'png' }],
    svg: svg(`
      <path d="M60 330 C90 200 150 160 170 230 C185 290 120 350 150 330 C200 290 230 180 260 200 C290 220 250 330 290 310 C330 290 340 240 380 250 C410 260 400 300 450 280"
        fill="none" stroke="#0b1f5c" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
    `),
  },
]
