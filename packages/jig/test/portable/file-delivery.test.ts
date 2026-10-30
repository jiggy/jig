import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test'
import { closeSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  capturePrivateOutput,
  capturePrivateRetainedOutput,
} from '../../src/internal/captured-output.js'
import { privateCaptureDeliveryInspection } from '../../src/internal/delivery-inspection.js'
import { closePrivateExecutionOutput } from '../../src/internal/execution-output.js'
import {
  PRIVATE_FILE_COMMAND_STOP_GRACE_MS,
  privateOwnFileCommand,
} from '../../src/internal/file-command.js'
import { PrivateFileDeliveryOwner } from '../../src/internal/file-delivery.js'
import { privateOpenFileRoot, sha256 } from '../../src/internal/file-input.js'
import * as imagePreview from '../../src/internal/image-preview.js'
import {
  PRIVATE_PREVIEW_LIMITS,
  privatePreviewStringBytes,
} from '../../src/internal/image-preview-policy.js'
import { PrivateRunCheckpoints } from '../../src/internal/private-run-checkpoint.js'
import { privatePresentationNow } from '../../src/internal/root-run-timeout-policy.js'
import { canonicalJson, type JsonValue } from '../../src/json.js'
import { fixture, fixturePid, record, waitUntilStopped } from '.././file-delivery.fixture.js'

let commandFixtureRoot: string | undefined
let commandFixture: string
beforeAll(async () => {
  commandFixtureRoot = await realpath(await mkdtemp(join(tmpdir(), 'jig-file-command-test-')))
  const libexec = join(commandFixtureRoot, 'libexec')
  await mkdir(libexec)
  if (process.platform === 'darwin')
    await copyFile(
      join(suiteTestRoot, '../support/macos-descriptor-bridge.dylib'),
      join(libexec, 'macos-descriptor-bridge.dylib'),
    )
  const options = {
    entrypoints: [join(suiteTestRoot, 'fixtures/file-delivery-client.ts')],
    target: 'bun',
    format: 'esm',
    outdir: libexec,
    naming: 'file-delivery-client.js',
  }
  // Keep the compiler's resolver state outside the long-lived test process.
  const build = Bun.spawnSync(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      '--config=/dev/null',
      '--eval',
      `const result = await Bun.build(${JSON.stringify(options)});
if (!result.success) throw new AggregateError(result.logs, 'fixture compilation failed')`,
    ],
    { timeout: 5000, stdout: 'pipe', stderr: 'pipe' },
  )
  if (build.exitCode !== 0) throw new Error(build.stderr.toString() || 'fixture compilation failed')
  commandFixture = join(libexec, 'file-delivery-client.js')
})
afterAll(async () => {
  if (commandFixtureRoot !== undefined)
    await rm(commandFixtureRoot, { recursive: true, force: true })
})

test('fixture compilation preserves ordinary Markdown dependency imports', async () => {
  const yaml = await import('yaml')
  const commonmark = await import('commonmark')
  expect(yaml.parse('answer: 42')).toEqual({ answer: 42 })
  expect(new commonmark.Parser().parse('# Ready').type).toBe('document')
})

test('packet preparation refuses a symlinked parent and accepts its canonical directory', async () =>
  fixture(async (root) => {
    const parent = join(root, 'parent')
    const alias = join(root, 'alias')
    await mkdir(parent)
    await symlink(parent, alias)
    const canonical = await realpath(alias)
    const refused = new PrivateFileDeliveryOwner(new AbortController().signal)
    const accepted = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await expect(refused.prepare(join(alias, 'packet'), [])).rejects.toThrow()
      await accepted.prepare(join(canonical, 'packet'), [])
      expect(await readdir(canonical)).toEqual([])
    } finally {
      await Promise.all([refused.close(), accepted.close()])
    }
  }))

// These publisher inputs are ordinary packet data, not protected acceptance or
// native cleanup evidence. Installed checkpoint lifecycle tests own those facts.
for (const change of ['none', 'path', 'bytes', 'digest', 'missing', 'extra'] as const)
  test(`checkpoint snapshot compares canonical retained manifest fields: ${change}`, async () =>
    fixture(async (root) => {
      const source = join(root, 'source')
      await mkdir(source)
      await writeFile(join(source, 'latest.txt'), '16')
      const fd = privateOpenFileRoot(source)
      const capture = capturePrivateOutput(fd)
      closeSync(fd)
      const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
      const identity = { runId: `sha256:${'a'.repeat(64)}`, method: null, input: null }
      const manifest = capture.files.map(({ path, bytes, digest }) => ({ path, bytes, digest }))
      if (change === 'path') manifest[0]!.path = 'other.txt'
      if (change === 'bytes') manifest[0]!.bytes++
      if (change === 'digest') manifest[0]!.digest = `sha256:${'0'.repeat(64)}`
      if (change === 'missing') manifest.pop()
      if (change === 'extra') manifest.push({ ...manifest[0]!, path: 'extra.txt' })
      // Protected storage and transport decode canonical JSON, whose object key
      // order differs from the in-memory capture's field construction order.
      const checkpoint = JSON.parse(
        Buffer.from(
          canonicalJson({
            sequence: 16,
            digest: sha256(Buffer.from('packet descriptor')),
            identity,
            evidence: { sequence: 16 },
            files: { 'latest.txt': '16' },
            manifest,
          } as unknown as JsonValue),
        ).toString(),
      )
      const destination = join(root, 'packet')
      try {
        await owner.prepare(destination, [])
        const receipt = await owner.publish(
          { status: 'succeeded', runId: identity.runId, outcome: 'done', output: null, checkpoint },
          undefined,
          checkpoint,
          false,
          undefined,
          undefined,
          capture,
        )
        if (change === 'none') {
          expect(receipt).toMatchObject({ status: 'written', source: 'checkpoint' })
          expect(await readFile(join(destination, 'files/latest.txt'), 'utf8')).toBe('16')
          expect(
            JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')),
          ).toMatchObject({
            status: 'succeeded',
            checkpoint,
            delivery: receipt,
          })
        } else {
          expect(receipt).toMatchObject({ status: 'failed', code: 'INVALID_FILES' })
          await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        }
      } finally {
        await owner.close()
        capture.close()
      }
    }))

test('checkpoint packet publication preserves the supplied failure and binary manifest', async () =>
  fixture(async (root) => {
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    const bytes = Buffer.from([0, 255, 128])
    const empty = Buffer.alloc(0)
    const capture = capturePrivateRetainedOutput({
      files: [
        { path: 'artifacts/candidate/binary.bin', bytes, digest: sha256(bytes) },
        { path: 'artifacts/candidate/empty.bin', bytes: empty, digest: sha256(empty) },
      ],
      directories: ['artifacts', 'artifacts/candidate', 'artifacts/candidate/empty'],
    })
    const identity = { runId: `sha256:${'a'.repeat(64)}`, method: null, input: null }
    const checkpoint = {
      sequence: 1,
      digest: sha256(Buffer.from('checkpoint')),
      identity,
      evidence: null,
      files: {},
      artifacts: { candidate: 'opaque' },
      manifest: [
        { path: 'artifacts/candidate/binary.bin', bytes: bytes.length, digest: sha256(bytes) },
        { path: 'artifacts/candidate/empty.bin', bytes: 0, digest: sha256(empty) },
      ],
    }
    const destination = join(root, 'checkpoint-packet')
    try {
      await owner.prepare(destination, [])
      const receipt = await owner.publish(
        {
          status: 'failed',
          runId: identity.runId,
          code: 'FLOW_FAILED',
          checkpoint,
        },
        undefined,
        checkpoint,
        true,
        undefined,
        undefined,
        capture,
      )
      expect(receipt).toMatchObject({ status: 'written', source: 'checkpoint' })
      expect(await readFile(join(destination, 'files/artifacts/candidate/binary.bin'))).toEqual(
        bytes,
      )
      expect(await readFile(join(destination, 'files/artifacts/candidate/empty.bin'))).toEqual(
        empty,
      )
      expect((await readdir(join(destination, 'files/artifacts/candidate'))).sort()).toEqual([
        'binary.bin',
        'empty.bin',
      ])
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).status).toBe(
        'failed',
      )
    } finally {
      await owner.close()
      await closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(capture) })
    }
  }))

test('packet streaming cannot renew time already spent in its native delivery phase', async () =>
  fixture(async (root) => {
    for (const phase of ['expired', 'during-staging']) {
      const owner = new PrivateFileDeliveryOwner(new AbortController().signal, async () => {
        await Bun.sleep(60)
      })
      const destination = join(root, phase)
      try {
        await owner.prepare(destination, [])
        const deadline = privatePresentationNow() + (phase === 'expired' ? -1 : 30)
        expect(
          await owner.publish(record, undefined, undefined, false, undefined, deadline),
        ).toMatchObject({ status: 'failed', code: 'DEADLINE_EXCEEDED' })
        await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readdir(root)).toEqual([])
      } finally {
        await owner.close()
      }
    }
  }))
test('inspection retains only verified immutable bytes and closes previews with the owner', async () =>
  fixture(async (root) => {
    const source = join(root, 'source'),
      destination = join(root, 'packet')
    await mkdir(source)
    await writeFile(join(source, 'review.patch'), 'Original checked patch\n')
    await writeFile(join(source, 'large.txt'), 'x' + '🧭'.repeat(20000))
    await writeFile(join(source, 'binary'), Buffer.from([255, 128]))
    await writeFile(join(source, 'empty'), '')
    await writeFile(
      join(source, 'chart.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/></svg>',
    )
    const fd = privateOpenFileRoot(source),
      capture = capturePrivateOutput(fd)
    closeSync(fd)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    owner.enableInspection()
    try {
      expect(owner.preview('review.patch')).toBeUndefined()
      await owner.prepare(destination, [])
      expect((await owner.publish(record, { kind: 'snapshot', capture })).status).toBe('written')
      await writeFile(join(destination, 'files/review.patch'), 'Changed destination')
      expect(owner.preview('review.patch')?.text).toBe('Original checked patch\n')
      expect(Buffer.from(owner.read('binary')!)).toEqual(Buffer.from([255, 128]))
      expect(Buffer.from(owner.read('large.txt')!).toString('utf8')).toBe('x' + '🧭'.repeat(20000))
      const transferred = owner.read('large.txt')!
      transferred.fill(0)
      expect(owner.read('large.txt')![0]).toBe(120)
      const large = owner.preview('large.txt')!
      expect(large.clipped).toBe(true)
      expect(Buffer.byteLength(large.text)).toBeLessThanOrEqual(4096)
      expect(large.text.endsWith('🧭')).toBe(true)
      expect(large.bytes).toBe(80001)
      expect(owner.preview('binary')).toBeUndefined()
      expect(await owner.inspectionPreview('binary')).toEqual({
        state: 'non-text',
        bytes: 2,
        clipped: false,
      })
      expect(await owner.inspectionPreview('empty')).toEqual({
        state: 'empty',
        text: '',
        bytes: 0,
        clipped: false,
      })
      expect(await owner.inspectionPreview('missing')).toEqual({
        state: 'unavailable',
        bytes: 0,
        clipped: false,
      })
      const image = await owner.inspectionPreview('chart.svg')
      expect(image.state).toBe('image')
      expect(image.image?.mime).toBe('image/png')
      const expired = await owner.inspectionPreview('chart.svg', privatePresentationNow() - 1)
      expect(expired.state).toBe('text')
      expect(expired.text).toContain('<svg')
      await writeFile(join(destination, 'files/chart.svg'), 'Changed image')
      expect(await owner.inspectionPreview('chart.svg')).toEqual(image)
      await rm(destination, { recursive: true })
      expect(owner.preview('review.patch')?.text).toContain('Original')
    } finally {
      await owner.close()
      capture.close()
    }
    expect(owner.preview('review.patch')).toBeUndefined()
  }))
test('every accepted text file retains its excerpt when output exceeds the preview allowance', async () =>
  fixture(async (root) => {
    const source = join(root, 'source')
    await mkdir(source)
    for (let index = 0; index < 5; index++)
      await writeFile(join(source, `file-${index}.txt`), String(index).repeat(1024 * 1024))
    const fd = privateOpenFileRoot(source)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    owner.enableInspection()
    try {
      await owner.prepare(join(root, 'packet'), [])
      expect((await owner.publish(record, { kind: 'snapshot', capture })).status).toBe('written')
      for (let index = 0; index < 5; index++) {
        expect(await owner.inspectionPreview(`file-${index}.txt`)).toEqual({
          state: 'text',
          text: String(index).repeat(4096),
          bytes: 1024 * 1024,
          clipped: true,
        })
      }
    } finally {
      await owner.close()
      capture.close()
    }
  }))
test('image replies share one aggregate budget and reserve every text prefix', async () =>
  fixture(async (root) => {
    const source = join(root, 'source')
    await mkdir(source)
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="red"/><!--' +
      'x'.repeat(48000) +
      '--></svg>'
    let colour = 0x193a2845
    const dense =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
      Array.from({ length: 256 }, (_, index) => {
        colour = (Math.imul(colour, 1664525) + 1013904223) >>> 0
        const fill = colour.toString(16).padStart(8, '0').slice(0, 6)
        return `<rect x="${index % 16}" y="${Math.floor(index / 16)}" width="1" height="1" fill="#${fill}"/>`
      }).join('') +
      '</svg>'
    expect(Buffer.byteLength(dense)).toBeLessThanOrEqual(PRIVATE_PREVIEW_LIMITS.svgSourceBytes)
    const image = (await imagePreview.privateImagePreview(Buffer.from(dense)))!
    expect(image).toBeDefined()
    // All 64 full text prefixes consume the reply allowance. This actual PNG
    // needs more than its own fallback reservation, so it must retain text.
    expect(privatePreviewStringBytes(image.base64)).toBeGreaterThan(
      2 * PRIVATE_PREVIEW_LIMITS.textBytes,
    )
    for (let index = 0; index < 64; index++)
      await writeFile(
        join(source, `image-${String(index).padStart(2, '0')}.svg`),
        index === 63 ? dense : svg,
      )
    const fd = privateOpenFileRoot(source)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    owner.enableInspection()
    const destination = join(root, 'packet')
    try {
      await owner.prepare(destination, [])
      expect((await owner.publish(record, { kind: 'snapshot', capture })).status).toBe('written')
      expect((await owner.inspectionPreview('image-00.svg')).state).toBe('image')
      const last = await owner.inspectionPreview('image-63.svg')
      expect(last.state).toBe('text')
      expect(last.text?.length).toBe(4096)
      expect(last.clipped).toBeTrue()
      expect(await readFile(join(destination, 'files/image-63.svg'), 'utf8')).toBe(dense)
      const pending = owner.inspectionPreview('image-01.svg')
      await owner.close()
      expect((await pending).state).toBe('unavailable')
    } finally {
      await owner.close()
      capture.close()
    }
  }))
test('encoded image replies preserve text fallbacks within the complete inspection budget', async () =>
  fixture(async (root) => {
    const source = join(root, 'source')
    await mkdir(source)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    for (let index = 0; index < 4; index++) await writeFile(join(source, `image-${index}.svg`), svg)
    await writeFile(join(source, 'notes.txt'), 'Text stays available. '.repeat(500))
    const fd = privateOpenFileRoot(source)
    const output = capturePrivateOutput(fd)
    closeSync(fd)
    // Model a valid, near-limit renderer reply. Decoder validation has its own
    // process tests; this case exercises the real delivery-to-inspection seam.
    const png = Buffer.alloc(50 * 1024)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.write('IHDR', 12, 'ascii')
    png.writeUInt32BE(1, 16)
    png.writeUInt32BE(1, 20)
    const image = {
      mime: 'image/png' as const,
      width: 1,
      height: 1,
      base64: png.toString('base64'),
    }
    const decoder = spyOn(imagePreview, 'privateImagePreview').mockResolvedValue(image)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    owner.enableInspection()
    try {
      await owner.prepare(join(root, 'packet'), [])
      const receipt = await owner.publish(record, { kind: 'snapshot', capture: output })
      expect(receipt.status).toBe('written')
      // Repeated peeks reserve the same file only once.
      expect((await owner.inspectionPreview('image-0.svg')).state).toBe('image')
      expect((await owner.inspectionPreview('image-0.svg')).state).toBe('image')
      const capture = await privateCaptureDeliveryInspection(
        {
          prepare: async () => {},
          publish: async () => {
            throw new Error('Already published')
          },
          inspectionPreview: (path, options) =>
            owner.inspectionPreview(path, options.previewDeadline),
          retire: () => owner.close(),
        },
        receipt,
      )
      try {
        expect(capture.files.map((file) => file.state)).toEqual([
          'image',
          'image',
          'image',
          'text',
          'text',
        ])
        expect(capture.preview('image-3.svg')?.text).toBe(svg)
        expect(capture.preview('notes.txt')?.clipped).toBeTrue()
        const charged = capture.files.reduce((total, file) => {
          const preview = capture.preview(file.path)!
          return total + privatePreviewStringBytes(preview.image?.base64 ?? preview.text ?? '')
        }, 0)
        expect(charged).toBeLessThanOrEqual(PRIVATE_PREVIEW_LIMITS.retainedBytes)
      } finally {
        capture.close()
      }
    } finally {
      decoder.mockRestore()
      await owner.close()
      output.close()
    }
  }))
test('delivery close joins pending preparation and prevents later acquisition', async () =>
  fixture(async (root) => {
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    const preparing = owner.prepare(join(root, 'pending'), [])
    const closing = owner.close()
    expect(owner.close()).toBe(closing)
    await preparing
    await closing
    await expect(owner.prepare(join(root, 'new'), [])).rejects.toThrow('unavailable')
  }))
test('delivery close joins original publication without changing its admitted receipt', async () =>
  fixture(async (root) => {
    let continuePublication!: () => void
    const pending = new Promise<void>((resolve) => {
      continuePublication = resolve
    })
    let staged!: () => void
    const ready = new Promise<void>((resolve) => {
      staged = resolve
    })
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal, async () => {
      staged()
      await pending
    })
    await owner.prepare(join(root, 'packet'), [])
    const publishing = owner.publish(record, undefined)
    await ready
    const closing = owner.close()
    expect(owner.close()).toBe(closing)
    await expect(owner.publish(record, undefined)).rejects.toThrow('unavailable')
    continuePublication()
    expect(await publishing).toMatchObject({ status: 'written' })
    await closing
    expect(JSON.parse(await readFile(join(root, 'packet/result.json'), 'utf8')).status).toBe(
      'succeeded',
    )
  }))
test('publishes immutable binary and empty output after its source storage is removed', async () =>
  fixture(async (root) => {
    const source = join(root, 'source')
    await mkdir(join(source, 'nested'), { recursive: true })
    await writeFile(join(source, 'nested/binary'), Buffer.from([0, 255, 128]))
    await writeFile(join(source, 'empty'), '')
    const fd = privateOpenFileRoot(source)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    await rm(source, { recursive: true })
    const destination = join(root, 'result')
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await owner.prepare(destination, [])
      const receipt = await owner.publish(record, { kind: 'snapshot', capture })
      expect(receipt).toMatchObject({ status: 'written', source: 'final' })
      expect(receipt.files?.map((file) => file.path)).toEqual(['empty', 'nested/binary'])
      expect([...(await readFile(join(destination, 'files/nested/binary')))]).toEqual([0, 255, 128])
      expect((await readFile(join(destination, 'files/empty'))).length).toBe(0)
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toEqual({
        ...record,
        delivery: receipt,
      })
    } finally {
      capture.close()
      await owner.close()
    }
  }))
test('copied or closed output capabilities and cleanup failure never authorize final files', async () =>
  fixture(async (root) => {
    const fd = privateOpenFileRoot(root)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    try {
      for (const mode of ['copied', 'cleanup', 'closed']) {
        if (mode === 'closed') capture.close()
        const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
        try {
          await owner.prepare(join(root, mode), [])
          expect(
            await owner.publish(mode === 'cleanup' ? { ...record, cleanup: {} } : record, {
              kind: 'snapshot',
              capture: mode === 'copied' ? { ...capture } : capture,
            }),
          ).toMatchObject({ status: 'failed', code: 'INVALID_FILES' })
        } finally {
          await owner.close()
        }
      }
      expect(await readdir(root)).toEqual([])
    } finally {
      capture.close()
    }
  }))
test('checkpoint packet selection respects cancellation, cleanup fields and output collisions', async () =>
  fixture(async (root) => {
    for (const mode of [
      'cancelled',
      'cleanup',
      'empty-cleanup',
      'collision',
      'absent',
      'late-success',
    ]) {
      const abort = new AbortController()
      const owner = new PrivateFileDeliveryOwner(abort.signal)
      const retained = {
        identity: { runId: `sha256:${'a'.repeat(64)}`, method: null, input: null },
        sequence: 1,
        digest: sha256(Buffer.from('publisher descriptor')),
        evidence: { passed: false },
        files: { 'saved.txt': 'accepted bytes' },
      }
      const destination = join(root, mode)
      try {
        await owner.prepare(destination, [])
        abort.abort()
        if (mode === 'collision') {
          await mkdir(destination)
          await writeFile(join(destination, 'keep'), 'unrelated')
        }
        const record = {
          status: mode === 'late-success' ? 'succeeded' : 'lost',
          ...(mode === 'late-success'
            ? { outcome: 'done', output: null }
            : { code: 'COORDINATOR_LOST' }),
          runId: retained.identity.runId,
          ...(mode === 'cleanup' || mode === 'empty-cleanup'
            ? { cleanup: { status: 'failed' } }
            : {}),
          checkpoint: mode === 'absent' || mode === 'empty-cleanup' ? null : retained,
        }
        const receipt = await owner.publish(
          record as any,
          undefined,
          mode === 'absent' || mode === 'empty-cleanup' ? undefined : retained,
          true,
        )
        if (mode === 'cancelled' || mode === 'late-success') {
          expect(receipt).toMatchObject({ status: 'written', source: 'checkpoint' })
          expect(await readFile(join(destination, 'files/saved.txt'), 'utf8')).toBe(
            'accepted bytes',
          )
          expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).status).toBe(
            mode === 'late-success' ? 'succeeded' : 'lost',
          )
        } else if (mode === 'absent') {
          expect(receipt).toMatchObject({ status: 'written', source: 'none' })
          expect(await readdir(join(destination, 'files'))).toEqual([])
        } else {
          expect(receipt).toMatchObject({
            status: 'failed',
            code:
              mode === 'cleanup'
                ? 'INVALID_FILES'
                : mode === 'empty-cleanup'
                  ? 'CANCELLED'
                  : 'DESTINATION_CHANGED',
          })
          if (mode === 'collision')
            expect(await readFile(join(destination, 'keep'), 'utf8')).toBe('unrelated')
          else await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        }
      } finally {
        await owner.close()
      }
    }
  }))
test('ordinary terminal-only reporting preserves cleanup failure without claiming retained files', async () =>
  fixture(async (root) => {
    const abort = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal)
    const destination = join(root, 'result')
    const failedCleanup = { ...record, cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' } }
    try {
      await owner.prepare(destination, [])
      expect(await owner.publish(failedCleanup, undefined, undefined, true)).toMatchObject({
        status: 'written',
        source: 'none',
        files: [],
      })
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toMatchObject({
        cleanup: failedCleanup.cleanup,
        delivery: { status: 'written', source: 'none', files: [] },
      })
      expect(await readdir(join(destination, 'files'))).toEqual([])
    } finally {
      await owner.close()
    }
  }))
test('late cancellation rejects cleanup-failed terminal retention with an empty checkpoint binding', async () =>
  fixture(async (root) => {
    const abort = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal, async () => abort.abort())
    try {
      await owner.prepare(join(root, 'result'), [])
      expect(
        await owner.publish(
          { ...record, cleanup: { status: 'failed', code: 'PROJECT_CLOSE_FAILED' } },
          undefined,
          undefined,
          true,
        ),
      ).toMatchObject({ status: 'failed', code: 'CANCELLED' })
      expect(await readdir(root)).toEqual([])
    } finally {
      await owner.close()
    }
  }))
test('a checkpoint descriptor never makes final-file capture survive cancellation', async () =>
  fixture(async (root) => {
    const abort = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal)
    const checkpoint = {
      identity: { runId: `sha256:${'a'.repeat(64)}`, method: null, input: null },
      sequence: 1,
      digest: sha256(Buffer.from('publisher descriptor')),
      evidence: null,
      files: { 'saved.txt': 'packet text' },
    }
    try {
      await owner.prepare(join(root, 'result'), [])
      abort.abort()
      // Cancellation must reject before consulting any final-file descriptor,
      // even with a checkpoint descriptor and interrupted-record permission.
      expect(
        await owner.publish(record, { kind: 'linux-directory', fd: 0 }, checkpoint, true),
      ).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
      })
      await expect(stat(join(root, 'result'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await owner.close()
    }
  }))
for (const mode of ['cancel', 'success', 'cleanup-failed'] as const) {
  test(`cooperative interruption waits for settled ${mode} evidence before delivery`, async () =>
    fixture(async (root) => {
      const destination = join(root, 'review'),
        pidFile = join(root, 'pid'),
        readyFile = join(root, 'ready')
      const abort = new AbortController()
      let stagedAfterSettlement = false
      const invocation = privateOwnFileCommand(
        [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', commandFixture],
        [destination, pidFile, `settled-${mode}`, readyFile],
        abort.signal,
        3000,
        async () => {
          stagedAfterSettlement = (await readFile(readyFile, 'utf8')) === 'settled'
        },
      )
      try {
        const readinessDeadline = performance.now() + 1500
        while ((await readFile(readyFile, 'utf8').catch(() => '')) !== 'ready') {
          if (performance.now() >= readinessDeadline) throw new Error('fixture readiness missing')
          await Bun.sleep(5)
        }
        const interrupted = performance.now()
        abort.abort()
        expect(await invocation).toEqual({
          exitCode: mode === 'cleanup-failed' ? 3 : 2,
          signal: null,
        })
        expect(performance.now() - interrupted).toBeGreaterThan(600)
        if (mode === 'cleanup-failed') {
          expect(stagedAfterSettlement).toBe(false)
          await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
        } else {
          expect(stagedAfterSettlement).toBe(true)
          expect(
            JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')),
          ).toMatchObject({
            status: mode === 'success' ? 'succeeded' : 'failed',
            command: { status: 'interrupted' },
            delivery: { status: 'written', source: 'none', files: [] },
          })
          expect(await readdir(join(destination, 'files'))).toEqual([])
        }
        const pid = await fixturePid(pidFile)
        expect(() => process.kill(pid, 0)).toThrow()
        expect((await readdir(root)).filter((name) => name.startsWith('.jig-delivery-'))).toEqual(
          [],
        )
      } finally {
        abort.abort()
        await invocation
      }
    }))
}
for (const trigger of ['deadline', 'cancel', 'late-cancel'] as const) {
  for (const phase of ['before', 'during', 'after'] as const) {
    if (trigger === 'late-cancel' && phase !== 'before') continue
    test(
      `settles a stopped coordinator on ${trigger} ${phase} publication`,
      async () =>
        fixture(async (root) => {
          const destination = join(root, 'review'),
            pidFile = join(root, 'pid'),
            readyFile = join(root, 'ready')
          const abort = new AbortController()
          let pid: number | undefined,
            rescued = false,
            settled = false,
            stopped = false
          const watchdog = setTimeout(async () => {
            rescued = true
            try {
              process.kill(pid ?? (await fixturePid(pidFile)), 'SIGKILL')
            } catch {}
          }, 2500)
          const started = performance.now()
          let lateCancellation: ReturnType<typeof setTimeout> | undefined
          const invocation = privateOwnFileCommand(
            [
              process.execPath,
              '--no-env-file',
              '--no-install',
              '--config=/dev/null',
              commandFixture,
            ],
            [destination, pidFile, phase, readyFile],
            abort.signal,
            700,
            async () => {
              if (phase !== 'during') return
              pid = await fixturePid(pidFile)
              process.kill(pid, 'SIGSTOP')
              await waitUntilStopped(pid)
              stopped = true
              if (trigger === 'cancel') abort.abort()
              else await Bun.sleep(800) // Keep staging uncommitted until the deadline fires.
            },
          ).finally(() => {
            settled = true
          })
          try {
            if (phase !== 'during') {
              while (!settled) {
                try {
                  await readFile(readyFile)
                  pid = await fixturePid(pidFile)
                  await waitUntilStopped(pid)
                  stopped = true
                  break
                } catch {
                  await Bun.sleep(5)
                }
              }
              if (trigger === 'cancel') abort.abort()
              else if (trigger === 'late-cancel') {
                // Use actual elapsed time, not a replacement of the owner's timer.
                // This exercises the deadline/cancellation race, not timer internals.
                lateCancellation = setTimeout(
                  () => abort.abort(),
                  Math.max(0, started + 800 - performance.now()),
                )
              }
            }
            const exit = await invocation
            expect(stopped).toBe(true)
            expect(exit.signal).toBe('SIGKILL')
            if (trigger === 'late-cancel') expect(abort.signal.aborted).toBe(true)
            expect(rescued).toBe(false)
            expect(performance.now() - started).toBeLessThan(
              700 + PRIVATE_FILE_COMMAND_STOP_GRACE_MS + 1000,
            )
            pid ??= await fixturePid(pidFile)
            expect(() => process.kill(pid!, 0)).toThrow()
            expect(
              (await readdir(root)).filter((name) => name.startsWith('.jig-delivery-')),
            ).toEqual([])
            if (phase === 'after')
              expect(
                JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).outcome,
              ).toBe('blocked')
            else await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
          } finally {
            clearTimeout(lateCancellation)
            clearTimeout(watchdog)
            if (!settled && pid !== undefined) process.kill(pid, 'SIGKILL')
            await invocation
          }
        }),
      5000,
    )
  }
}
test('publishes record-only outcomes in one private packet with fixed permissions', async () =>
  fixture(async (root) => {
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal),
      destination = join(root, 'review')
    try {
      await owner.prepare(destination, [])
      const delivery = await owner.publish(record, undefined)
      expect(delivery).toMatchObject({ status: 'written', files: [] })
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toEqual({
        ...record,
        delivery,
      })
      expect((await stat(destination)).mode & 0o777).toBe(0o700)
      expect((await stat(join(destination, 'result.json'))).mode & 0o777).toBe(0o600)
    } finally {
      await owner.close()
    }
    expect(await readdir(root)).toEqual(['review'])
  }))
test('rejects destinations inside selected roots and existing destinations before work', async () =>
  fixture(async (root) => {
    const fd = privateOpenFileRoot(root)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await expect(owner.prepare(join(root, 'review'), [fd])).rejects.toThrow()
    } finally {
      closeSync(fd)
      await owner.close()
    }
    const second = new PrivateFileDeliveryOwner(new AbortController().signal)
    try {
      await expect(second.prepare(root, [])).rejects.toThrow()
    } finally {
      await second.close()
    }
  }))
test('cleans staging when cancellation or a destination collision wins publication', async () =>
  fixture(async (root) => {
    for (const mode of ['cancel', 'collision']) {
      const signal = new AbortController(),
        destination = join(root, mode)
      const owner = new PrivateFileDeliveryOwner(signal.signal, async () => {
        if (mode === 'cancel') signal.abort()
        else {
          await mkdir(destination)
          await writeFile(join(destination, 'keep'), 'untouched')
        }
      })
      try {
        await owner.prepare(destination, [])
        expect(await owner.publish(record, undefined)).toMatchObject({
          status: 'failed',
          code: mode === 'cancel' ? 'CANCELLED' : 'DESTINATION_CHANGED',
        })
      } finally {
        await owner.close()
      }
    }
    expect(await readdir(root)).toEqual(['collision'])
    expect(await readFile(join(root, 'collision', 'keep'), 'utf8')).toBe('untouched')
  }))
test('publication which already won is not retracted by later cancellation', async () =>
  fixture(async (root) => {
    const signal = new AbortController(),
      owner = new PrivateFileDeliveryOwner(signal.signal),
      destination = join(root, 'review')
    await owner.prepare(destination, [])
    expect((await owner.publish(record, undefined)).status).toBe('written')
    signal.abort()
    await owner.close()
    expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8')).outcome).toBe(
      'blocked',
    )
  }))
test('a delivery budget expiry preserves execution and cleans uncommitted staging', async () =>
  fixture(async (root) => {
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal, async () => {
      await Bun.sleep(60)
    })
    try {
      await owner.prepare(join(root, 'review'), [])
      const deadline = privatePresentationNow() + 30
      expect(
        await owner.publish(record, undefined, undefined, false, undefined, deadline),
      ).toMatchObject({
        status: 'failed',
        code: 'DEADLINE_EXCEEDED',
      })
      expect(record.status).toBe('succeeded')
      expect(await readdir(root)).toEqual([])
    } finally {
      await owner.close()
    }
  }))
test('a substituted output parent never redirects publication or cleanup', async () =>
  fixture(async (root) => {
    const parent = join(root, 'parent'),
      moved = join(root, 'moved')
    await mkdir(parent)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal, async () => {
      await rename(parent, moved)
      await mkdir(parent)
      await writeFile(join(parent, 'keep'), 'not owned staging')
    })
    try {
      await owner.prepare(join(parent, 'review'), [])
      expect(await owner.publish(record, undefined)).toMatchObject({
        status: 'failed',
        code: 'DESTINATION_CHANGED',
      })
      expect(await readdir(moved)).toEqual([])
      expect(await readFile(join(parent, 'keep'), 'utf8')).toBe('not owned staging')
    } finally {
      await owner.close()
    }
  }))
test(
  'the separate command owner removes staging after its coordinator is killed during copying',
  async () =>
    fixture(async (root) => {
      const destination = join(root, 'review'),
        pidFile = join(root, 'coordinator.pid')
      const exit = await privateOwnFileCommand(
        [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', commandFixture],
        [destination, pidFile],
        undefined,
        10000,
        async () => {
          const pid = Number(await readFile(pidFile, 'utf8'))
          expect(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid).toBe(true)
          process.kill(pid, 'SIGKILL')
          await Bun.sleep(30)
        },
      )
      expect(exit.signal).toBe('SIGKILL')
      expect(await readdir(root)).toEqual(['coordinator.pid'])
    }),
  15000,
)
test('retained terminal publication still removes staging when its coordinator is lost', async () =>
  fixture(async (root) => {
    const abort = new AbortController(),
      lost = new AbortController()
    const owner = new PrivateFileDeliveryOwner(abort.signal, async () => lost.abort())
    try {
      await owner.prepare(join(root, 'result'), [])
      abort.abort()
      expect(await owner.publish(record, undefined, undefined, true, lost.signal)).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
      })
      expect(await readdir(root)).toEqual([])
    } finally {
      await owner.close()
    }
  }))
