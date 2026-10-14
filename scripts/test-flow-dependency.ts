import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Qualify Jig's frozen dependency through ordinary installation and public exports.
// FLOW owns the complete SDK source and protocol suites.
const archive = process.env.FLOW_SDK_PACKAGE_ARCHIVE
if (!archive) throw new Error('Supply FLOW_SDK_PACKAGE_ARCHIVE for dependency qualification')
const temporary = await mkdtemp(join(tmpdir(), 'jig-flow-dependency-'))
try {
  const consumer = join(temporary, 'consumer')
  await mkdir(consumer)
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': `file:${archive}` },
    }),
  )
  execFileSync(process.execPath, ['install', '--ignore-scripts', '--no-progress'], {
    cwd: consumer,
    stdio: 'inherit',
    timeout: 120_000,
  })
  const manifest = JSON.parse(
    await readFile(join(consumer, 'node_modules/@jigging/flow/package.json'), 'utf8'),
  )
  assert.equal(manifest.name, '@jigging/flow')
  assert.equal(manifest.license, 'Apache-2.0')
  await writeFile(
    join(consumer, 'smoke.mjs'),
    `import assert from 'node:assert/strict'; import {handle,OperationError} from '@jigging/flow'; assert.equal(typeof handle,'function');assert.equal(new OperationError('UNAVAILABLE').code,'UNAVAILABLE');`,
  )
  for (const executable of [process.execPath, process.env.FLOW_NODE]) {
    if (!executable) throw new Error('FLOW_NODE is required')
    execFileSync(executable, ['smoke.mjs'], { cwd: consumer, stdio: 'inherit', timeout: 30_000 })
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
