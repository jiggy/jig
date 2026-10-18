// Separate process owns the actual descriptors used by these refusal checks.
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { main } from '../src/cli.js'
import { privateOpenFileRoot, privateReadRegularFile, sha256 } from '../src/internal/file-input.js'
import { privateCaptureSavedResult } from '../src/internal/saved-result.js'
import { canonicalJson } from '../src/json.js'

const work = process.argv[2]!
const artifactText = 'PRIVATE_ACCEPTED_OR_REJECTED_ARTIFACT_BYTES'
fs.mkdirSync(join(work, 'files'))
fs.writeFileSync(join(work, 'files', 'patch'), artifactText)
const record = {
  status: 'succeeded',
  outcome: 'done',
  output: { summary: 'PRIVATE_RECORDED_REPORT_BYTES' },
  delivery: {
    status: 'written',
    files: [
      { path: 'patch', bytes: artifactText.length, digest: sha256(Buffer.from(artifactText)) },
    ],
  },
}
fs.writeFileSync(join(work, 'result.json'), JSON.stringify(record) + '\n')

if (process.argv[3] === 'closed-output') {
  // The launching shell holds fd 1 open read-only, preventing descriptor reuse.
  assert.equal(fs.fstatSync(1).isCharacterDevice(), true)
  assert.throws(() => fs.writeSync(1, Buffer.from('refused output')), { code: 'EBADF' })
  assert.equal(await main(['inspect', '--result', work, '--json']), 1)
  console.error('saved CLI refused read-only output')
  process.exit(0)
}

const root = privateOpenFileRoot(work)
try {
  const bytes = privateReadRegularFile(root, 'files/patch', artifactText.length)
  assert.equal(bytes.toString(), artifactText)
  fs.writeFileSync(join(work, 'files', 'patch'), 'changed')
  assert.equal(bytes.toString(), artifactText)
  bytes.fill(0)
  assert.throws(() => privateReadRegularFile(root, 'files/patch', 1))
  fs.unlinkSync(join(work, 'files', 'patch'))
  assert.throws(() => privateReadRegularFile(root, 'files/patch', artifactText.length))
} finally {
  fs.closeSync(root)
}
assert.throws(() => fs.fstatSync(root), { code: 'EBADF' })
assert.throws(() => privateReadRegularFile(root, 'result.json', 4096))

const partial = await privateCaptureSavedResult(work)
assert.deepEqual(canonicalJson(partial.record), canonicalJson(record))
assert.equal(partial.complete, false)
assert.equal(partial.preview('patch'), undefined)
partial.close()
partial.close()
assert.throws(() => partial.reportPreview(), /closed/)

const controller = new AbortController()
const interruption = new Error('original external interruption')
controller.abort(interruption)
await assert.rejects(
  privateCaptureSavedResult(work, controller.signal),
  (error) => error === interruption,
)
console.log('saved capture real descriptor refusal and closure passed')
