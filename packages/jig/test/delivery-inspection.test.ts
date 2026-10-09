import { expect, spyOn, test } from 'bun:test'
import type { Socket } from 'node:net'
import { Duplex } from 'node:stream'
import {
  PrivateDeliveryAuthorityRetirement,
  PrivateDeliveryCompletion,
  PrivateDeliveryInspectionError,
  privateCaptureDeliveryInspection,
} from '../src/internal/delivery-inspection.js'
import {
  privateFileCompletionAllowance,
  privateFileCompletionBudget,
  privateFileDeliveryConnection,
} from '../src/internal/file-command.js'
import type {
  PrivateDeliveryConnection,
  PrivateDeliveryReceipt,
} from '../src/internal/file-delivery.js'
import { PrivateRootRunFiles } from '../src/internal/root-run-files.js'
import {
  PRIVATE_PRESENTATION_DEADLINE_ENV,
  privateConstrainPresentationDeadline,
  privatePresentationNow,
} from '../src/internal/root-run-timeout-policy.js'
import { canonicalJson, type JsonValue } from '../src/json.js'

const bound = (ms = 1000) => ({ deadline: privatePresentationNow() + ms })
const receipt = (files: readonly { path: string; bytes: number }[]): PrivateDeliveryReceipt => ({
  status: 'written',
  destination: '/operator/packet',
  files: files.map((file) => ({ ...file, digest: `sha256:${'1'.repeat(64)}` })),
})
function connection(operations: Partial<PrivateDeliveryConnection>): PrivateDeliveryConnection {
  return {
    async prepare() {},
    async publish() {
      throw new Error('must not publish during inspection')
    },
    ...operations,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

test('inspection captures serial verified excerpts and exposes only pure state after ACK', async () => {
  const steps: string[] = []
  let active = 0,
    maximum = 0,
    retired = false
  const source = new Map([
    ['patch', { state: 'text' as const, text: '+ checked\n', bytes: 10, clipped: false }],
    ['empty', { state: 'empty' as const, text: '', bytes: 0, clipped: false }],
    ['binary', { state: 'non-text' as const, bytes: 2, clipped: false }],
    ['missing', { state: 'unavailable' as const, bytes: 0, clipped: false }],
  ])
  const capture = await privateCaptureDeliveryInspection(
    connection({
      async inspectionPreview(path) {
        expect(retired).toBe(false)
        steps.push(path)
        maximum = Math.max(maximum, ++active)
        await Promise.resolve()
        active--
        return source.get(path)!
      },
      async retire() {
        retired = true
        source.clear()
        steps.push('ACK')
      },
    }),
    receipt([
      { path: 'patch', bytes: 10 },
      { path: 'empty', bytes: 0 },
      { path: 'binary', bytes: 2 },
      { path: 'missing', bytes: 42 },
    ]),
  )
  expect(maximum).toBe(1)
  expect(steps).toEqual(['patch', 'empty', 'binary', 'missing', 'ACK'])
  expect(capture.files.map((file) => file.state)).toEqual([
    'text',
    'empty',
    'non-text',
    'unavailable',
  ])
  expect(capture.preview('patch')?.text).toBe('+ checked\n')
  expect(capture.preview('../operator-file')).toBeUndefined()
  expect(capture.preview('missing')?.bytes).toBe(42)
  capture.close()
  capture.close()
  expect(capture.preview('patch')).toBeUndefined()
})

test('maximum legal serial capture retains 64 excerpts at the 4 MiB text ceiling', async () => {
  const text = 'x'.repeat(65536)
  const files = Array.from({ length: 64 }, (_, index) => ({ path: `file-${index}`, bytes: 65537 }))
  let reads = 0
  const capture = await privateCaptureDeliveryInspection(
    connection({
      async inspectionPreview() {
        reads++
        return { state: 'text', text, bytes: 65537, clipped: true }
      },
      async retire() {},
    }),
    receipt(files),
  )
  expect(reads).toBe(64)
  expect(capture.files.every((file) => file.clipped)).toBe(true)
  expect(
    files.reduce((sum, file) => sum + Buffer.byteLength(capture.preview(file.path)!.text!), 0),
  ).toBe(4 * 1024 * 1024)
  capture.close()
})

test('preview extraction stops at ten seconds and cannot refresh the total retirement deadline', async () => {
  const clock = spyOn(performance, 'now').mockReturnValue(1000)
  let reads = 0,
    retiredDeadline = 0
  const start = privatePresentationNow()
  try {
    const capture = await privateCaptureDeliveryInspection(
      connection({
        async inspectionPreview() {
          reads++
          clock.mockReturnValue(11_001)
          return { state: 'text', text: 'late', bytes: 4, clipped: false }
        },
        async retire(options) {
          retiredDeadline = options.deadline
        },
      }),
      receipt([
        { path: 'first', bytes: 4 },
        { path: 'later', bytes: 4 },
      ]),
    )
    expect(reads).toBe(1)
    expect(retiredDeadline).toBe(start + 20_000)
    expect(capture.files.every((file) => file.state === 'unavailable')).toBe(true)
    capture.close()
  } finally {
    clock.mockRestore()
  }
})

test('a tighter inherited bound shortens previews while preserving retirement time', async () => {
  const clock = spyOn(performance, 'now').mockReturnValue(1000)
  let reads = 0,
    retiredDeadline = 0
  const start = privatePresentationNow()
  try {
    const capture = await privateCaptureDeliveryInspection(
      connection({
        async inspectionPreview() {
          reads++
          clock.mockReturnValue(1501)
          return { state: 'text', text: 'late', bytes: 4, clipped: false }
        },
        async retire(options) {
          retiredDeadline = options.deadline
        },
      }),
      receipt([
        { path: 'first', bytes: 4 },
        { path: 'later', bytes: 4 },
      ]),
      { presentationDeadline: start + 1000 },
    )
    expect(reads).toBe(1)
    expect(retiredDeadline).toBe(start + 1000)
    expect(capture.files.every((file) => file.state === 'unavailable')).toBe(true)
    capture.close()
  } finally {
    clock.mockRestore()
  }
})

test('cleanup rejection preserves a confirmed receipt and returns no inspection owner', async () => {
  const published = receipt([{ path: 'evidence', bytes: 3 }])
  await expect(
    privateCaptureDeliveryInspection(
      connection({
        async inspectionPreview() {
          return { state: 'text', text: 'yes', bytes: 3, clipped: false }
        },
        async retire() {
          throw new Error('endpoint cleanup failed')
        },
      }),
      published,
    ),
  ).rejects.toMatchObject({ code: 'RETIREMENT_FAILED' })
  expect(published.status).toBe('written')
  expect(published.files![0]!.path).toBe('evidence')
})

test('capture refusal still retires and cannot add arbitrary receipt paths or bytes', async () => {
  let retires = 0
  const delivery = connection({
    async retire() {
      retires++
    },
  })
  for (const files of [
    Array.from({ length: 65 }, (_, index) => ({ path: `file-${index}`, bytes: 0 })),
    [{ path: '../escape', bytes: 0 }],
    [
      { path: 'same', bytes: 0 },
      { path: 'same', bytes: 1 },
    ],
  ]) {
    await expect(privateCaptureDeliveryInspection(delivery, receipt(files))).rejects.toBeInstanceOf(
      PrivateDeliveryInspectionError,
    )
  }
  expect(retires).toBe(3)
})

test('failed excerpt stays unavailable while retirement and known receipt remain independent', async () => {
  const published = receipt([{ path: 'evidence', bytes: 7 }])
  const capture = await privateCaptureDeliveryInspection(
    connection({
      async inspectionPreview() {
        throw new Error('lost preview')
      },
      async retire() {},
    }),
    published,
  )
  expect(capture.preview('evidence')).toEqual({ state: 'unavailable', bytes: 7, clipped: false })
  expect(published.status).toBe('written')
  capture.close()
})

test('empty and no-publication captures still require finite observed retirement', async () => {
  for (const published of [undefined, receipt([])]) {
    const start = privatePresentationNow()
    let receivedDeadline = Infinity
    await expect(
      privateCaptureDeliveryInspection(
        connection({
          async retire(options) {
            receivedDeadline = options.deadline
            return new Promise(() => {})
          },
        }),
        published,
        { presentationDeadline: start + 20 },
      ),
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    expect(receivedDeadline).toBe(start + 20)
    expect(privatePresentationNow() - start).toBeLessThan(500)
  }
  const capture = await privateCaptureDeliveryInspection(undefined, undefined)
  expect(capture.files).toEqual([])
  capture.close()
  await expect(privateCaptureDeliveryInspection(connection({}), undefined)).rejects.toMatchObject({
    code: 'RETIREMENT_FAILED',
  })
})

test('retirement fences immediately, joins pending work, and memoizes failed cleanup', async () => {
  const pending = deferred<void>()
  let closes = 0
  const retirement = new PrivateDeliveryAuthorityRetirement(async () => {
    await pending.promise
    closes++
    throw new Error('close failed')
  })
  const first = retirement.retire(bound())
  const rejection = first.catch((error: unknown) => error)
  expect(retirement.retiring).toBe(true)
  expect(retirement.retire(bound())).toBe(first)
  expect(closes).toBe(0)
  pending.resolve()
  expect(await rejection).toMatchObject({ message: 'close failed' })
  await expect(retirement.close()).rejects.toThrow('close failed')
  expect(closes).toBe(1)
})

test('late resource completion cannot reverse expired retirement', async () => {
  const release = deferred<void>()
  const retirement = new PrivateDeliveryAuthorityRetirement(() => release.promise)
  const pending = retirement.retire(bound(15))
  await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  release.resolve()
  await retirement.close()
  expect(retirement.retiring).toBe(true)
  expect(retirement.retire(bound())).toBe(pending)
  await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
})

test('successful bounded retirement stays complete after an arbitrarily long inspection', async () => {
  const clock = spyOn(performance, 'now').mockReturnValue(1000)
  let closes = 0
  const retirement = new PrivateDeliveryAuthorityRetirement(async () => {
    closes++
  })
  try {
    const options = bound(20_000)
    const completed = retirement.retire(options)
    await completed
    clock.mockReturnValue(3_601_000)
    expect(retirement.retire(options)).toBe(completed)
    await retirement.retire(options)
    await retirement.close()
    expect(closes).toBe(1)
  } finally {
    clock.mockRestore()
  }
})

test('command completion selects twenty seconds for uncapped exit and preserves legacy recovery allowance', () => {
  const clock = spyOn(performance, 'now').mockReturnValue(1000)
  try {
    const now = privatePresentationNow()
    const interactive = new PrivateDeliveryCompletion(
      undefined,
      privateFileCompletionAllowance(null),
    )
    const legacy = new PrivateDeliveryCompletion(undefined, privateFileCompletionAllowance(300_000))
    expect(interactive.start()).toBe(now + 20_000)
    expect(legacy.start()).toBe(now + 60_000)
    const constrained = new PrivateDeliveryCompletion(
      now + 3500,
      privateFileCompletionAllowance(null),
    )
    expect(constrained.start()).toBe(now + 3500)
    clock.mockReturnValue(2000)
    expect(interactive.start()).toBe(now + 20_000)
    expect(legacy.start(privatePresentationNow() + 20_000)).toBe(now + 21_000)
    clock.mockReturnValue(3000)
    expect(legacy.start(privatePresentationNow() + 20_000)).toBe(now + 21_000)
  } finally {
    clock.mockRestore()
  }
})

test('command completion bounds stalled prepare and publication joins before repeated exit cleanup', async () => {
  const prepare = deferred<void>(),
    publication = deferred<void>()
  const completion = new PrivateDeliveryCompletion(privatePresentationNow() + 20)
  const started = completion.start()
  const prepareJoin = completion.join(prepare.promise)
  const publicationJoin = completion.join(publication.promise)
  const failed = await Promise.allSettled([prepareJoin, publicationJoin])
  expect(failed.every((result) => result.status === 'rejected')).toBe(true)
  expect(completion.start()).toBe(started)
  expect(completion.join(prepare.promise)).toBe(prepareJoin)
  expect(completion.join(publication.promise)).toBe(publicationJoin)
  prepare.resolve()
  publication.resolve()
  await expect(completion.join(prepare.promise)).rejects.toMatchObject({
    code: 'DEADLINE_EXCEEDED',
  })
  await expect(completion.join(publication.promise)).rejects.toMatchObject({
    code: 'DEADLINE_EXCEEDED',
  })
})

test('command completion preserves closing time after a short local presentation cap but honors inherited constraints', () => {
  const now = privatePresentationNow()
  expect(privateConstrainPresentationDeadline({}, 700, now)).toBe(now - 44_300)
  const completion = privateFileCompletionBudget({}, 700)
  expect(completion.start()).toBeGreaterThanOrEqual(now + 60_000)
  expect(completion.start()).toBeLessThan(now + 60_500)
  const inherited = privateFileCompletionBudget(
    { [PRIVATE_PRESENTATION_DEADLINE_ENV]: String(now - 1) },
    700,
  )
  expect(inherited.start()).toBe(now - 1)
})

test('command completion tightens an already pending legacy join without retaining its old timer', async () => {
  const pending = deferred<void>()
  const completion = new PrivateDeliveryCompletion(
    undefined,
    privateFileCompletionAllowance(300_000),
  )
  const started = privatePresentationNow()
  const joined = completion.join(pending.promise)
  completion.start(started + 15)
  await expect(joined).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  expect(privatePresentationNow() - started).toBeLessThan(500)
  pending.resolve()
  expect(completion.join(pending.promise)).toBe(joined)
  await expect(joined).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
})

test('command completion repeatedly tightens warm pending joins while preserving completed work', async () => {
  for (let index = 0; index < 64; index++) {
    const pending = deferred<void>()
    const completion = privateFileCompletionBudget({}, 300_000)
    const completed = Promise.resolve()
    await completion.join(completed)
    const started = privatePresentationNow()
    const joined = completion.join(pending.promise)
    completion.start(started + 2)
    try {
      await expect(joined).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(privatePresentationNow() - started).toBeLessThan(500)
      await completion.join(completed)
    } finally {
      pending.resolve()
    }
  }
})

test('command completion keeps retirement fenced after a stalled original publication and attempts every close', async () => {
  const original = deferred<void>(),
    stalledClose = deferred<void>()
  const completion = new PrivateDeliveryCompletion(privatePresentationNow() + 20)
  const deadline = completion.start()
  let closes = 0
  const retirement = new PrivateDeliveryAuthorityRetirement(async () => {
    const failures: unknown[] = []
    try {
      await completion.join(original.promise)
    } catch (error) {
      failures.push(error)
    }
    const close = () => {
      closes++
      return closes === 1 ? stalledClose.promise : Promise.resolve()
    }
    const closed = await Promise.allSettled([completion.join(close()), completion.join(close())])
    failures.push(
      ...closed.filter((result) => result.status === 'rejected').map((result) => result.reason),
    )
    if (failures.length) throw new AggregateError(failures, 'unconfirmed authority release')
  })
  const retired = retirement.retire({ deadline })
  await expect(retired).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  await expect(retirement.close()).rejects.toBeInstanceOf(AggregateError)
  expect(closes).toBe(2)
  expect(retirement.retiring).toBe(true)
  original.resolve()
  stalledClose.resolve()
  expect(retirement.retire(bound())).toBe(retired)
  await expect(retired).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  expect(completion.start()).toBe(deadline)
})

test('command completion reuses timely task success after indefinite inspection', async () => {
  const clock = spyOn(performance, 'now').mockReturnValue(1000)
  try {
    const completion = new PrivateDeliveryCompletion()
    const task = Promise.resolve()
    const joined = completion.join(task)
    await joined
    clock.mockReturnValue(3_601_000)
    expect(completion.join(task)).toBe(joined)
    await completion.join(task)
  } finally {
    clock.mockRestore()
  }
})

test('RootRunFiles concurrent and repeated closes consume one descriptor and preserve failure', async () => {
  const result = deferred<void>()
  let closes = 0
  const files = new PrivateRootRunFiles([], null)
  files.retainOutput({
    kind: 'linux-directory',
    directory: {
      close() {
        closes++
        return result.promise
      },
    } as never,
  })
  const first = files.close()
  const rejection = first.catch((error: unknown) => error)
  expect(files.output).toBeUndefined()
  expect(files.close()).toBe(first)
  expect(() => files.retainOutput(undefined)).toThrow('unavailable')
  result.reject(new Error('descriptor close failed'))
  expect(await rejection).toMatchObject({ message: 'descriptor close failed' })
  await expect(files.close()).rejects.toThrow('descriptor close failed')
  expect(closes).toBe(1)
})

class ReplySocket extends Duplex {
  readonly requests: Record<string, JsonValue>[] = []
  constructor(
    readonly respond: (request: Record<string, JsonValue>, socket: ReplySocket) => void,
    readonly completeOnEnd = true,
  ) {
    super()
  }
  _read() {}
  _write(bytes: Buffer, _: string, done: (error?: Error | null) => void) {
    const request = JSON.parse(bytes.toString()) as Record<string, JsonValue>
    this.requests.push(request)
    queueMicrotask(() => this.respond(request, this))
    done()
  }
  _final(done: (error?: Error | null) => void) {
    if (this.completeOnEnd) this.push(null)
    done()
  }
  reply(value: JsonValue) {
    if (!this.destroyed) this.push(Buffer.concat([canonicalJson(value), Buffer.from('\n')]))
  }
}
function channel(socket: ReplySocket) {
  return privateFileDeliveryConnection(socket as unknown as Socket, {
    platform: 'linux',
    socket: 'jig-file-owner-' + '0'.repeat(32),
    token: '1'.repeat(64),
  })
}

test('client disarms loss only on ACK, completes channel and memoizes retirement', async () => {
  const socket = new ReplySocket((request, peer) => {
    expect(request.token).toBe('1'.repeat(64))
    peer.reply({ ok: true, retired: true })
  })
  const delivery = channel(socket)
  const first = delivery.retire!(bound())
  expect(delivery.retire!(bound())).toBe(first)
  await first
  expect(socket.closed).toBe(true)
  expect(delivery.signal.aborted).toBe(false)
  await expect(delivery.prepare('/new-authority', [])).rejects.toThrow('unavailable')
  delivery.close()
  expect(socket.requests.map((request) => request.type)).toEqual(['retire'])
})

test('pre-ACK loss, refusal, silence and late ACK cannot establish intentional retirement', async () => {
  for (const mode of ['loss', 'refusal', 'silent', 'late']) {
    let late: ReturnType<typeof setTimeout> | undefined
    const socket = new ReplySocket((_, peer) => {
      if (mode === 'loss') peer.destroy()
      else if (mode === 'refusal') peer.reply({ ok: true, retired: false })
      else if (mode === 'late') late = setTimeout(() => peer.reply({ ok: true, retired: true }), 50)
    })
    const delivery = channel(socket)
    await expect(delivery.retire!(bound(20))).rejects.toBeInstanceOf(Error)
    await Promise.resolve()
    expect(socket.destroyed).toBe(true)
    expect(delivery.signal.aborted).toBe(true)
    clearTimeout(late)
  }
})

test('ACK without spent-channel completion still fails within the same bound', async () => {
  const socket = new ReplySocket((_, peer) => peer.reply({ ok: true, retired: true }), false)
  const delivery = channel(socket)
  await expect(delivery.retire!(bound(20))).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  expect(socket.destroyed).toBe(true)
  // Authority was ACKed: a cleanup error remains distinct from an OS interrupt.
  expect(delivery.signal.aborted).toBe(false)
})

test('retire joins one pending preview before sending its authenticated request', async () => {
  let previewPeer: ReplySocket | undefined
  const socket = new ReplySocket((request, peer) => {
    if (request.type === 'preview') previewPeer = peer
    else peer.reply({ ok: true, retired: true })
  })
  const delivery = channel(socket)
  delivery.enableInspection!()
  const preview = delivery.inspectionPreview!('evidence', bound())
  await Promise.resolve()
  const retiring = delivery.retire!(bound())
  expect(socket.requests.map((request) => request.type)).toEqual(['preview'])
  previewPeer!.reply({ ok: true, preview: { state: 'empty', text: '', bytes: 0, clipped: false } })
  await preview
  await retiring
  expect(socket.requests.map((request) => request.type)).toEqual(['preview', 'retire'])
  expect(delivery.signal.aborted).toBe(false)
})
