import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type ChannelSender, type JsonValue, OperationError } from '@jigging/flow'
import {
  USER_UPDATES_CONTRACT,
  type UserUpdates,
  validateUserUpdate,
  withUserUpdates,
} from '../src/index.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
function mock(send?: ChannelSender['send'], close?: ChannelSender['close']) {
  const values: JsonValue[] = []
  const closes: unknown[] = []
  const sender: ChannelSender = {
    direction: 'send',
    delivery: 'direct',
    contract: USER_UPDATES_CONTRACT,
    send:
      send ??
      (async (value) => {
        values.push(value)
      }),
    close: async (options) => {
      closes.push(options)
      await close?.(options)
    },
  }
  return {
    sender,
    values,
    closes,
    run: { signal: new AbortController().signal, channels: { updates: sender } },
  }
}

test('descriptor is self-contained and Python copy preserves exact bytes', () => {
  const ts = readFileSync(new URL('../src/user-updates.json', import.meta.url))
  expect(
    ts.equals(
      readFileSync(
        new URL(
          '../../jiggy-user-updates/src/jiggy/user_updates/user-updates.json',
          import.meta.url,
        ),
      ),
    ),
  ).toBe(true)
  expect(USER_UPDATES_CONTRACT.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
})

test('closed semantic validation, scalar limits, numeric resets and unsafe getters', () => {
  const invalid = [
    { kind: 'notice', text: '' },
    { kind: 'notice', text: '\ud800' },
    { kind: 'notice', text: 'a', extra: true },
    { kind: 'activity', id: '__proto__', label: 'a\nb' },
    { kind: 'activity', id: 'a', label: 'x', progress: { completed: 1, total: 0 } },
    { kind: 'activity', id: 'a', label: 'x', progress: { completed: Number.MAX_SAFE_INTEGER + 1 } },
    { kind: 'clear', id: 'x'.repeat(65) },
    {
      kind: 'notice',
      get text() {
        throw new Error('must not execute')
      },
    },
  ]
  for (const value of invalid) expect(() => validateUserUpdate(value)).toThrow(TypeError)
  expect(
    validateUserUpdate({
      kind: 'activity',
      id: '__proto__',
      label: '🧪'.repeat(256),
      progress: { completed: 0, total: 0, unit: 'files' },
    }),
  ).toEqual({
    kind: 'activity',
    id: '__proto__',
    label: '🧪'.repeat(256),
    progress: { completed: 0, total: 0, unit: 'files' },
  })
})

test('unwired and stopped offers still validate; finished offers reject', async () => {
  let retained!: UserUpdates
  const value = await withUserUpdates(
    { channels: {}, signal: new AbortController().signal },
    'updates',
    (updates) => {
      retained = updates
      expect(() => updates.notice('')).toThrow(TypeError)
      updates.notice('valid')
      return 42
    },
  )
  expect(value).toBe(42)
  expect(() => retained.clear('a')).toThrow('no longer accepting')
})

test('immutable snapshots, adjacent coalescing and notice/clear barriers', async () => {
  const m = mock()
  const progress = { completed: 0, total: 3, unit: 'files' }
  await withUserUpdates(m.run, 'updates', async (updates) => {
    updates.activity('a', 'old')
    updates.activity('a', 'current', progress)
    progress.completed = 3
    updates.notice('boundary')
    // Wait for the first pair to drain before offering another pair.
    await new Promise((resolve) => setTimeout(resolve, 230))
    updates.clear('a')
    updates.activity('a', 'new appearance')
    await new Promise((resolve) => setTimeout(resolve, 410))
  })
  expect(m.values).toEqual([
    {
      kind: 'activity',
      id: 'a',
      label: 'current',
      progress: { completed: 0, total: 3, unit: 'files' },
    },
    { kind: 'notice', text: 'boundary' },
    { kind: 'clear', id: 'a' },
    { kind: 'activity', id: 'a', label: 'new appearance' },
  ])
  expect(m.closes).toEqual([undefined])
})

test('close acknowledgement does not swallow a delayed unexpected send rejection', async () => {
  const send = deferred<void>()
  const closed = deferred<void>()
  const m = mock(
    () => send.promise,
    async (options) => {
      expect(options?.error).toBe('LAGGED')
      closed.resolve()
    },
  )
  const failure = new OperationError('RESOURCE_EXHAUSTED')
  let finished = false
  const scope = withUserUpdates(m.run, 'updates', (updates) => updates.notice('one')).finally(
    () => {
      finished = true
    },
  )
  const observed = scope.catch((error) => error)
  await closed.promise
  expect(finished).toBe(false)
  send.reject(failure)
  expect(await observed).toBe(failure)
  expect(m.closes).toHaveLength(1)
})

test('local capacity stops observation and joins the original send once', async () => {
  const original = deferred<void>()
  const began = deferred<void>()
  const m = mock(
    async () => {
      began.resolve()
      return original.promise
    },
    async () => {
      original.reject(new OperationError('LAGGED'))
    },
  )
  const value = await withUserUpdates(m.run, 'updates', async (updates) => {
    updates.notice('in-flight')
    await began.promise
    for (let n = 0; n < 17; n++) updates.notice(`burst ${n}`)
    expect(() => updates.activity('a', 'invalid\nlabel')).toThrow(TypeError)
    return 'domain result'
  })
  expect(value).toBe('domain result')
  expect(m.closes).toEqual([{ error: 'LAGGED' }])
})

test('known observer loss degrades, unexpected codes fail and body error stays primary', async () => {
  for (const code of ['LAGGED', 'DISCONNECTED'] as const) {
    const m = mock(async () => {
      throw new OperationError(code)
    })
    expect(
      await withUserUpdates(m.run, 'updates', (updates) => {
        updates.notice('one')
        return 7
      }),
    ).toBe(7)
  }
  for (const code of [
    'RESOURCE_EXHAUSTED',
    'OWNER_CLOSED',
    'PROTOCOL_ERROR',
    'PERMISSION_DENIED',
    'INVALID_INPUT',
  ] as const) {
    const failure = new OperationError(code)
    const m = mock(async () => {
      throw failure
    })
    expect(
      await withUserUpdates(m.run, 'updates', (updates) => updates.notice('one')).catch(
        (error) => error,
      ),
    ).toBe(failure)
  }
  const primary = new Error('domain failed')
  const m = mock(async () => {
    throw new OperationError('RESOURCE_EXHAUSTED')
  })
  expect(
    await withUserUpdates(m.run, 'updates', (updates) => {
      updates.notice('one')
      throw primary
    }).catch((error) => error),
  ).toBe(primary)
})

test('root abort remains authoritative and reused writer cannot be wrapped', async () => {
  const root = new AbortController()
  const m = mock()
  const reason = new Error('cancelled root')
  expect(
    await withUserUpdates({ ...m.run, signal: root.signal }, 'updates', (updates) => {
      updates.notice('one')
      root.abort(reason)
      return 7
    }).catch((error) => error),
  ).toBe(reason)
  expect(m.closes).toEqual([{ error: 'LAGGED' }])
  expect(await withUserUpdates(m.run, 'updates', () => 1).catch((error) => error)).toBeInstanceOf(
    Error,
  )
  const wrong = { ...m.sender, contract: { ...USER_UPDATES_CONTRACT, digest: 'sha256:other' } }
  expect(
    await withUserUpdates({ ...m.run, channels: { updates: wrong } }, 'updates', () => 1).catch(
      (error) => error,
    ),
  ).toBeInstanceOf(TypeError)
})

test('severity is a closed optional snapshot, including unwired validation', async () => {
  for (const severity of [null, undefined, 'fatal', 1, { toString: () => 'error' }])
    expect(() => validateUserUpdate({ kind: 'notice', text: 'problem', severity })).toThrow(
      TypeError,
    )
  for (const severity of ['info', 'warning', 'error'])
    expect(validateUserUpdate({ kind: 'notice', text: 'problem', severity })).toEqual({
      kind: 'notice',
      text: 'problem',
      severity,
    })
  await withUserUpdates(
    { channels: {}, signal: new AbortController().signal },
    'updates',
    (updates) => {
      expect(() => updates.notice('problem', 'fatal' as any)).toThrow(TypeError)
    },
  )
  const m = mock()
  await withUserUpdates(m.run, 'updates', (updates) => updates.notice('problem', 'error'))
  expect(m.values).toEqual([{ kind: 'notice', text: 'problem', severity: 'error' }])
})

test('a full prompt backlog drains final distinct views without bypassing notice barriers', async () => {
  const m = mock()
  const result = await withUserUpdates(m.run, 'updates', (updates) => {
    for (let n = 0; n < 12; n++) updates.notice(`Earlier ${n}`)
    updates.notice('Blocking failure retained in result', 'error')
    for (const id of ['jobs', 'checks', 'patches'])
      updates.view(id, { title: id }).update({ summary: `${id} final evidence`, sections: [] })
    return { outcome: 'blocked', output: { reason: 'Blocking failure retained in result' } }
  })
  expect(result.output.reason).toBe('Blocking failure retained in result')
  expect(m.values).toHaveLength(16)
  expect(m.values.slice(0, 12)).toEqual(
    Array.from({ length: 12 }, (_, n) => ({ kind: 'notice', text: `Earlier ${n}` })),
  )
  expect(m.values[12]).toEqual({
    kind: 'notice',
    text: 'Blocking failure retained in result',
    severity: 'error',
  })
  expect(m.values.slice(13).map((value: any) => value.id)).toEqual(['jobs', 'checks', 'patches'])
  expect(m.closes).toEqual([undefined])
})

test('aggregate drain expiry still joins a later unexpected original send error', async () => {
  let sends = 0
  const original = deferred<void>(),
    closed = deferred<void>()
  const m = mock(
    async () => {
      if (++sends === 9) return original.promise
      await new Promise((resolve) => setTimeout(resolve, 450))
    },
    async () => {
      closed.resolve()
    },
  )
  let finished = false
  const scope = withUserUpdates(m.run, 'updates', (updates) => {
    for (let n = 0; n < 16; n++) updates.notice(`Queued ${n}`)
  })
    .finally(() => {
      finished = true
    })
    .catch((error) => error)
  await closed.promise
  expect(sends).toBe(9)
  expect(finished).toBe(false)
  const failure = new OperationError('RESOURCE_EXHAUSTED')
  original.reject(failure)
  expect(await scope).toBe(failure)
  expect(m.closes).toEqual([{ error: 'LAGGED' }])
}, 10000)

test('root deadline during drain stops publication and preserves owned settlement', async () => {
  const root = new AbortController(),
    began = deferred<void>(),
    original = deferred<void>()
  const m = mock(
    async () => {
      began.resolve()
      await original.promise
    },
    async () => {
      original.reject(new OperationError('LAGGED'))
    },
  )
  const reason = new Error('Run deadline expired')
  const scope = withUserUpdates({ ...m.run, signal: root.signal }, 'updates', (updates) => {
    updates.notice('Final evidence')
    return 7
  }).catch((error) => error)
  await began.promise
  root.abort(reason)
  expect(await scope).toBe(reason)
  expect(m.closes).toEqual([{ error: 'LAGGED' }])
})
