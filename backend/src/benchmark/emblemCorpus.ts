/**
 * Adversarial corpus: complex emblems, crests, badges and seals — the class
 * of artwork where a customer compared Vectorla with Vectorizer.AI and found
 * text, shield contours, small symbols and shading lost (2026-10-10).
 *
 * Every case is original artwork authored here (no third-party marks), so
 * the ground truth is exact: circular and banner text, thin rings and
 * hatching, dozens of small leaves/stars/jewels, metallic and bevel
 * gradients, stroked text. Rendered with system fonts (DejaVu), like the
 * core corpus.
 */
import type { BenchmarkVariant } from './corpus'

export interface EmblemCase {
  id: string
  category: string
  svg: string
  variants: BenchmarkVariant[]
  /** Regions (fractions of width/height: x0, y0, x1, y1) inspected in the visual report. */
  crops: Record<string, [number, number, number, number]>
}

/** 600 px (upsampled), 1200 px PNG and JPEG, 2000 px (4 MP, the API's largest upload). */
const EMBLEM_VARIANTS: BenchmarkVariant[] = [
  { size: 600, format: 'png' },
  { size: 1200, format: 'png' },
  { size: 1200, format: 'jpeg', quality: 85 },
  { size: 2000, format: 'png' },
]

const svg = (defs: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="1000" viewBox="0 0 1000 1000"><defs>${defs}</defs>${body}</svg>`

const f = (v: number) => Math.round(v * 10) / 10

/** An n-pointed star polygon. */
function star(cx: number, cy: number, outer: number, inner: number, fill: string, points = 5, rotate = -90): string {
  const pts: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = ((rotate + (i * 180) / points) * Math.PI) / 180
    pts.push(`${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`
}

/** Leaves along an arc (degrees, 0 = +x, clockwise since y points down), alternating sides. */
function laurel(cx: number, cy: number, radius: number, from: number, to: number, count: number, fill: string, rx = 18, ry = 7): string {
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const deg = from + ((to - from) * i) / (count - 1)
    const a = (deg * Math.PI) / 180
    const side = i % 2 === 0 ? 1 : -1
    const r = radius + side * 13
    const x = cx + r * Math.cos(a)
    const y = cy + r * Math.sin(a)
    const tangent = deg + 90 + side * 35 * Math.sign(to - from)
    out.push(`<ellipse cx="${f(x)}" cy="${f(y)}" rx="${rx}" ry="${ry}" transform="rotate(${f(tangent)} ${f(x)} ${f(y)})" fill="${fill}"/>`)
  }
  out.push(`<path d="M ${f(cx + radius * Math.cos((from * Math.PI) / 180))} ${f(cy + radius * Math.sin((from * Math.PI) / 180))} A ${radius} ${radius} 0 0 ${to > from ? 1 : 0} ${f(cx + radius * Math.cos((to * Math.PI) / 180))} ${f(cy + radius * Math.sin((to * Math.PI) / 180))}" fill="none" stroke="${fill}" stroke-width="4"/>`)
  return out.join('')
}

/** Text along an arc: 'top' reads left to right over the top, 'bottom' upright along the bottom. */
function arcText(id: string, cx: number, cy: number, r: number, side: 'top' | 'bottom', text: string, attrs: string): { def: string; body: string } {
  const d = side === 'top' ? `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}` : `M ${cx - r} ${cy} A ${r} ${r} 0 0 0 ${cx + r} ${cy}`
  return {
    def: `<path id="${id}" d="${d}"/>`,
    body: `<text ${attrs}><textPath xlink:href="#${id}" href="#${id}" startOffset="50%" text-anchor="middle">${text}</textPath></text>`,
  }
}

const SERIF = 'font-family="DejaVu Serif" font-weight="bold"'
const SANS = 'font-family="DejaVu Sans" font-weight="bold"'

// --- 1. Two-colour company seal with circular text, laurel and a shield. ---
const sealTop = arcText('sealTop', 500, 500, 365, 'top', 'VECTORLA TRADING CO.', `${SERIF} font-size="58" letter-spacing="5" fill="#d4af37"`)
const sealBottom = arcText('sealBottom', 500, 500, 392, 'bottom', 'TASHKENT • UZBEKISTAN', `${SERIF} font-size="48" letter-spacing="4" fill="#d4af37"`)
const SEAL = svg(
  sealTop.def + sealBottom.def,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  <circle cx="500" cy="500" r="490" fill="#1b2a4a"/>
  <circle cx="500" cy="500" r="470" fill="none" stroke="#d4af37" stroke-width="8"/>
  <circle cx="500" cy="500" r="455" fill="none" stroke="#d4af37" stroke-width="3"/>
  ${sealTop.body}${sealBottom.body}
  ${star(128, 500, 22, 9, '#d4af37')}${star(872, 500, 22, 9, '#d4af37')}
  <circle cx="500" cy="500" r="318" fill="none" stroke="#d4af37" stroke-width="6"/>
  <circle cx="500" cy="500" r="305" fill="#f7f1e1"/>
  ${laurel(500, 500, 262, 105, 205, 15, '#2f6b3a')}${laurel(500, 500, 262, 75, -25, 15, '#2f6b3a')}
  <path d="M 500 285 L 640 335 L 626 515 Q 602 635 500 695 Q 398 635 374 515 L 360 335 Z" fill="#1b2a4a"/>
  <path d="M 500 305 L 622 349 L 609 512 Q 588 618 500 671 Q 412 618 391 512 L 378 349 Z" fill="none" stroke="#d4af37" stroke-width="5"/>
  <polygon points="500,420 590,500 590,545 500,465 410,545 410,500" fill="#d4af37"/>
  <polygon points="500,500 590,580 590,610 500,530 410,610 410,580" fill="#d4af37"/>
  ${star(500, 375, 30, 12, '#d4af37')}
  <text x="500" y="760" ${SERIF} font-size="34" letter-spacing="3" text-anchor="middle" fill="#1b2a4a">EST. 1998</text>`,
)

// --- 2. Heraldic crest: metallic gold border, shaded field, eagle, crown, motto banner. ---
const crestMotto = arcText('crestMotto', 500, 262, 640, 'bottom', 'FORTITUDO ET HONOR', `${SERIF} font-size="42" letter-spacing="3" fill="#5a1a10"`)
const eagleWing = (dir: 1 | -1) => {
  const pts = [
    [0, 0], [60, -40], [120, -95], [150, -150], [128, -112], [118, -80], [92, -98], [100, -60], [70, -70], [78, -30], [48, -36], [44, 6], [12, 22],
  ].map(([x, y]) => `${f(500 + dir * x!)},${f(520 + y!)}`)
  return `<polygon points="${pts.join(' ')}" fill="url(#gold)" stroke="#5c430e" stroke-width="2"/>`
}
const CREST = svg(
  `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5a14"/><stop offset="0.22" stop-color="#f6e27a"/><stop offset="0.5" stop-color="#b8892b"/><stop offset="0.75" stop-color="#f3d77a"/><stop offset="1" stop-color="#6e4f12"/></linearGradient>
  <radialGradient id="red" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#e0434c"/><stop offset="1" stop-color="#6e0f16"/></radialGradient>
  <radialGradient id="blue" cx="0.6" cy="0.35" r="0.75"><stop offset="0" stop-color="#3466d0"/><stop offset="1" stop-color="#0f2457"/></radialGradient>
  <linearGradient id="parchment" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7ecd0"/><stop offset="1" stop-color="#d6bb83"/></linearGradient>
  <clipPath id="leftHalf"><rect x="0" y="0" width="500" height="1000"/></clipPath>
  ${crestMotto.def}`,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  <path d="M 242 214 L 782 214 L 772 554 Q 752 754 512 874 Q 272 754 252 554 Z" fill="#000000" opacity="0.22"/>
  <path d="M 230 200 L 770 200 L 760 540 Q 740 740 500 860 Q 260 740 240 540 Z" fill="url(#gold)"/>
  <path d="M 262 232 L 738 232 L 729 536 Q 711 716 500 826 Q 289 716 271 536 Z" fill="url(#blue)"/>
  <path d="M 262 232 L 738 232 L 729 536 Q 711 716 500 826 Q 289 716 271 536 Z" fill="url(#red)" clip-path="url(#leftHalf)"/>
  <ellipse cx="330" cy="300" rx="60" ry="22" fill="#ffffff" opacity="0.28" transform="rotate(-20 330 300)"/>
  ${star(330, 300, 24, 10, '#f3d77a')}${star(500, 280, 24, 10, '#f3d77a')}${star(670, 300, 24, 10, '#f3d77a')}
  ${eagleWing(1)}${eagleWing(-1)}
  <ellipse cx="500" cy="520" rx="34" ry="70" fill="url(#gold)" stroke="#5c430e" stroke-width="2"/>
  <circle cx="500" cy="438" r="22" fill="url(#gold)" stroke="#5c430e" stroke-width="2"/>
  <polygon points="518,432 546,440 518,448" fill="#c8961e"/>
  <polygon points="470,590 500,640 530,590 515,600 500,585 485,600" fill="url(#gold)" stroke="#5c430e" stroke-width="2"/>
  <path d="M 420 700 h 30 v -18 h 20 v 18 h 30 v 20 h -30 v 40 h -20 v -40 h -30 Z" fill="#f3d77a" transform="translate(-60 -20) scale(0.8) translate(110 160)"/>
  <path d="M 420 700 h 30 v -18 h 20 v 18 h 30 v 20 h -30 v 40 h -20 v -40 h -30 Z" fill="#f3d77a" transform="translate(110 -20) scale(0.8) translate(110 160)"/>
  <path d="M 350 200 L 330 120 L 400 160 L 450 90 L 500 150 L 550 90 L 600 160 L 670 120 L 650 200 Z" fill="url(#gold)" stroke="#5c430e" stroke-width="3"/>
  <circle cx="400" cy="178" r="10" fill="#b3202a"/><circle cx="500" cy="176" r="12" fill="#1d3f8f"/><circle cx="600" cy="178" r="10" fill="#2f7d3a"/>
  <circle cx="450" cy="90" r="9" fill="#f6e27a"/><circle cx="550" cy="90" r="9" fill="#f6e27a"/><circle cx="330" cy="120" r="8" fill="#f6e27a"/><circle cx="670" cy="120" r="8" fill="#f6e27a"/>
  <path d="M 130 860 L 230 830 L 200 880 L 230 930 L 140 920 Z" fill="#b89a5c"/><path d="M 870 860 L 770 830 L 800 880 L 770 930 L 860 920 Z" fill="#b89a5c"/>
  <path d="M 190 830 Q 500 930 810 830 L 830 900 Q 500 1000 170 900 Z" fill="url(#parchment)" stroke="#6e4f12" stroke-width="3"/>
  ${crestMotto.body}`,
)

// --- 3. Round metal badge: silver radial gradient, bevel ring, rosette edge, small circular text. ---
const badgeTop = arcText('badgeTop', 500, 500, 392, 'top', 'CERTIFIED QUALITY • PREMIUM', `${SANS} font-size="40" letter-spacing="3" fill="#ffffff"`)
const badgeBottom = arcText('badgeBottom', 500, 500, 420, 'bottom', '• SERVICE SINCE 2010 •', `${SANS} font-size="36" letter-spacing="3" fill="#ffffff"`)
const BADGE = svg(
  `<radialGradient id="silver" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#d9dde3"/><stop offset="0.85" stop-color="#8c939d"/><stop offset="1" stop-color="#5b616b"/></radialGradient>
  <linearGradient id="bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdfdfd"/><stop offset="1" stop-color="#5f6670"/></linearGradient>
  <radialGradient id="disk" cx="0.45" cy="0.4" r="0.65"><stop offset="0" stop-color="#3a7bd5"/><stop offset="1" stop-color="#0b2a6b"/></radialGradient>
  <linearGradient id="goldText" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset="0.55" stop-color="#d4a017"/><stop offset="1" stop-color="#8a6508"/></linearGradient>
  ${badgeTop.def}${badgeBottom.def}`,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  ${star(500, 500, 498, 470, 'url(#silver)', 48, 0)}
  <circle cx="500" cy="500" r="462" fill="none" stroke="url(#bevel)" stroke-width="16"/>
  <circle cx="500" cy="500" r="450" fill="url(#disk)"/>
  <circle cx="500" cy="500" r="438" fill="none" stroke="#c9d3e6" stroke-width="2"/>
  ${badgeTop.body}${badgeBottom.body}
  <circle cx="500" cy="500" r="330" fill="none" stroke="#ffffff" stroke-width="3"/>
  <circle cx="500" cy="500" r="318" fill="none" stroke="#ffffff" stroke-width="1.5"/>
  <ellipse cx="380" cy="300" rx="120" ry="50" fill="#ffffff" opacity="0.18" transform="rotate(-30 380 300)"/>
  <text x="500" y="545" ${SANS} font-size="190" text-anchor="middle" fill="url(#goldText)" stroke="#6b4c05" stroke-width="3">100%</text>
  <text x="500" y="625" ${SANS} font-size="54" letter-spacing="4" text-anchor="middle" fill="#ffffff">GUARANTEE</text>
  ${[380, 440, 500, 560, 620].map((x) => star(x, 690, 22, 9, '#f2c94c')).join('')}`,
)

// --- 4. Engraved academic emblem: hatching, hairline rays, open book, torch with gradient flame. ---
const hatch = Array.from({ length: 64 }, (_, i) => {
  const x = 120 + i * 14
  return `<line x1="${x}" y1="180" x2="${x - 420}" y2="900" stroke="#1b2a4a" stroke-width="2.2"/>`
}).join('')
const rays = Array.from({ length: 24 }, (_, i) => {
  const a = ((-170 + (i * 160) / 23) * Math.PI) / 180
  return `<line x1="${f(500 + 95 * Math.cos(a))}" y1="${f(330 + 95 * Math.sin(a))}" x2="${f(500 + 175 * Math.cos(a))}" y2="${f(330 + 175 * Math.sin(a))}" stroke="#c99a2e" stroke-width="3"/>`
}).join('')
const pageLines = (x0: number, dir: 1 | -1) =>
  Array.from({ length: 8 }, (_, i) => `<line x1="${x0 + dir * 25}" y1="${505 + i * 18}" x2="${x0 + dir * 135}" y2="${495 + i * 18}" stroke="#1b2a4a" stroke-width="2"/>`).join('')
const engravedMotto = arcText('motto', 500, 368, 470, 'bottom', 'SCIENTIA • LUX • MENTIS', `${SERIF} font-size="38" letter-spacing="2" fill="#ffffff"`)
const ENGRAVED = svg(
  `<clipPath id="shield"><path d="M 250 170 L 750 170 L 742 520 Q 720 720 500 830 Q 280 720 258 520 Z"/></clipPath>
  <linearGradient id="flame" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b3120f"/><stop offset="0.5" stop-color="#ff5a1f"/><stop offset="1" stop-color="#ffcf33"/></linearGradient>
  ${engravedMotto.def}`,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  ${laurel(500, 500, 400, 120, 230, 19, '#1b2a4a', 20, 8)}${laurel(500, 500, 400, 60, -50, 19, '#1b2a4a', 20, 8)}
  <g clip-path="url(#shield)">${hatch}</g>
  <path d="M 250 170 L 750 170 L 742 520 Q 720 720 500 830 Q 280 720 258 520 Z" fill="none" stroke="#1b2a4a" stroke-width="10"/>
  <circle cx="500" cy="330" r="180" fill="#ffffff"/>
  ${rays}
  <rect x="488" y="330" width="24" height="130" fill="#7a4b1e"/>
  <rect x="476" y="320" width="48" height="16" rx="4" fill="#5c3a16"/>
  <path d="M 500 190 C 540 230 560 270 530 310 C 520 290 510 280 505 262 C 490 290 470 300 470 318 C 440 280 450 235 500 190 Z" fill="url(#flame)"/>
  <path d="M 345 480 Q 420 460 495 490 L 495 650 Q 420 620 345 640 Z" fill="#ffffff" stroke="#1b2a4a" stroke-width="5"/>
  <path d="M 655 480 Q 580 460 505 490 L 505 650 Q 580 620 655 640 Z" fill="#ffffff" stroke="#1b2a4a" stroke-width="5"/>
  ${pageLines(345, 1)}${pageLines(655, -1)}
  <path d="M 170 790 Q 500 900 830 790 L 850 860 Q 500 975 150 860 Z" fill="#1b2a4a"/>
  ${engravedMotto.body}
  <text x="500" y="975" ${SERIF} font-size="26" letter-spacing="6" text-anchor="middle" fill="#1b2a4a">MCMXCVIII</text>`,
)

// --- 5. Embroidered patch: stitched border, sky gradient, shaded mountains, stroked arc text. ---
const patchTop = arcText('patchTop', 500, 500, 400, 'top', 'ALPINE RESCUE TEAM', `${SANS} font-size="56" letter-spacing="4" fill="#ffffff" stroke="#10202e" stroke-width="2"`)
const sunRays = Array.from({ length: 16 }, (_, i) => {
  const a = (i * 22.5 * Math.PI) / 180
  const b = a + 0.12
  const c = a - 0.12
  return `<polygon points="${f(650 + 80 * Math.cos(b))},${f(330 + 80 * Math.sin(b))} ${f(650 + 112 * Math.cos(a))},${f(330 + 112 * Math.sin(a))} ${f(650 + 80 * Math.cos(c))},${f(330 + 80 * Math.sin(c))}" fill="#ffb627"/>`
}).join('')
const tree = (x: number, y: number, s: number) =>
  `<polygon points="${x},${y - 60 * s} ${x + 26 * s},${y - 15 * s} ${x - 26 * s},${y - 15 * s}" fill="#1d4d2b"/><polygon points="${x},${y - 40 * s} ${x + 34 * s},${y + 10 * s} ${x - 34 * s},${y + 10 * s}" fill="#1d4d2b"/><rect x="${x - 5 * s}" y="${y + 10 * s}" width="${10 * s}" height="${16 * s}" fill="#4a2f1a"/>`
const PATCH = svg(
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f9fdc"/><stop offset="1" stop-color="#e9f6ff"/></linearGradient>
  <clipPath id="inner"><circle cx="500" cy="500" r="440"/></clipPath>
  ${patchTop.def}`,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  <circle cx="500" cy="500" r="490" fill="#1f2d3a"/>
  <circle cx="500" cy="500" r="462" fill="none" stroke="#f4f1e8" stroke-width="5" stroke-dasharray="18 12"/>
  <circle cx="500" cy="500" r="440" fill="url(#sky)"/>
  <g clip-path="url(#inner)">
    ${sunRays}<circle cx="650" cy="330" r="70" fill="#ffd23f"/>
    <polygon points="120,760 330,420 540,760" fill="#5f7f96"/><polygon points="330,420 540,760 430,760" fill="#2f4a5e"/>
    <polygon points="330,420 290,485 315,475 335,500 355,470 372,488" fill="#ffffff"/>
    <polygon points="380,780 610,360 860,780" fill="#6d8ea6"/><polygon points="610,360 860,780 720,780" fill="#34526a"/>
    <polygon points="610,360 565,442 595,430 618,460 640,428 660,450" fill="#ffffff"/>
    <rect x="60" y="740" width="880" height="260" fill="#2e6b3c"/>
    ${tree(200, 760, 1)}${tree(260, 790, 0.8)}${tree(780, 760, 1)}${tree(720, 790, 0.8)}${tree(840, 800, 0.7)}${tree(150, 800, 0.7)}
  </g>
  ${patchTop.body}
  <rect x="300" y="805" width="400" height="56" rx="10" fill="#c8102e"/>
  <text x="500" y="845" ${SANS} font-size="30" letter-spacing="3" text-anchor="middle" fill="#ffffff">EST 2005 • ZERMATT</text>
  ${star(250, 860, 14, 6, '#f4f1e8')}${star(750, 860, 14, 6, '#f4f1e8')}`,
)

/** Real-world-like degradations: phone-sized PNG, an 800 px web JPEG, and the larger sizes. */
const HEAVY_VARIANTS: BenchmarkVariant[] = [
  { size: 600, format: 'png' },
  { size: 800, format: 'jpeg', quality: 75 },
  { size: 1200, format: 'png' },
  { size: 2000, format: 'png' },
]

// --- 6. State-emblem-style wreath (original): wheat ears, striped ribbon, sun with rays,
//        a winged bird, an 8-point star, soft drop shadow and a noise-textured sun disk. ---
function wheatEar(cx: number, cy: number, angle: number): string {
  const grains: string[] = []
  for (let i = 0; i < 8; i++) {
    const t = i * 13
    const side = i % 2 === 0 ? 1 : -1
    grains.push(`<ellipse cx="${f(t)}" cy="${f(side * 6)}" rx="11" ry="6" transform="rotate(${side * 28} ${f(t)} ${f(side * 6)})" fill="url(#grain)" stroke="#8a5a0a" stroke-width="1.2"/>`)
  }
  grains.push(`<ellipse cx="104" cy="0" rx="10" ry="5" fill="url(#grain)" stroke="#8a5a0a" stroke-width="1.2"/>`)
  return `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(angle)})">${grains.join('')}</g>`
}
function wheatStalk(side: 1 | -1): string {
  const ears: string[] = []
  for (let i = 0; i < 9; i++) {
    const deg = side === 1 ? 70 - i * 17 : 110 + i * 17
    const a = (deg * Math.PI) / 180
    const x = 500 + 360 * Math.cos(a)
    const y = 470 + 360 * Math.sin(a)
    ears.push(wheatEar(x, y, deg + side * -100))
  }
  return `<path d="M ${500 + side * 120} 820 Q ${500 + side * 420} 640 ${500 + side * 340} 230" fill="none" stroke="#b07d1a" stroke-width="5"/>` + ears.join('')
}
const sunRayFan = Array.from({ length: 36 }, (_, i) => {
  const a = (i * 10 * Math.PI) / 180
  return `<polygon points="${f(500 + 150 * Math.cos(a - 0.05))},${f(470 + 150 * Math.sin(a - 0.05))} ${f(500 + 205 * Math.cos(a))},${f(470 + 205 * Math.sin(a))} ${f(500 + 150 * Math.cos(a + 0.05))},${f(470 + 150 * Math.sin(a + 0.05))}" fill="#f2a71b"/>`
}).join('')
const feather = (dir: 1 | -1, i: number) => {
  const x0 = 500 + dir * (30 + i * 22)
  return `<polygon points="${f(x0)},${f(470 - i * 4)} ${f(x0 + dir * 70)},${f(400 - i * 9)} ${f(x0 + dir * 26)},${f(486 - i * 3)}" fill="url(#wing)" stroke="#0e3c66" stroke-width="1.5"/>`
}
const WREATH = svg(
  `<linearGradient id="grain" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe39a"/><stop offset="1" stop-color="#c48a1c"/></linearGradient>
  <radialGradient id="sunDisk" cx="0.45" cy="0.4" r="0.6"><stop offset="0" stop-color="#fff2b8"/><stop offset="0.6" stop-color="#ffc83d"/><stop offset="1" stop-color="#e48a12"/></radialGradient>
  <linearGradient id="wing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f3fb"/><stop offset="1" stop-color="#3b86c6"/></linearGradient>
  <linearGradient id="starFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fb4ff"/><stop offset="1" stop-color="#0b4f8c"/></linearGradient>
  <linearGradient id="fold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="0.35"/></linearGradient>
  <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="7"/><feOffset dx="5" dy="7" result="b"/><feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="grainy"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode/></feMerge></filter>`,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  <g filter="url(#shadow)">
    ${wheatStalk(1)}${wheatStalk(-1)}
    ${sunRayFan}
    <circle cx="500" cy="470" r="150" fill="url(#sunDisk)" filter="url(#grainy)"/>
    <path d="M 380 560 L 450 470 L 490 520 L 540 440 L 620 560 Z" fill="#2f7d4a"/><path d="M 540 440 L 620 560 L 575 560 Z" fill="#1d5532"/>
    ${Array.from({ length: 5 }, (_, i) => feather(1, i) + feather(-1, i)).join('')}
    <ellipse cx="500" cy="480" rx="26" ry="44" fill="url(#wing)" stroke="#0e3c66" stroke-width="2"/>
    <circle cx="500" cy="425" r="16" fill="#e8f3fb" stroke="#0e3c66" stroke-width="2"/>
    <path d="M 225 760 Q 500 880 775 760 L 790 800 Q 500 925 210 800 Z" fill="#1e7fc1"/>
    <path d="M 210 800 Q 500 925 790 800 L 800 835 Q 500 965 200 835 Z" fill="#ffffff" stroke="#d22b2b" stroke-width="3"/>
    <path d="M 200 835 Q 500 965 800 835 L 810 870 Q 500 1000 190 870 Z" fill="#1f9a4a"/>
    <path d="M 225 760 Q 500 880 775 760 L 810 870 Q 500 1000 190 870 Z" fill="url(#fold)"/>
    ${star(500, 120, 62, 26, 'url(#starFill)', 8, -90)}
    <path d="M 490 95 A 24 24 0 1 0 490 145 A 19 19 0 1 1 490 95 Z" fill="#ffffff"/>
    ${star(513, 120, 9, 4, '#ffffff')}
    <text x="500" y="975" ${SANS} font-size="26" letter-spacing="3" text-anchor="middle" fill="#0e3c66">RESPUBLIKA • 2026</text>
  </g>`,
)

// --- 7. Embossed metal seal: brushed-metal noise, 72 rivets, embossed circular text, crossed keys. ---
const rivets = Array.from({ length: 72 }, (_, i) => {
  const a = (i * 5 * Math.PI) / 180
  return `<circle cx="${f(500 + 468 * Math.cos(a))}" cy="${f(500 + 468 * Math.sin(a))}" r="7" fill="url(#rivet)"/>`
}).join('')
const embossTop = (dx: number, dy: number, fill: string, id: string) =>
  arcText(id, 500 + dx, 500 + dy, 380, 'top', 'GUILD OF MASTER LOCKSMITHS', `${SERIF} font-size="50" letter-spacing="4" fill="${fill}"`)
const embossBottom = (dx: number, dy: number, fill: string, id: string) =>
  arcText(id, 500 + dx, 500 + dy, 410, 'bottom', 'SINCE 1887', `${SERIF} font-size="48" letter-spacing="10" fill="${fill}"`)
const embossLayers = [embossTop(2.5, 2.5, '#5a3d06', 'et1'), embossTop(-2, -2, '#fff1b8', 'et2'), embossTop(0, 0, '#c9971f', 'et3'), embossBottom(2.5, 2.5, '#5a3d06', 'eb1'), embossBottom(-2, -2, '#fff1b8', 'eb2'), embossBottom(0, 0, '#c9971f', 'eb3')]
const key = (rotate: number) =>
  `<g transform="rotate(${rotate} 500 520)"><circle cx="500" cy="380" r="46" fill="none" stroke="url(#metal)" stroke-width="16"/><rect x="491" y="420" width="18" height="230" fill="url(#metal)"/><rect x="509" y="600" width="40" height="14" fill="url(#metal)"/><rect x="509" y="626" width="30" height="14" fill="url(#metal)"/></g>`
const EMBOSSED = svg(
  `<radialGradient id="metalDisk" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#f7dc84"/><stop offset="0.55" stop-color="#d6a83a"/><stop offset="1" stop-color="#8a6212"/></radialGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f4f4"/><stop offset="0.5" stop-color="#9aa1aa"/><stop offset="1" stop-color="#555b63"/></linearGradient>
  <radialGradient id="rivet" cx="0.35" cy="0.35" r="0.65"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#7a5a14"/></radialGradient>
  <filter id="brushed"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.6" numOctaves="2" seed="3"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.22"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode/></feMerge></filter>
  ${embossLayers.map((l) => l.def).join('')}`,
  `<rect width="1000" height="1000" fill="#ffffff"/>
  <circle cx="500" cy="500" r="495" fill="#6b4c0e"/>
  <circle cx="500" cy="500" r="485" fill="url(#metalDisk)" filter="url(#brushed)"/>
  ${rivets}
  <circle cx="500" cy="500" r="445" fill="none" stroke="#7a5a14" stroke-width="4"/>
  ${embossLayers.map((l) => l.body).join('')}
  <circle cx="500" cy="500" r="300" fill="none" stroke="#fff1b8" stroke-width="3"/>
  <circle cx="500" cy="500" r="296" fill="none" stroke="#5a3d06" stroke-width="3"/>
  <path d="M 400 330 L 600 330 L 596 520 Q 585 640 500 690 Q 415 640 404 520 Z" fill="#7d1219" stroke="#5a3d06" stroke-width="4"/>
  ${key(-28)}${key(28)}
  ${star(500, 300, 18, 7, '#fff1b8')}`,
)

export const EMBLEM_CORPUS: EmblemCase[] = [
  { id: 'seal-circular', category: 'seal', svg: SEAL, variants: EMBLEM_VARIANTS, crops: { text: [0.2, 0.05, 0.8, 0.22], laurel: [0.12, 0.55, 0.42, 0.85], shield: [0.34, 0.27, 0.66, 0.72] } },
  { id: 'crest-gold', category: 'crest', svg: CREST, variants: EMBLEM_VARIANTS, crops: { motto: [0.2, 0.83, 0.8, 0.98], eagle: [0.35, 0.33, 0.65, 0.66], crown: [0.3, 0.07, 0.7, 0.22] } },
  { id: 'badge-metal', category: 'badge', svg: BADGE, variants: EMBLEM_VARIANTS, crops: { text: [0.2, 0.05, 0.8, 0.2], center: [0.25, 0.35, 0.75, 0.72], rim: [0.72, 0.4, 1.0, 0.75] } },
  { id: 'emblem-engraved', category: 'emblem', svg: ENGRAVED, variants: EMBLEM_VARIANTS, crops: { hatch: [0.26, 0.35, 0.5, 0.7], torch: [0.35, 0.15, 0.65, 0.48], motto: [0.18, 0.78, 0.82, 0.99] } },
  { id: 'patch-mountain', category: 'patch', svg: PATCH, variants: EMBLEM_VARIANTS, crops: { text: [0.15, 0.06, 0.85, 0.24], peaks: [0.25, 0.35, 0.7, 0.62], banner: [0.25, 0.78, 0.75, 0.9] } },
  { id: 'wreath-emblem', category: 'emblem-heavy', svg: WREATH, variants: HEAVY_VARIANTS, crops: { wheat: [0.05, 0.35, 0.3, 0.7], bird: [0.33, 0.33, 0.67, 0.6], star: [0.38, 0.03, 0.62, 0.2], ribbon: [0.2, 0.74, 0.8, 1.0] } },
  { id: 'seal-embossed', category: 'seal-heavy', svg: EMBOSSED, variants: HEAVY_VARIANTS, crops: { text: [0.15, 0.04, 0.85, 0.22], keys: [0.3, 0.3, 0.7, 0.72], rivets: [0.75, 0.3, 1.0, 0.7] } },
]
