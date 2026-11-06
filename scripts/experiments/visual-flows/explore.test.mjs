import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const cli = fileURLToPath(new URL('./explore.mjs', import.meta.url))

test('the lock command exports real JSON and HTML without including resource policy payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visual-flows-'))
  try {
    const input = join(directory, 'jig.lock')
    const lock = {
      packages: { 'flows/main': { digest: 'sha256:' + 'a'.repeat(64), directRun: false, uses: {} } },
      bindings: { main: { packagePath: 'flows/main', settings: { private: 'SETTINGS_CANARY' }, slots: { remote: { kind: 'grant', policy: { kind: 'http', url: 'POLICY_CANARY' } } } } },
    }
    await writeFile(input, JSON.stringify(lock))
    for (const format of ['json', 'html']) {
      const output = join(directory, 'graph.' + format)
      execFileSync(process.execPath, [cli, '--lock', input, '--root', 'binding:main', '--format', format, '--output', output])
      const text = await readFile(output, 'utf8')
      assert.ok(text.includes('binding:main'))
      assert.ok(!text.includes('SETTINGS_CANARY'))
      assert.ok(!text.includes('POLICY_CANARY'))
      if (format === 'json') {
        const graph = JSON.parse(text)[0].graph
        assert.equal(graph.edges[0].meaning, 'may-invoke')
        assert.equal(graph.provenance.approval, 'not-verified')
      } else assert.ok(text.startsWith('<!doctype html>'))
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the command refuses invalid JSON, missing inputs, and existing output without overwriting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visual-flows-'))
  try {
    const input = join(directory, 'jig.lock'), output = join(directory, 'out.json')
    await writeFile(input, '{PRIVATE_INVALID_INPUT')
    let result = spawnSync(process.execPath, [cli, '--lock', input, '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.ok(!result.stderr.includes('PRIVATE_INVALID_INPUT'))
    await writeFile(input, JSON.stringify({ packages: {}, bindings: {} }))
    await writeFile(output, 'retained result')
    result = spawnSync(process.execPath, [cli, '--lock', input, '--format', 'json', '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /already exists/)
    assert.equal(await readFile(output, 'utf8'), 'retained result')
    result = spawnSync(process.execPath, [cli, '--lock', join(directory, 'absent'), '--output', output], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unavailable/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the command rejects ambiguous modes and unusable flags', () => {
  for (const argv of [[], ['--lock', 'a', '--project', 'b', '--output', 'c'], ['--examples', 'a', '--root', 'binding:x', '--output', 'c'], ['--lock', 'a', '--sley', 'b', '--output', 'c'], ['--lock', 'a', '--format', 'png', '--output', 'c']]) {
    const result = spawnSync(process.execPath, [cli, ...argv], { encoding: 'utf8' })
    assert.equal(result.status, 1)
  }
})

test('the command rejects oversized regular JSON input before creating output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visual-flows-'))
  try {
    const input = join(directory, 'large.json'), output = join(directory, 'out.json')
    const handle = await open(input, 'w')
    try { await handle.truncate(8 * 1024 * 1024 + 1) }
    finally { await handle.close() }
    const result = spawnSync(process.execPath, [cli, '--lock', input, '--output', output], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /regular file at most 8 MiB/)
    await assert.rejects(readFile(output), { code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the command rejects a directory as JSON input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visual-flows-'))
  try {
    const input = join(directory, 'input'), output = join(directory, 'out.json')
    await mkdir(input)
    const result = spawnSync(process.execPath, [cli, '--lock', input, '--output', output], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    await assert.rejects(readFile(output), { code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('the command rejects a FIFO without waiting for a writer', {
  skip: process.platform === 'win32' ? 'Named FIFO fixtures require POSIX.' : false,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'visual-flows-'))
  try {
    const input = join(directory, 'input.fifo'), output = join(directory, 'out.json')
    const created = spawnSync('mkfifo', [input], { encoding: 'utf8' })
    if (created.error?.code === 'ENOENT') { context.skip('mkfifo is unavailable.'); return }
    assert.equal(created.error, undefined)
    assert.equal(created.status, 0, created.stderr)
    const result = spawnSync(process.execPath, [cli, '--lock', input, '--output', output], { encoding: 'utf8', timeout: 5_000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /regular file at most 8 MiB/)
    await assert.rejects(readFile(output), { code: 'ENOENT' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('project source discovery refuses FIFO metadata without hanging', {
  skip: process.platform === 'win32' ? 'Named FIFO fixtures require POSIX.' : false,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'visual-flows-source-fifo-'))
  try {
    const flow = join(directory, 'flows', 'worker')
    await mkdir(flow, { recursive: true })
    await writeFile(join(directory, 'jig.ts'),
      "import { defineJig } from '@jigging/jig'\nexport default defineJig({ flows: ['flows/worker'] })\n")
    const metadata = join(flow, 'FLOW.meta.json')
    const created = spawnSync('mkfifo', [metadata], { encoding: 'utf8' })
    if (created.error?.code === 'ENOENT') { context.skip('mkfifo is unavailable.'); return }
    assert.equal(created.error, undefined)
    assert.equal(created.status, 0, created.stderr)
    const output = join(directory, 'out.json')
    const run = spawnSync(process.execPath,
      [cli, '--project', directory, '--format', 'json', '--output', output],
      { encoding: 'utf8', timeout: 5_000 })
    assert.equal(run.error, undefined, run.error?.message)
    assert.equal(run.status, 0, run.stderr)
    const result = JSON.parse(await readFile(output, 'utf8'))
    assert(result[0].graph.warnings.some(warning => warning.code === 'OPAQUE_PACKAGE'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})
