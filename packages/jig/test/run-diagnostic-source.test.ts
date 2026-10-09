import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type PrivateRunDiagnosticSource,
  privateRunDiagnosticObserver,
} from '../src/internal/run-channels.js'
import { ChannelBroker } from '../src/run/channels.js'
import { settleTestCommand } from './fixtures/bounded-command.js'

test('root stderr retains exact bytes and actual emitter without inventing a call', () => {
  const broker = new ChannelBroker()
  const root = broker.participant('root')
  const records: {
    bytes: Uint8Array
    operations?: readonly string[]
    source?: PrivateRunDiagnosticSource
  }[] = []
  const output = {
    diagnostic(
      bytes: Uint8Array,
      operations?: readonly string[],
      source?: PrivateRunDiagnosticSource,
    ) {
      expect(this).toBe(output)
      records.push({ bytes, operations, source })
    },
  }
  const observe = privateRunDiagnosticObserver({ output, emitter: root })
  const first = new Uint8Array([0xe2, 0x82])
  const second = new Uint8Array([0xac])
  observe(first)
  observe(second)
  expect(records.map(({ bytes }) => bytes)).toEqual([first, second])
  expect(records[0]?.bytes).toBe(first)
  expect(records[0]?.operations).toBeUndefined()
  expect(records[0]?.source).toEqual({ emitter: root.id })
  expect(records[1]?.source).toBe(records[0]?.source)
  root.finalize(true)
})

test('diagnostic binding snapshots caller identity and path without path-based joins', () => {
  const broker = new ChannelBroker()
  const caller = broker.participant('flow:actual-parent')
  const child = broker.participant('flow:flattened-private-execution')
  const call = { caller, operationId: 'original-own-operation' }
  const operations = ['unrelated-path-label', 'same']
  let recordedSource: PrivateRunDiagnosticSource | undefined
  let recordedPath: readonly string[] | undefined
  const observe = privateRunDiagnosticObserver({
    emitter: child,
    call,
    operations,
    output: {
      diagnostic(_bytes, path, source) {
        recordedPath = path
        recordedSource = source
      },
    },
  })
  call.operationId = 'later-changed-operation'
  operations[0] = 'later-changed-path'
  observe(new Uint8Array([0x61]))
  expect(recordedSource).toEqual({
    emitter: child.id,
    call: { publisher: caller.id, operationId: 'original-own-operation' },
  })
  expect(recordedPath).toEqual(['unrelated-path-label', 'same'])
  expect(Object.isFrozen(recordedSource)).toBe(true)
  expect(Object.isFrozen(recordedSource?.call)).toBe(true)
  caller.finalize(true)
  child.finalize(true)
})

test('missing actual emitter leaves diagnostics unattributed even with a caller and path', () => {
  const broker = new ChannelBroker()
  const caller = broker.participant('root')
  let recordedSource: PrivateRunDiagnosticSource | undefined
  let recordedPath: readonly string[] | undefined
  privateRunDiagnosticObserver({
    call: { caller, operationId: 'same' },
    operations: ['root', 'same'],
    output: {
      diagnostic(_bytes, path, source) {
        recordedPath = path
        recordedSource = source
      },
    },
  })(new Uint8Array([0x61]))
  expect(recordedSource).toBeUndefined()
  expect(recordedPath).toEqual(['root', 'same'])
  caller.finalize(true)
})

test('actual child binding preserves direct and nested original caller operation IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-diagnostic-source-'))
  try {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'root-flow-call-diagnostics.ts'), root],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'diagnostics'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('child diagnostic source binding passed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
