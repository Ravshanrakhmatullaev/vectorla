/**
 * Compact SVG path-data serialization.
 *
 * Coordinates are snapped to a fixed decimal grid in integer units first, and
 * relative deltas are computed from the snapped values, so rounding never
 * accumulates drift along long paths. Numbers use the shortest valid form
 * (".5", "-.25", implicit separators), commands use h/v for axis-aligned
 * lines and omit repeated command letters.
 */
import type { FittedChain } from './curveFit'

export class PathBuilder {
  private readonly factor: number
  private readonly parts: string[] = []
  private curX = 0
  private curY = 0
  private startX = 0
  private startY = 0
  private lastCommand = ''
  private lastNumber = ''

  constructor(
    private readonly scale: number,
    precision: number,
  ) {
    this.factor = Math.pow(10, precision)
  }

  private snap(v: number): number {
    return Math.round(v * this.scale * this.factor)
  }

  private formatNumber(units: number): string {
    let s = (units / this.factor).toString()
    if (s.includes('e')) s = (units / this.factor).toFixed(6).replace(/\.?0+$/, '')
    if (s.startsWith('0.')) s = s.slice(1)
    else if (s.startsWith('-0.')) s = `-${s.slice(2)}`
    if (s === '-0') s = '0'
    return s
  }

  private command(letter: string): void {
    if (letter !== this.lastCommand || letter === 'm') {
      this.parts.push(letter)
      this.lastNumber = ''
    }
    this.lastCommand = letter === 'm' ? 'l' : letter
  }

  private number(units: number): void {
    const s = this.formatNumber(units)
    if (this.lastNumber !== '') {
      const needsSeparator = !(s.startsWith('-') || (s.startsWith('.') && this.lastNumber.includes('.')))
      if (needsSeparator) this.parts.push(' ')
    }
    this.parts.push(s)
    this.lastNumber = s
  }

  moveTo(x: number, y: number): void {
    const X = this.snap(x)
    const Y = this.snap(y)
    this.command('m')
    this.number(X - this.curX)
    this.number(Y - this.curY)
    this.curX = X
    this.curY = Y
    this.startX = X
    this.startY = Y
  }

  lineTo(x: number, y: number): void {
    const X = this.snap(x)
    const Y = this.snap(y)
    const dx = X - this.curX
    const dy = Y - this.curY
    if (dx === 0 && dy === 0) return
    if (dy === 0) {
      this.command('h')
      this.number(dx)
    } else if (dx === 0) {
      this.command('v')
      this.number(dy)
    } else {
      this.command('l')
      this.number(dx)
      this.number(dy)
    }
    this.curX = X
    this.curY = Y
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    const X1 = this.snap(x1)
    const Y1 = this.snap(y1)
    const X2 = this.snap(x2)
    const Y2 = this.snap(y2)
    const X = this.snap(x)
    const Y = this.snap(y)
    // A curve whose control points all snapped onto the chord is a line.
    const cross1 = (X1 - this.curX) * (Y - this.curY) - (Y1 - this.curY) * (X - this.curX)
    const cross2 = (X2 - this.curX) * (Y - this.curY) - (Y2 - this.curY) * (X - this.curX)
    if (cross1 === 0 && cross2 === 0) {
      this.lineTo(x, y)
      return
    }
    this.command('c')
    this.number(X1 - this.curX)
    this.number(Y1 - this.curY)
    this.number(X2 - this.curX)
    this.number(Y2 - this.curY)
    this.number(X - this.curX)
    this.number(Y - this.curY)
    this.curX = X
    this.curY = Y
  }

  close(): void {
    this.parts.push('z')
    this.lastCommand = 'z'
    this.lastNumber = ''
    this.curX = this.startX
    this.curY = this.startY
  }

  /** Appends a sequence of fitted chains that together form one closed loop. */
  appendLoop(chains: FittedChain[]): void {
    const first = chains[0]
    if (!first) return
    this.moveTo(first.startX, first.startY)
    const startX = this.curX
    const startY = this.curY
    const lastChain = chains[chains.length - 1]!
    for (const chain of chains) {
      const segments = chain.segments
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!
        if (seg.type === 'L') {
          // `z` draws the closing line itself.
          const closesLoop = chain === lastChain && i === segments.length - 1 && this.snap(seg.x) === startX && this.snap(seg.y) === startY
          if (!closesLoop) this.lineTo(seg.x, seg.y)
        } else {
          this.curveTo(seg.x1, seg.y1, seg.x2, seg.y2, seg.x, seg.y)
        }
      }
    }
    this.close()
  }

  toString(): string {
    return this.parts.join('')
  }

  isEmpty(): boolean {
    return this.parts.length === 0
  }
}
