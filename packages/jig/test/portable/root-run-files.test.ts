import { expect, test } from 'bun:test'
import {
  capturePrivateRetainedOutput,
  readPrivateCapturedOutput,
  requirePrivateCapturedOutput,
} from '../../src/internal/captured-output.js'
import {
  privateSnapshotExecutionOutput,
  resolvePrivateExecutionOutput,
} from '../../src/internal/execution-output.js'
import { sha256 } from '../../src/internal/file-input.js'
import {
  capturePrivateFlowArtifact,
  commitPrivateFlowArtifact,
  releasePrivateFlowArtifact,
} from '../../src/internal/flow-file-context.js'
import {
  normalizePrivateRunFileIdentity,
  PrivateRootFileInputLimitError,
  PrivateRootFileMappingError,
  PrivateRootRunFiles,
  requirePrivateRootFileMapping,
} from '../../src/internal/root-run-files.js'
import type { PrivateActivationRequest } from '../../src/project/package-resolution.js'

const digest = `sha256:${'0'.repeat(64)}`
const file = (path: string, bytes = 0) => ({ path, bytes, digest })

test('checkpoint retention needs no writable attachment and resolves only current root rights', async () => {
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
  let commits = 0
  try {
    await files.bindCheckpoint(
      `sha256:${'a'.repeat(64)}`,
      request,
      null,
      '/unused',
      1,
      async ({ value, artifacts }) => {
        commits++
        if (value.artifacts)
          expect(readPrivateCapturedOutput(artifacts.candidate!)[0]!.contents).toEqual(bytes)
        return { sequence: value.sequence, digest }
      },
    )
    expect(await files.saveCheckpoint({ sequence: 1, evidence: null, files: {} }, context)).toEqual(
      { sequence: 1, digest },
    )
    expect(
      await files.saveCheckpoint(
        {
          sequence: 2,
          evidence: null,
          files: {},
          artifacts: { candidate: reference },
        },
        context,
      ),
    ).toEqual({ sequence: 2, digest })
    await expect(
      files.saveCheckpoint(
        {
          sequence: 3,
          evidence: null,
          files: {},
          artifacts: { candidate: 'guessed' },
        },
        context,
      ),
    ).rejects.toThrow()
    releasePrivateFlowArtifact(context, reference)
    await expect(
      files.saveCheckpoint(
        {
          sequence: 3,
          evidence: null,
          files: {},
          artifacts: { candidate: reference },
        },
        context,
      ),
    ).rejects.toThrow()
    expect(commits).toBe(2)
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
