// Shared helpers for route-level smoke tests (Phase 21): every route now
// wraps its JSON responses in the standard SuccessResponse/ErrorResponse
// envelope (see api/response.ts) and requires a requestId argument — these
// unwrap the envelope so each test file doesn't repeat the same boilerplate.

/** A fixed id for route handlers under test — production generates a real crypto.randomUUID() per request (see index.ts). */
export const TEST_REQUEST_ID = 'test-request-id'

export async function readSuccessBody<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { success: boolean; data?: T; requestId?: string }
  if (!body.success) throw new Error(`Expected a success response, got: ${JSON.stringify(body)}`)
  return body.data as T
}

export async function readErrorBody(response: Response): Promise<{ code: string; message: string }> {
  const body = (await response.json()) as { success: boolean; error?: { code: string; message: string } }
  if (body.success) throw new Error(`Expected an error response, got: ${JSON.stringify(body)}`)
  return body.error as { code: string; message: string }
}
