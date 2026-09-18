import { expect, test } from 'bun:test'
import { type JsonValue, OperationError } from '@jigging/flow'
import { repair } from '../flows/repair/repair.ts'
import { input, proposal, recorded } from './fixture.ts'

const reference = '11111111-1111-4111-8111-111111111111'
const retained = { status: 'retained', reference }

async function exercise(
  options: {
    enabled?: boolean
    receipt?: JsonValue
    omitReceipt?: boolean
    firstPass?: boolean
    secondPass?: boolean
    invalidFirst?: boolean
    failRestore?: boolean
    failCommand?: boolean
    cancelAfterCheck?: boolean
  } = {},
) {
  const controller = new AbortController()
  const calls: { slot: string; id: string; input: JsonValue }[] = []
  let agents = 0
  const result = await repair({
    input: input as unknown as JsonValue,
    settings: { restoreCorrections: options.enabled !== false },
    signal: controller.signal,
    channels: {},
    call: async (request) => {
      calls.push({ slot: request.slot, id: request.operationId, input: request.input })
      if (request.slot === 'agent') {
        agents++
        if (agents === 2 && options.failRestore)
          throw new OperationError('UNAVAILABLE', 'Restoration refused.')
        return {
          outcome: 'done',
          output: {
            text: 'Recorded proposal, not model evidence.',
            structured: options.invalidFirst && agents === 1 ? { invalid: true } : proposal,
            ...(options.omitReceipt ? {} : { session: options.receipt ?? retained }),
          },
        }
      }
      if (agents && options.failCommand) throw new OperationError('UNCERTAIN', 'Uncertain command.')
      const command = request.input as {
        files: Record<string, string>
        args: string[]
        stdin: string
      }
      const result = recorded(
        request.slot,
        command.files,
        command.args,
        command.stdin,
        (agents > 1 && options.secondPass !== false) ||
          (agents === 1 && options.firstPass === true),
      )
      if (options.cancelAfterCheck && request.operationId === `attempt-1-${input.cases.length}`)
        controller.abort(new Error('operator stopped'))
      return { outcome: 'done', output: result }
    },
  })
  return { result, calls, agents }
}

test('restored correction follows settled proposal and executed checks without resending source or receipts', async () => {
  const { result, calls, agents } = await exercise()
  expect(result.outcome).toBe('done')
  expect(agents).toBe(2)
  const requests = calls.filter((c) => c.slot === 'agent')
  expect(requests.map((c) => (c.input as Record<string, JsonValue>).session)).toEqual([
    { retain: true },
    { restore: reference },
  ])
  const correction = (requests[1]!.input as Record<string, JsonValue>).instructions as string
  expect(correction).toContain('recorded feedback')
  expect(correction).toContain('wrong\\n')
  expect(correction).not.toContain(reference)
  expect(correction).not.toContain(JSON.stringify(input.files))
  expect(calls.findIndex((c) => c.id === 'patch-2')).toBeGreaterThan(
    calls.findIndex((c) => c.id === `attempt-1-${input.cases.length}`),
  )
  const output = result.output as { attempts: { session: unknown }[] }
  expect(output.attempts).toHaveLength(2)
  expect(output.attempts[0]!.session).toEqual(retained)
})

test('an invalid proposal earns one restored correction without executing it', async () => {
  const { result, calls } = await exercise({ invalidFirst: true })
  expect(result.outcome).toBe('done')
  expect(calls.some((c) => c.id.startsWith('attempt-1'))).toBe(false)
  expect(calls.filter((c) => c.slot === 'agent')).toHaveLength(2)
})

test('unavailable retention preserves a passing first patch but cannot fabricate a fresh correction', async () => {
  const receipt = { status: 'unavailable', reason: 'capacity' }
  expect((await exercise({ receipt, firstPass: true })).result.outcome).toBe('done')
  const { result, agents } = await exercise({ receipt })
  expect(agents).toBe(1)
  expect(result.outcome).toBe('blocked')
  expect((result.output as Record<string, JsonValue>).reason).toContain('capacity')
  expect((result.output as Record<string, JsonValue>).attempts).toHaveLength(1)
})

test('restoration failure and command uncertainty retain evidence without retry', async () => {
  for (const options of [{ failRestore: true }, { failCommand: true }]) {
    try {
      await exercise(options)
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(OperationError)
      expect((error as OperationError).code).toBe(options.failRestore ? 'UNAVAILABLE' : 'UNCERTAIN')
      expect(
        ((error as OperationError).details as Record<string, JsonValue>).attempts,
      ).toHaveLength(1)
    }
  }
})

test('cancellation after candidate checks prevents restoring a successor', async () => {
  await expect(exercise({ cancelAfterCheck: true })).rejects.toThrow('operator stopped')
})

test('a failed restored proposal cannot earn a third call or reset the acceptance policy', async () => {
  const { result, calls, agents } = await exercise({ secondPass: false })
  expect(result.outcome).toBe('blocked')
  expect(agents).toBe(2)
  expect(calls.filter((c) => c.slot === 'agent').map((c) => c.id)).toEqual(['patch-1', 'patch-2'])
  expect((result.output as Record<string, JsonValue>).attempts).toHaveLength(2)
})

test('ordinary repair sends no session request; malformed receipts are never used', async () => {
  const ordinary = await exercise({ enabled: false })
  expect(ordinary.result.outcome).toBe('done')
  for (const call of ordinary.calls.filter((c) => c.slot === 'agent'))
    expect(Object.hasOwn(call.input as object, 'session')).toBe(false)
  await expect(
    exercise({ receipt: { status: 'retained', reference: '../wrong' } }),
  ).rejects.toMatchObject({ code: 'INVALID_RESULT' })
  await expect(exercise({ omitReceipt: true })).rejects.toMatchObject({ code: 'INVALID_RESULT' })
})
