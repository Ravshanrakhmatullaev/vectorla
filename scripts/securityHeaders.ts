import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/**
 * Builds dist/_headers (Cloudflare Pages) from the public/_headers template:
 *
 *  - `connect-src` lists exactly the origins this build talks to — the
 *    configured VITE_API_BASE_URL and VITE_SUPABASE_URL — instead of
 *    wildcards such as https://*.workers.dev, which would let any attacker's
 *    Worker receive data.
 *  - `script-src` allows the inline theme script in index.html by its
 *    SHA-256 hash instead of 'unsafe-inline'.
 *
 * Template placeholders: __CONNECT_SRC__ and __SCRIPT_SRC__. A production
 * build without VITE_API_BASE_URL fails: the app could not reach its API,
 * and the CSP would have nothing to allow.
 */
export function securityHeaders(env: Record<string, string>, mode: string): Plugin {
  let outDir = 'dist'
  return {
    name: 'vectorla-security-headers',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const html = readFileSync(path.join(outDir, 'index.html'), 'utf8')
      const template = readFileSync(path.join(outDir, '_headers'), 'utf8')
      const connect = ["'self'", ...trustedOrigins(env, mode)]
      const scriptHashes = inlineScriptHashes(html).map((hash) => `'sha256-${hash}'`)
      const headers = template
        .replace('__CONNECT_SRC__', connect.join(' '))
        .replace('__SCRIPT_SRC__', ["'self'", ...scriptHashes].join(' '))
      if (/__(CONNECT|SCRIPT)_SRC__/.test(headers)) throw new Error('public/_headers: unreplaced placeholder')
      writeFileSync(path.join(outDir, '_headers'), headers)
    },
  }
}

/** The origins of the configured API and Supabase URLs. */
export function trustedOrigins(env: Record<string, string>, mode: string): string[] {
  const origins: string[] = []
  for (const name of ['VITE_API_BASE_URL', 'VITE_SUPABASE_URL']) {
    const value = env[name]?.trim()
    if (!value) {
      if (name === 'VITE_API_BASE_URL' && mode === 'production' && env.VECTORLA_ALLOW_NO_API !== '1') {
        throw new Error('VITE_API_BASE_URL must be set for a production build (it also defines the CSP connect-src)')
      }
      continue
    }
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !local) throw new Error(`${name} must be an https:// URL (got ${value})`)
    origins.push(url.origin)
  }
  return [...new Set(origins)]
}

/** Base64 SHA-256 of every inline (src-less) <script> in the page, as CSP expects. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.push(createHash('sha256').update(match[1]!, 'utf8').digest('base64'))
  }
  return hashes
}
