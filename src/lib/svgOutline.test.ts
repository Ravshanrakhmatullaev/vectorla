// Run with: npm test (node --test; Node strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { anchorPathData, parseViewBox } from './svgOutline.ts'

function points(d: string): number[][] {
  const { data } = anchorPathData(d)
  return [...data.matchAll(/M(-?[\d.]+) (-?[\d.]+)h0/g)].map((match) => [Number(match[1]), Number(match[2])])
}

test('absolute commands: one anchor per segment end point, closing point not repeated', () => {
  assert.deepEqual(points('M10 10L20 10L20 20Z'), [[10, 10], [20, 10], [20, 20]])
  assert.deepEqual(points('M0 0H5V5H0Z'), [[0, 0], [5, 0], [5, 5], [0, 5]])
  assert.deepEqual(points('M0 0C1 1 2 2 3 3S5 5 6 6Q7 7 8 8T9 9'), [[0, 0], [3, 3], [6, 6], [8, 8], [9, 9]])
})

test('relative commands resolve against the current point', () => {
  // the Vectorla engine writes relative commands only
  assert.deepEqual(points('m33 0h-33v328h400v-328z'), [[33, 0], [0, 0], [0, 328], [400, 328], [400, 0]])
  assert.deepEqual(points('m10 10c1 0 2 0 3 0l2 2'), [[10, 10], [13, 10], [15, 12]])
})

test('implicit linetos after a moveto, and a subpath after z starts from the closed point', () => {
  assert.deepEqual(points('m1 1 2 0 0 2z m5 5 1 0'), [[1, 1], [3, 1], [3, 3], [6, 6], [7, 6]])
  assert.deepEqual(points('M1 1 3 1 3 3'), [[1, 1], [3, 1], [3, 3]])
})

test('compact number syntax: signs and dots as separators, exponents', () => {
  assert.deepEqual(points('m534 278.7-9.7.3-21.6-.5'), [[534, 278.7], [524.3, 279], [502.7, 278.5]])
  assert.deepEqual(points('M1e1 2E1l-1e0.5'), [[10, 20], [9, 20.5]])
})

test('arcs: end point is the last pair, flags may be written without separators', () => {
  assert.deepEqual(points('M0 0a5 5 0 0110 0'), [[0, 0], [10, 0]])
  assert.deepEqual(points('M0 0A5 5 0 1 0 10 10'), [[0, 0], [10, 10]])
})

test('zero-length segments add no anchor; malformed data keeps the points read so far', () => {
  assert.deepEqual(points('M0 0L0 0L5 0'), [[0, 0], [5, 0]])
  assert.deepEqual(points('M0 0L5 0L#'), [[0, 0], [5, 0]])
  assert.deepEqual(points('L5 5'), [])
  assert.equal(anchorPathData('').count, 0)
})

test('count matches the anchors written', () => {
  const { data, count } = anchorPathData('m0 0h10v10h-10z')
  assert.equal(count, 4)
  assert.equal(data, 'M0 0h0M10 0h0M10 10h0M0 10h0')
})

test('every path of a real engine result parses to its full segment count', () => {
  // public/samples/emblem/pro.svg is unedited engine output (relative commands, gradients)
  const svg = readFileSync(new URL('../../public/samples/emblem/pro.svg', import.meta.url), 'utf8')
  const paths = [...svg.matchAll(/<path fill="(?!none")[^"]*" d="([^"]+)"/g)].map((match) => match[1]!)
  assert.ok(paths.length > 100, `found ${paths.length} filled paths`)
  for (const d of paths) {
    // each command letter ends at least one segment (implicit repeats add more)
    const commands = (d.match(/[a-df-zA-DF-Z]/g) ?? []).filter((letter) => letter.toLowerCase() !== 'z').length
    const closes = (d.match(/z/gi) ?? []).length
    const { count } = anchorPathData(d)
    assert.ok(count >= commands - closes - 1, `path anchors ${count} vs commands ${commands}`)
    assert.ok(Number.isFinite(count) && count > 0)
  }
})

test('parseViewBox', () => {
  assert.deepEqual(parseViewBox('0 0 1200 800'), { x: 0, y: 0, width: 1200, height: 800 })
  assert.deepEqual(parseViewBox(' -5,2.5 10 20 '), { x: -5, y: 2.5, width: 10, height: 20 })
  assert.equal(parseViewBox('0 0 0 10'), null)
  assert.equal(parseViewBox('0 0 10'), null)
  assert.equal(parseViewBox(null), null)
})
