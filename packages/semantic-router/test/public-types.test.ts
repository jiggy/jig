import { test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

test('public input and decision types compose with the ordinary FLOW call and result types', () => {
  execFileSync(process.execPath, [
    'node_modules/typescript/bin/tsc', '--ignoreConfig', '--noEmit', '--strict',
    '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--target', 'ES2022', '--types', 'node',
    'test/fixtures/public-types.ts',
  ], { cwd: resolve(import.meta.dir, '..'), stdio: 'inherit' })
})
