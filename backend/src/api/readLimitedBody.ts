import { PayloadTooLargeError } from '../errors'

/**
 * Reads a request body into memory, refusing it as soon as it exceeds
 * `maxBytes`. Unlike `request.formData()`, this never buffers more than the
 * limit (plus one chunk) whatever the client claims: a missing or false
 * Content-Length (e.g. a chunked upload) can't push an oversized body into
 * the Worker's memory. A declared length over the limit is refused before
 * anything is read.
 */
export async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge(maxBytes)
  if (!request.body) return new Uint8Array(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge(maxBytes)
    }
    chunks.push(value)
  }
  if (chunks.length === 1) return chunks[0]!
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function tooLarge(maxBytes: number): PayloadTooLargeError {
  return new PayloadTooLargeError(`Upload body exceeds ${Math.floor(maxBytes / (1024 * 1024))} MB`)
}

/**
 * Parses a multipart/form-data body that readLimitedBody already bounded.
 * Returns null when the body is not valid multipart.
 */
export async function parseMultipart(body: Uint8Array, contentType: string | null): Promise<FormData | null> {
  try {
    return await new Response(body, { headers: { 'Content-Type': contentType ?? '' } }).formData()
  } catch {
    return null
  }
}
