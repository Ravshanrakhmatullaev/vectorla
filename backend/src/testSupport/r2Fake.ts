import type { R2ListPage } from '../integrations/r2'

/** listPage() for the in-memory R2 fakes in smoke tests: every key counts as uploaded at `uploaded`. */
export function listPageOf(keys: Iterable<string>, prefix: string, uploaded: Date = new Date(0)): R2ListPage {
  return { objects: [...keys].filter((key) => key.startsWith(prefix)).map((key) => ({ key, uploaded })) }
}
