import { expect, test } from 'bun:test'
import { closeSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RootAdministrationError } from '../../src/administration/root.js'
import { CheckError } from '../../src/diagnostics.js'
import {
  capturePrivateOutput,
  capturePrivateRetainedOutput,
  readPrivateCapturedOutput,
  requirePrivateCapturedOutput,
} from '../../src/internal/captured-output.js'
import {
  privateSnapshotExecutionOutput,
  resolvePrivateExecutionOutput,
} from '../../src/internal/execution-output.js'
import { PrivateFileDeliveryOwner } from '../../src/internal/file-delivery.js'
import { privateOpenFileRoot, sha256 } from '../../src/internal/file-input.js'
import {
  capturePrivateFlowArtifact,
  commitPrivateFlowArtifact,
  releasePrivateFlowArtifact,
  selectedPrivateFlowArtifacts,
} from '../../src/internal/flow-file-context.js'
import { administrationError } from '../../src/internal/root-administration-controller.js'
import {
  normalizePrivateRunFileIdentity,
  PrivateRootFileInputLimitError,
  PrivateRootFileMappingError,
  PrivateRootRunFiles,
  requirePrivateRootFileMapping,
} from '../../src/internal/root-run-files.js'
import type { PrivateActivationRequest } from '../../src/project/package-resolution.js'
import { fixture } from '../file-delivery.fixture.js'

const digest = `sha256:${'0'.repeat(64)}`
const file = (path: string, bytes = 0) => ({ path, bytes, digest })

test('successful checkpoint-only packets ignore undeclared native output and retain its retirement owner', async () =>
  fixture(async (root) => {
    const source = join(root, 'source')
    await mkdir(source)
    await writeFile(join(source, 'undeclared.txt'), 'not a final attachment')
    const fd = privateOpenFileRoot(source)
    const capture = capturePrivateOutput(fd)
    closeSync(fd)
    const files = new PrivateRootRunFiles([], false)
    const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
    const request = {
      attachments: {},
      package: { digest },
      settings: {},
      slots: { progress: { kind: 'native', native: 'run-checkpoint' } },
    } as unknown as PrivateActivationRequest
    const runId = `sha256:${'a'.repeat(64)}`
    const { context } = files.projection(runId, request, files.identity)
    const output = privateSnapshotExecutionOutput(Promise.resolve(capture))
    files.retainOutput(output)
    // Ordinary packet data tests selection, not protected checkpoint acceptance.
    const checkpoint = {
      sequence: 16,
      digest: sha256(Buffer.from('packet descriptor')),
      identity: { runId, method: null, input: null },
      evidence: { completed: true },
      files: { 'saved.txt': 'latest saved aggregate' },
    }
    try {
      expect(files.deliveryOutput()).toBeUndefined()
      expect(files.output).toBe(output)
      expect(requirePrivateCapturedOutput(capture).files.map((file) => file.path)).toEqual([
        'undeclared.txt',
      ])
      const destination = join(root, 'packet')
      await owner.prepare(destination, [])
      const record = { status: 'succeeded', runId, outcome: 'done', output: null, checkpoint }
      const receipt = await owner.publish(record, files.deliveryOutput(), checkpoint)
      expect(receipt).toMatchObject({ status: 'written', source: 'checkpoint' })
      expect(await readFile(join(destination, 'files/saved.txt'), 'utf8')).toBe(
        'latest saved aggregate',
      )
      expect(JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))).toEqual({
        ...record,
        delivery: receipt,
      })
    } finally {
      context.close()
      await files.close()
      await owner.close()
    }
    expect(() => requirePrivateCapturedOutput(capture)).toThrow()
  }))

for (const mode of ['none', 'empty-native', 'forwarded'] as const)
  test(`root packet source selection preserves ${mode} output meaning`, async () =>
    fixture(async (root) => {
      const source = join(root, 'source')
      await mkdir(source)
      const fd = privateOpenFileRoot(source)
      const capture = capturePrivateOutput(fd)
      closeSync(fd)
      const files = new PrivateRootRunFiles([], mode === 'empty-native')
      const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
      const request = {
        attachments: mode === 'empty-native' ? { files: 'read-write' } : {},
        artifactResults: mode === 'forwarded' ? ['selected'] : [],
        package: { digest },
        settings: {},
        slots: {},
      } as unknown as PrivateActivationRequest
      const { context } = files.projection('source-selection', request, files.identity)
      const output = privateSnapshotExecutionOutput(Promise.resolve(capture))
      files.retainOutput(output)
      try {
        if (mode === 'forwarded') {
          const held = await capturePrivateFlowArtifact(context, output)
          const reference = commitPrivateFlowArtifact(context, held)
          files.retainArtifacts(context, ['selected'], { selected: reference })
        }
        const selected = files.deliveryOutput()
        expect(selected === undefined).toBe(mode === 'none')
        if (selected?.kind === 'linux-directory') throw new Error('expected snapshot output')
        const packetOutput =
          selected === undefined
            ? undefined
            : { kind: 'snapshot' as const, capture: await selected.ready }
        const destination = join(root, 'packet')
        await owner.prepare(destination, [])
        expect(
          await owner.publish(
            { status: 'succeeded', runId: 'source-selection', outcome: 'done', output: null },
            packetOutput,
          ),
        ).toMatchObject({
          status: 'written',
          source: mode === 'none' ? 'none' : 'final',
          files: [],
        })
      } finally {
        context.close()
        await files.close()
        await owner.close()
      }
      expect(() => requirePrivateCapturedOutput(capture)).toThrow()
    }))

test('checkpoint association selection needs no writable attachment and resolves only current root rights', async () => {
  const files = new PrivateRootRunFiles([], false)
  const request = {
    attachments: {},
    package: { digest },
    settings: {},
    slots: { progress: { kind: 'native', native: 'run-checkpoint' } },
  } as unknown as PrivateActivationRequest
  const { context } = files.projection(`sha256:${'a'.repeat(64)}`, request, files.identity)
  const bytes = Buffer.from([0, 255, 128])
  const snapshot = capturePrivateRetainedOutput({
    files: [{ path: 'binary.bin', bytes, digest: sha256(bytes) }],
    directories: [],
  })
  const held = await capturePrivateFlowArtifact(
    context,
    privateSnapshotExecutionOutput(Promise.resolve(snapshot)),
  )
  const reference = commitPrivateFlowArtifact(context, held)
  try {
    expect(selectedPrivateFlowArtifacts(context, [], {})).toEqual({})
    const selected = selectedPrivateFlowArtifacts(context, ['candidate'], { candidate: reference })
    expect(readPrivateCapturedOutput(selected.candidate!)[0]!.contents).toEqual(bytes)
    expect(() =>
      selectedPrivateFlowArtifacts(context, ['candidate'], { candidate: 'guessed' }),
    ).toThrow()
    releasePrivateFlowArtifact(context, reference)
    expect(() =>
      selectedPrivateFlowArtifacts(context, ['candidate'], { candidate: reference }),
    ).toThrow()
  } finally {
    context.close()
    await files.close()
  }
})

test('native root output intent needs no export path or delivery connection', async () => {
  const files = new PrivateRootRunFiles([], true)
  const request = {
    attachments: { files: 'read-write' },
    package: { digest },
    settings: {},
    slots: {},
  } as unknown as PrivateActivationRequest
  try {
    const projected = files.projection('run-1', request, files.identity)
    expect(files.identity.output).toBe(true)
    expect(projected.plan.output).toBe(true)
    expect(projected.attachments.files).toEqual({ access: 'read-write', path: '/jig-output' })
    projected.context.close()
    expect(() =>
      normalizePrivateRunFileIdentity({ attachments: [], output: '/host/export' }),
    ).toThrow()
    expect(() => normalizePrivateRunFileIdentity({ attachments: [], output: null })).toThrow()
  } finally {
    await files.close()
  }
})

test('native and forwarded root artifacts survive live rights and retire through one file owner', async () => {
  const bytes = Buffer.from([0, 255, 1, 128])
  const native = capturePrivateRetainedOutput({
    files: [{ path: 'binary.bin', bytes, digest: sha256(bytes) }],
    directories: [],
  })
  const forwarded = capturePrivateRetainedOutput({
    files: [{ path: 'empty.txt', bytes: Buffer.alloc(0), digest: sha256(Buffer.alloc(0)) }],
    directories: ['empty'],
  })
  const files = new PrivateRootRunFiles([], true)
  const request = {
    attachments: { files: 'read-write' },
    artifactResults: ['final'],
    package: { digest },
    settings: {},
    slots: {},
  } as unknown as PrivateActivationRequest
  const { context } = files.projection('root-artifacts', request, files.identity)
  try {
    files.retainOutput(privateSnapshotExecutionOutput(Promise.resolve(native)))
    const selected = await capturePrivateFlowArtifact(
      context,
      privateSnapshotExecutionOutput(Promise.resolve(forwarded)),
    )
    const reference = commitPrivateFlowArtifact(context, selected)
    files.retainArtifacts(context, ['final'], { final: reference })
    await files.retainNativeArtifacts(context)
    expect(Object.keys(files.artifacts).sort()).toEqual(['files', 'final'])
    expect(files.artifacts.files).toBe(native)
    expect(files.artifacts.final).toBe(forwarded)
    context.close()
    expect(readPrivateCapturedOutput(files.artifacts.files!)[0]!.contents).toEqual(bytes)
    expect(requirePrivateCapturedOutput(files.artifacts.final!).directories).toEqual(['empty'])
    const delivery = files.deliveryOutput()!
    expect(files.deliveryOutput()).toBe(delivery)
    const packet = await resolvePrivateExecutionOutput(delivery)
    expect('files' in packet).toBe(true)
    if (!('files' in packet)) throw new Error('expected immutable packet snapshot')
    expect(packet.files.map((file) => file.path)).toEqual(['binary.bin', 'final/empty.txt'])
    expect(files.artifactResultNames).toEqual(['final'])
    await expect(files.retainNativeArtifacts(context)).rejects.toThrow('unavailable')
    const closed = files.close()
    expect(files.close()).toBe(closed)
    await closed
    expect(() => requirePrivateCapturedOutput(native)).toThrow()
    expect(() => requirePrivateCapturedOutput(forwarded)).toThrow()
  } finally {
    context.close()
    await files.close()
  }
})

test('mapping refusal lists all missing reads, invalid names, bound overrides and writable names', () => {
  const request = {
    attachments: { source: 'read', reference: 'read', retained: 'read', evidence: 'read-write' },
    boundAttachments: { retained: { files: [] } },
  } as unknown as PrivateActivationRequest
  const identity = normalizePrivateRunFileIdentity({
    attachments: [
      { name: 'unknown', files: [] },
      { name: 'retained', files: [] },
    ],
    output: false,
  })
  let caught: unknown
  try {
    requirePrivateRootFileMapping(request, identity)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(PrivateRootFileMappingError)
  expect((caught as PrivateRootFileMappingError).fileMapping).toEqual({
    missingReads: ['reference', 'source'],
    unknownNames: ['unknown'],
    boundOverrides: ['retained'],
    missingWritableDestination: ['evidence'],
  })
  for (const operation of ['start root Run', 'start prepared root Run']) {
    const normalized = administrationError(caught, operation)
    expect(normalized).toBeInstanceOf(RootAdministrationError)
    expect(normalized.code).toBe('INVALID_REQUEST')
    expect(normalized.details).toEqual({
      code: 'RUN_ATTACHMENTS_INVALID',
      fileMapping: (caught as PrivateRootFileMappingError).fileMapping,
    })
  }
  expect(JSON.stringify((caught as PrivateRootFileMappingError).fileMapping)).not.toContain('/')
  expect(() =>
    requirePrivateRootFileMapping(
      request,
      normalizePrivateRunFileIdentity({
        attachments: [
          { name: 'source', files: [] },
          { name: 'reference', files: [] },
        ],
        output: true,
      }),
    ),
  ).not.toThrow()
})

test('empty declared input trees remain valid and ordering does not change mapping meaning', () => {
  const request = {
    attachments: { second: 'read', first: 'read' },
  } as unknown as PrivateActivationRequest
  const identity = normalizePrivateRunFileIdentity({
    attachments: [
      { name: 'second', files: [] },
      { name: 'first', files: [] },
    ],
    output: false,
  })
  expect(() => requirePrivateRootFileMapping(request, identity)).not.toThrow()
})

test('combined retained and per-run file count and byte limits remain authoritative', () => {
  for (const files of [
    Array.from({ length: 64 }, (_, index) => file(`file-${index}`)),
    [file('large', 8 * 1024 * 1024)],
  ]) {
    const request = {
      attachments: { source: 'read', retained: 'read' },
      boundAttachments: { retained: { files: [file('retained', 1)] } },
    } as unknown as PrivateActivationRequest
    const identity = normalizePrivateRunFileIdentity({
      attachments: [{ name: 'source', files }],
      output: false,
    })
    expect(() => requirePrivateRootFileMapping(request, identity)).toThrow(
      PrivateRootFileInputLimitError,
    )
  }
})

test('only bounded attachment names can enter the closed diagnostic', () => {
  expect(
    () =>
      new PrivateRootFileMappingError({
        missingReads: ['private/path'],
        unknownNames: [],
        boundOverrides: [],
        missingWritableDestination: [],
      }),
  ).toThrow()
  expect(
    () =>
      new PrivateRootFileMappingError({
        missingReads: Array.from({ length: 9 }, (_, index) => `name-${index}`),
        unknownNames: [],
        boundOverrides: [],
        missingWritableDestination: [],
      }),
  ).toThrow()
})

test('prepared acceptance normalization never labels integrity or cleanup failures as file input', () => {
  for (const error of [
    new TypeError('/private/input integrity failure'),
    new CheckError('invalid', 'ADMISSION_STATE_INVALID', '/private/store integrity failure'),
    new AggregateError([new PrivateRootFileInputLimitError()], '/private/cleanup failure'),
  ]) {
    const normalized = administrationError(error, 'start prepared root Run')
    expect(normalized.code).toBe('INTERNAL')
    expect(normalized.details).toBeUndefined()
    expect(normalized.message).not.toContain('/private')
  }
  expect(
    administrationError(new PrivateRootFileInputLimitError(), 'start prepared root Run').details,
  ).toEqual({ code: 'RUN_ATTACHMENTS_INVALID', fileLimitExceeded: true })
})
