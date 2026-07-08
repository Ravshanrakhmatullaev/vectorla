// Our tsconfig's "types" is deliberately restricted to @cloudflare/workers-types
// (avoids pulling in all of @types/node's globals, which redeclare things
// like `fetch`/`Response` differently from Workers' own versions), so there's
// no ambient module declaration for `node:fs` available to the type checker.
// This test-only helper (never imported by the actual Worker) needs exactly
// one function from it — importing via a widened (non-literal) specifier
// sidesteps static module resolution instead of adding @types/node project-wide.
const fsModuleSpecifier: string = 'node:fs'
const fsModule: Promise<{ readFileSync: (path: string) => Uint8Array }> = import(fsModuleSpecifier)

export async function readFileSync(path: string): Promise<Uint8Array> {
  return (await fsModule).readFileSync(path)
}
