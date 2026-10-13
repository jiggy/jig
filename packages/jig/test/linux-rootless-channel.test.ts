import { expect, test } from 'bun:test'
import { PrivateFileImportUnconfirmedError } from '../src/internal/execution-file-import.js'
import {
  createPrivateLinuxImportReplies,
  readPrivateSupervisorMessage,
} from '../src/internal/linux-rootless-backend.js'

function replies(writeFailure = false) {
  const sent: { id: string }[] = []
  let retirements = 0
  const control = createPrivateLinuxImportReplies({
    running: () => true,
    timeoutMs: 1,
    write(value) {
      sent.push(value as { id: string })
      if (writeFailure) throw new Error('queued write reported backpressure')
    },
    retire() {
      retirements++
    },
  })
  return { control, sent, retirements: () => retirements }
}

test('late acknowledgement drains after timeout without reviving the failed import', async () => {
  const { control, sent } = replies()
  const operation = control.request('import-commit', { name: 'stage' })
  await expect(operation).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
  const reply = { type: 'import-reply', id: sent[0]!.id, outcome: 'committed' }
  expect(() => control.receive(reply)).not.toThrow()
  await expect(operation).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
  expect(() => control.receive(reply)).toThrow(PrivateFileImportUnconfirmedError)
  // The unrelated original native final remains readable after the late ACK.
  const terminal = { type: 'terminal', fenced: true }
  expect(
    await readPrivateSupervisorMessage(
      { next: async () => ({ done: false as const, value: terminal }) },
      Promise.resolve({ code: 0, signal: null }),
    ),
  ).toEqual(terminal)
})

test('a queued write failure observes its waiter and drains only its known late reply', async () => {
  const { control, sent } = replies(true)
  const operation = control.request('import-end', { name: 'stage' })
  await expect(operation).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
  expect(() =>
    control.receive({ type: 'import-reply', id: sent[0]!.id, outcome: 'closed' }),
  ).not.toThrow()
  control.reject('native final')
  await Bun.sleep(0)
  await expect(operation).rejects.toBeInstanceOf(PrivateFileImportUnconfirmedError)
})

test('an unwaited queued write failure cannot leave an unhandled rejected waiter', async () => {
  let control: ReturnType<typeof createPrivateLinuxImportReplies>
  control = createPrivateLinuxImportReplies({
    running: () => true,
    timeoutMs: 1,
    write(value) {
      control.receive({
        type: 'import-reply',
        id: (value as { id: string }).id,
        outcome: 'error',
        error: 'native reply rejected the queued request',
      })
      throw new Error('queued write reported backpressure')
    },
    retire() {},
  })
  await expect(control.request('import-begin', {})).rejects.toBeInstanceOf(
    PrivateFileImportUnconfirmedError,
  )
  // The native reply rejected before the write threw, so request never awaited
  // its original reply promise. It still needs an immediate rejection observer.
  control.reject('native final')
  await Bun.sleep(0)
})

test('unknown and duplicate successful import replies remain fatal', async () => {
  const { control, sent } = replies()
  const operation = control.request('import-begin', {})
  const reply = { type: 'import-reply', id: sent[0]!.id, outcome: 'staged' }
  control.receive(reply)
  expect(await operation).toBe('staged')
  expect(() => control.receive(reply)).toThrow(PrivateFileImportUnconfirmedError)
  expect(() =>
    control.receive({ type: 'import-reply', id: 'f'.repeat(24), outcome: 'closed' }),
  ).toThrow(PrivateFileImportUnconfirmedError)
})

test('malformed or wrong-outcome late replies do not consume an abandoned ID', async () => {
  const { control, sent } = replies(true)
  await expect(control.request('import-commit', {})).rejects.toBeInstanceOf(
    PrivateFileImportUnconfirmedError,
  )
  const id = sent[0]!.id
  for (const reply of [
    { type: 'import-reply', id, outcome: 'committed', extra: true },
    { type: 'import-reply', id, outcome: 'closed' },
    { type: 'import-reply', id, outcome: 'error' },
    { type: 'import-reply', id, outcome: 'error', error: {} },
  ])
    expect(() => control.receive(reply)).toThrow(PrivateFileImportUnconfirmedError)
  expect(() => control.receive({ type: 'import-reply', id, outcome: 'absent' })).not.toThrow()
})

test('two pending siblings refuse a third request without retiring normal native control', async () => {
  const { control, sent, retirements } = replies()
  const first = control.request('import-begin', {})
  const second = control.request('import-begin', {})
  await expect(control.request('import-begin', {})).rejects.toBeInstanceOf(
    PrivateFileImportUnconfirmedError,
  )
  expect(sent).toHaveLength(2)
  expect(retirements()).toBe(0)
  for (const { id } of sent) control.receive({ type: 'import-reply', id, outcome: 'staged' })
  expect(await Promise.all([first, second])).toEqual(['staged', 'staged'])
})

test('six abandoned IDs retire admission before another send without fabricating a native fence', async () => {
  const { control, sent, retirements } = replies(true)
  for (let index = 0; index < 6; index++)
    await expect(control.request('import-begin', {})).rejects.toBeInstanceOf(
      PrivateFileImportUnconfirmedError,
    )
  await expect(control.request('import-end', {})).rejects.toBeInstanceOf(
    PrivateFileImportUnconfirmedError,
  )
  expect(sent).toHaveLength(6)
  expect(retirements()).toBe(1)
  expect(control.retired).toBe(true)
  for (const { id } of sent) control.receive({ type: 'import-reply', id, outcome: 'staged' })
  await expect(control.request('import-end', {})).rejects.toBeInstanceOf(
    PrivateFileImportUnconfirmedError,
  )
  expect(sent).toHaveLength(6)
  expect(retirements()).toBe(1)
})

test('supervisor exit does not discard a terminal already buffered on its control channel', async () => {
  const message = { type: 'terminal', fenced: true }
  const iterator = {
    async next() {
      await Bun.sleep(1)
      return { done: false as const, value: message }
    },
  }
  expect(
    await readPrivateSupervisorMessage(iterator, Promise.resolve({ code: 0, signal: null })),
  ).toEqual(message)
})

test('an exhausted control channel never fabricates a supervisor terminal', async () => {
  const iterator = {
    async next() {
      return { done: true as const, value: undefined }
    },
  }
  await expect(
    readPrivateSupervisorMessage(iterator, Promise.resolve({ code: 0, signal: null })),
  ).rejects.toThrow()
})

test('an exited supervisor with a stuck channel has bounded uncertainty', async () => {
  const iterator = { next: () => new Promise<IteratorResult<unknown>>(() => {}) }
  await expect(
    readPrivateSupervisorMessage(iterator, Promise.resolve({ code: 0, signal: null })),
  ).rejects.toThrow('final channel drain timed out')
})
