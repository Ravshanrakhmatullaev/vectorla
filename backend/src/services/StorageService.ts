import type { R2Client } from '../integrations/r2'
import { NotFoundError } from '../errors'

export interface SignedUrlVerification {
  valid: boolean
  expired: boolean
  key: string | null
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret)
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Compares two hex strings without an early exit, so timing reveals nothing about a near-miss signature. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export class StorageService {
  constructor(
    private readonly r2: R2Client,
    private readonly downloadUrlSecret: string,
  ) {}

  async storeFile(key: string, data: ReadableStream | ArrayBuffer): Promise<void> {
    await this.r2.put(key, data)
  }

  /** Used by routes/download.ts to stream a conversion's file after all download checks pass. */
  async getFile(key: string): Promise<ReadableStream> {
    const object = await this.r2.get(key)
    if (!object) throw new NotFoundError('The stored file was not found')
    return object
  }

  /**
   * Builds a self-signed, time-limited download URL for an R2 object key.
   * There's no S3-style presigning available here (the Worker only has the
   * plain R2 binding, no R2 access-key credentials) — instead this signs
   * `key:expiresAt` with DOWNLOAD_URL_SECRET (HMAC-SHA256) and embeds the
   * result as a query string. A future download-serving route would call
   * verifySignedUrl() before streaming the object via getFile(); no such
   * route exists yet, so this URL is metadata-only for now.
   */
  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
    const signature = await hmacHex(this.downloadUrlSecret, `${key}:${expiresAt}`)
    const params = new URLSearchParams({ key, exp: String(expiresAt), sig: signature })
    return `/api/v1/download?${params.toString()}`
  }

  /** Verifies a URL produced by getSignedDownloadUrl — checks the HMAC and expiry. */
  async verifySignedUrl(url: string): Promise<SignedUrlVerification> {
    const params = new URL(url, 'https://internal.invalid').searchParams
    const key = params.get('key')
    const exp = params.get('exp')
    const sig = params.get('sig')
    if (!key || !exp || !sig) return { valid: false, expired: false, key: null }

    const expiresAt = Number(exp)
    const expected = await hmacHex(this.downloadUrlSecret, `${key}:${expiresAt}`)
    const validSignature = constantTimeEqual(expected, sig)
    const expired = Math.floor(Date.now() / 1000) > expiresAt
    return { valid: validSignature && !expired, expired, key }
  }

  /** Idempotent: deleting a key that no longer exists is not an error (R2 semantics). */
  async deleteFile(key: string): Promise<void> {
    await this.r2.delete(key)
  }
}
