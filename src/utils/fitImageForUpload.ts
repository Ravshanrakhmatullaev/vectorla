/**
 * Mirrors the backend's MAX_IMAGE_PIXELS (backend/src/config/index.ts): the
 * API rejects larger images because decoding them would exceed a Worker's
 * memory. The tracing engine works at ~1.2 MP anyway, so shrinking a large
 * photo to 4 MP in the browser loses nothing in the result.
 */
export const MAX_UPLOAD_PIXELS = 4_000_000
/** The free plan's file-size limit (backend PLAN_LIMITS.free.maxFileSizeBytes). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const RESIZABLE = new Set(['image/png', 'image/jpeg', 'image/webp'])

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.92))
}

function isOpaque(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const { data } = context.getImageData(0, 0, width, height)
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false
  return true
}

/**
 * Returns the file unchanged when it is within the pixel and size limits (or
 * cannot be read here — the server then validates it). Otherwise returns a
 * high-quality copy, downscaled to the pixel limit if needed: JPEG stays
 * JPEG; PNG and WebP become PNG, which keeps transparency and is encodable in
 * every browser, unless that PNG is still too large and the image has no
 * transparency, in which case it becomes a high-quality JPEG.
 */
export async function fitImageForUpload(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type) || typeof createImageBitmap !== 'function') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  try {
    const { width, height } = bitmap
    if (width * height <= MAX_UPLOAD_PIXELS && file.size <= MAX_UPLOAD_BYTES) return file
    const scale = Math.min(1, Math.sqrt(MAX_UPLOAD_PIXELS / (width * height)))
    const targetWidth = Math.max(1, Math.floor(width * scale))
    const targetHeight = Math.max(1, Math.floor(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) return file
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
    let type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    let blob = await encode(canvas, type)
    if (blob && blob.size > MAX_UPLOAD_BYTES && type === 'image/png' && isOpaque(context, targetWidth, targetHeight)) {
      type = 'image/jpeg'
      blob = await encode(canvas, type)
    }
    if (!blob) return file
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
    return new File([blob], `${baseName}.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type, lastModified: file.lastModified })
  } finally {
    bitmap.close()
  }
}
