// Runs every *.smoke-test.ts under src/ with tsx, one process each, and
// reports a pass/fail summary. Exit code is non-zero if any test fails.
//
//   npm test                       # all smoke tests
//   npm test -- engine benchmark   # only files whose path contains a filter
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

function findTests(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...findTests(path))
    else if (entry.endsWith('.smoke-test.ts')) found.push(path)
  }
  return found
}

const filters = process.argv.slice(2)
const tests = findTests('src')
  .filter((file) => filters.length === 0 || filters.some((f) => file.includes(f)))
  .sort()

const results = []
for (const file of tests) {
  const start = Date.now()
  const run = spawnSync('npx', ['tsx', file], { encoding: 'utf8' })
  const ok = run.status === 0
  results.push({ file, ok, ms: Date.now() - start })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${Date.now() - start} ms)`)
  if (!ok) console.log((run.stdout ?? '') + (run.stderr ?? ''))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} smoke test files passed.`)
process.exit(failed.length > 0 ? 1 : 0)
