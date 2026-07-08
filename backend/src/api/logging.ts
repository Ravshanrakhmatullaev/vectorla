export interface RequestLogEntry {
  requestId: string
  method: string
  path: string
  status: number
  durationMs: number
}

/**
 * One structured JSON log line per request (Cloudflare Workers ships
 * console.log output to whatever logging destination is configured —
 * Logpush, `wrangler tail`, etc.) — requestId ties this back to the same
 * value returned in the response body/X-Request-Id header.
 */
export function logRequest(entry: RequestLogEntry): void {
  console.log(JSON.stringify({ level: 'info', type: 'request', ...entry }))
}
