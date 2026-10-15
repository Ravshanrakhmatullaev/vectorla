// Run with: npm test (node --test; Node strips the types).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIT_VIEW, MAX_ZOOM, clampView, fitContain, formatZoom, imageRect, lensImageRect, panBy, stepZoom, zoomAt } from './zoomView.ts'

const stage = { width: 800, height: 400 }
const fit = fitContain({ width: 1000, height: 1000 }, stage, 0) // 400 x 400

function close(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} expected ${expected}, got ${actual}`)
}

test('fitContain keeps the aspect ratio inside the padded box', () => {
  assert.deepEqual(fit, { width: 400, height: 400 })
  assert.deepEqual(fitContain({ width: 200, height: 100 }, { width: 420, height: 420 }, 10), { width: 400, height: 200 })
})

test('at 1× the image is centered', () => {
  assert.deepEqual(imageRect(FIT_VIEW, fit, stage), { x: 200, y: 0, width: 400, height: 400 })
})

test('zoom is clamped to 1–8×', () => {
  assert.equal(clampView({ zoom: 20, cx: 0.5, cy: 0.5 }, fit, stage).zoom, MAX_ZOOM)
  assert.equal(clampView({ zoom: 0.2, cx: 0.5, cy: 0.5 }, fit, stage).zoom, 1)
})

test('zoomAt keeps the image point under the cursor fixed', () => {
  const at = { x: 300, y: 100 }
  const before = imageRect(FIT_VIEW, fit, stage)
  const u = (at.x - before.x) / before.width
  const v = (at.y - before.y) / before.height
  const view = zoomAt(FIT_VIEW, 4, at, fit, stage)
  const after = imageRect(view, fit, stage)
  assert.equal(view.zoom, 4)
  close(after.x + u * after.width, at.x, 'x')
  close(after.y + v * after.height, at.y, 'y')
})

test('the zoomed image never leaves a gap on an axis where it is larger than the stage', () => {
  let view = zoomAt(FIT_VIEW, 8, { x: 400, y: 200 }, fit, stage)
  view = panBy(view, 100000, 100000, fit, stage)
  const rect = imageRect(view, fit, stage)
  close(rect.x, 0, 'left edge')
  close(rect.y, 0, 'top edge')
  view = panBy(view, -1e6, -1e6, fit, stage)
  const end = imageRect(view, fit, stage)
  close(end.x + end.width, stage.width, 'right edge')
  close(end.y + end.height, stage.height, 'bottom edge')
})

test('an axis smaller than the stage stays centered while panning', () => {
  const view = panBy(zoomAt(FIT_VIEW, 1.5, { x: 400, y: 200 }, fit, stage), 500, 0, fit, stage)
  const rect = imageRect(view, fit, stage) // 600 wide in an 800 wide stage
  close(rect.x, 100)
})

test('stepZoom walks the zoom steps', () => {
  assert.equal(stepZoom(1, 1), 1.5)
  assert.equal(stepZoom(2.2, 1), 3)
  assert.equal(stepZoom(8, 1), 8)
  assert.equal(stepZoom(3, -1), 2)
  assert.equal(stepZoom(1, -1), 1)
})

test('the lens centers the sampled image point at the given factor', () => {
  const rect = imageRect(FIT_VIEW, fit, stage)
  const at = { x: 250, y: 300 }
  const lens = lensImageRect(rect, at, 160, 3)
  assert.equal(lens.width, rect.width * 3)
  const u = (at.x - rect.x) / rect.width
  const v = (at.y - rect.y) / rect.height
  close(lens.x + u * lens.width, 80)
  close(lens.y + v * lens.height, 80)
})

test('formatZoom uses the language decimal separator', () => {
  assert.equal(formatZoom(1), '1×')
  assert.equal(formatZoom(1.5), '1.5×')
  assert.equal(formatZoom(1.5, 'ru'), '1,5×')
  assert.equal(formatZoom(7.96), '8×')
})
