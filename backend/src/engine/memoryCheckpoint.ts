/**
 * Test hook for memory measurement. The engine calls checkpoint() where a
 * stage holds the most memory (all of its buffers still alive), so a test can
 * force a GC there and read the true in-stage peak instead of the
 * between-stage level. The hook is null in production: one property check per
 * call site.
 */
export const memoryCheckpoints: { hook: ((label: string) => void) | null } = { hook: null }

export function checkpoint(label: string): void {
  memoryCheckpoints.hook?.(label)
}

/**
 * Local `wrangler dev` measurement: pause at every checkpoint so an attached
 * inspector can force a GC and read the isolate's heap at the true in-stage
 * peak (sampling cannot interrupt the synchronous trace). `debugger` is a
 * no-op when no debugger is attached.
 */
export function enableDebuggerCheckpoints(): void {
  memoryCheckpoints.hook = () => {
    // eslint-disable-next-line no-debugger
    debugger
  }
}
