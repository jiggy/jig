import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { type ViewItem, validateUserUpdate } from '@jigging/user-updates'
import { PrivateCliProgress } from '../src/cli-progress.js'
import { PrivateRunModel, privateAttentionReceipt } from '../src/cli-run-model.js'
import { parseProjectEntrypoint, resolveProjectEntrypoint } from '../src/project/entrypoint.js'
import { ChannelBroker } from '../src/run/channels.js'
import { parseRun } from '../src/run-arguments.js'

const v = (id = 'jobs', rows = ['a', 'b', 'c']): ViewItem =>
  validateUserUpdate({
    kind: 'view',
    id,
    title: 'Jobs',
    landing: true,
    summary: 'Check supplied matters',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'list',
            title: 'Matters',
            columns: [{ key: 'name', label: 'Matter', type: 'text' }],
            rows: rows.map((id, index) => ({
              id,
              cells: { name: id },
              details: index < 30 ? [{ kind: 'report', text: 'Review supplied documents' }] : [],
            })),
          },
        ],
      },
    ],
  }) as ViewItem
const event = (id: string, state: 'active' | 'returned' | 'failed' = 'active') => ({
  publisher: 'root',
  operationId: id,
  slot: 'worker',
  state,
  time: 1,
})
class Input extends EventEmitter {
  isRaw = false
  paused = true
  setRawMode(raw: boolean) {
    this.isRaw = raw
    return this
  }
  isPaused() {
    return this.paused
  }
  pause() {
    this.paused = true
    return this
  }
  resume() {
    this.paused = false
    return this
  }
}
test('atomic view acceptance, bounded lifetime claims and frozen incomplete evidence', () => {
  const model = new PrivateRunModel()
  model.acceptView('root', v())
  const original = model.views.get(JSON.stringify(['root', 'jobs']))
  expect(() => model.acceptView('root', { ...v(), operationId: 'new' })).toThrow('association')
  expect(model.views.get(JSON.stringify(['root', 'jobs']))).toBe(original)
  model.acceptView('root', { kind: 'retire-view', id: 'missing' })
  expect(() => model.acceptView('root', { ...v('missing'), landing: undefined } as any)).toThrow(
    'reused',
  )
  model.freeze('root', 'Incomplete: lost observation')
  expect(model.views.get(JSON.stringify(['root', 'jobs']))?.ended).toContain('Incomplete')
  expect(() => model.acceptView('root', v())).toThrow('ended')
  model.stop()
  model.observeCall(event('late'))
  expect(model.calls.size).toBe(0)
})

test('provenance separates identical local IDs and late dynamic references resolve without re-offer', () => {
  const model = new PrivateRunModel()
  const ref = { kind: 'call' as const, operationId: 'patch-1' }
  expect(model.resolve('root', ref).available).toBe(false)
  model.observeCall(event('patch-1'))
  model.observeCall({ ...event('patch-1'), publisher: 'child', slot: 'different' })
  expect(model.resolve('root', ref).label).toContain('worker')
  expect(model.resolve('child', ref).label).toContain('different')
  model.observeCall({ ...event('patch-1'), state: 'returned' })
  model.observeCall({ ...event('patch-1'), state: 'active' })
  expect(model.resolve('root', ref).label).toContain('returned')
  model.acceptView('root', v())
  expect(
    model.resolve('child', { kind: 'record', viewId: 'jobs', collectionId: 'list', rowId: 'a' })
      .available,
  ).toBe(false)
})

test('accepted-send participant survives backpressure and remains private sideband', async () => {
  const broker = new ChannelBroker(),
    owner = broker.participant('creator'),
    writer = broker.participant('writer')
  const pair = await owner.create()
  const grants = owner.transfer(
    writer,
    { progress: pair.send.endpoint },
    { progress: { direction: 'send' } },
  )
  for (let i = 0; i < 16; i++) await writer.send(grants.progress!.endpoint, String(i))
  const pending = writer.send(grants.progress!.endpoint, 'pending')
  for (let i = 0; i < 17; i++) {
    const response = await owner.next(pair.receive.endpoint)
    expect(broker.publisherOf(response)).toBe('writer')
    expect(Object.keys(response as object)).toEqual(['item'])
    expect(JSON.stringify(response)).not.toContain('publisher')
  }
  await pending
  broker.abort()
})

test('display is operator-only, exact JSON/receive precedence remains in the grammar', () => {
  expect(parseRun(['run', 'binding:factory', '--display', 'tui']).display).toBe('tui')
  expect(() => parseRun(['run', 'binding:factory', '--display', 'wrong'])).toThrow()
  expect(() => parseRun(['run', 'binding:factory', '--display', 'dashboard'])).toThrow()
  expect(() => parseProjectEntrypoint('binding:factory --display tui')).toThrow('entrypoint')
  expect(
    resolveProjectEntrypoint(
      'binding:factory --receive progress',
      ['--display', 'tui'],
      process.cwd(),
    ),
  ).toContain('--receive')
})

test('attention reserves host causes atomically within the aggregate byte ceiling', () => {
  const model = new PrivateRunModel()
  for (let i = 0; i < 120; i++) model.addAttention('Flow', 'x'.repeat(4096), 2)
  for (let i = 0; i < 3; i++) expect(model.addAttention('Jig', '🔥'.repeat(4096), 4)).toBe(true)
  expect(model.attention.reduce((n, a) => n + a.bytes, 0)).toBeLessThanOrEqual(524288)
  expect(model.attention.length).toBeLessThanOrEqual(128)
  expect(model.incomplete).toBeDefined()
})

test('final summaries settle all 32 retained views without overflowing an async writer', async () => {
  let output = '',
    failure = false
  const progress = new PrivateCliProgress(
    false,
    async (text) => {
      output += text
    },
    undefined,
    false,
  )
  progress.onOutputFailure(() => {
    failure = true
  })
  for (let source = 0; source < 4; source++)
    for (let id = 0; id < 8; id++)
      progress.model.acceptView(`source:${source}`, { ...v(String(id)), landing: undefined } as any)
  await progress.settleDisplay({ status: 'succeeded', outcome: 'done', output: null })
  expect(failure).toBe(false)
  expect(output.match(/observation ended/gi)).toHaveLength(32)
  progress.close()
  await progress.flush()
})

test('a plain call burst degrades observation without inventing output failure or cancelling', async () => {
  let output = '',
    failure = false
  const progress = new PrivateCliProgress(
    false,
    async (text) => {
      output += text
    },
    undefined,
    false,
  )
  progress.onOutputFailure(() => {
    failure = true
  })
  for (let i = 0; i < 32; i++) progress.observeCall(event(String(i)))
  await progress.flush()
  expect(failure).toBe(false)
  expect(output).toContain('Live call reports incomplete')
  expect(progress.model.calls.size).toBe(32)
  progress.observeCall({ ...event('late', 'failed'), cause: 'KNOWN HOST CAUSE AFTER DRAIN' })
  await progress.flush()
  expect(output).toContain('KNOWN HOST CAUSE AFTER DRAIN')
  progress.close()
  await progress.flush()
})

test('a saturated optional call transcript leaves host phase changes usable', async () => {
  let failure = false
  const progress = new PrivateCliProgress(true, async () => {}, undefined, false)
  progress.onOutputFailure(() => {
    failure = true
  })
  progress.stage('Waiting')
  for (let i = 0; i < 32; i++) progress.observeCall(event(String(i)))
  progress.stage('Stopping remaining work and cleaning up')
  await progress.flush()
  expect(failure).toBe(false)
  progress.close()
  await progress.flush()
})

test('root critical handoff drains optional reports before settled inspection', async () => {
  const originalTerm = process.env.TERM
  process.env.TERM = 'xterm-256color'
  try {
    let output = '',
      failure = false
    const progress = new PrivateCliProgress(
      true,
      async (text) => {
        output += text
      },
      undefined,
      true,
    )
    const input = new Input()
    progress.onOutputFailure(() => {
      failure = true
    })
    await progress.configureDisplay('tui', true, input as any)
    expect(input.isRaw).toBe(true)
    progress.stage('Waiting for the result')
    for (let i = 0; i < 32; i++)
      progress.observeCall({ ...event(String(i), 'failed'), cause: `Safe cause ${i}` })
    const settled = progress.settleDisplay({
      status: 'failed',
      message: 'Root failed',
      cleanup: { status: 'failed' },
      delivery: { status: 'unknown' },
    })
    await progress.flush()
    input.emit('data', Buffer.from('q'))
    await settled
    expect(failure).toBe(false)
    expect(progress.model.context).toContain('execution: failed')
    expect(input.isRaw).toBe(false)
    progress.close()
    await progress.flush()
  } finally {
    if (originalTerm === undefined) delete process.env.TERM
    else process.env.TERM = originalTerm
  }
})

test('a refused Flow error still gets a full owned transcript commitment', async () => {
  let output = '',
    failure = false
  const progress = new PrivateCliProgress(
    false,
    async (text) => {
      output += text
    },
    undefined,
    false,
  )
  progress.onOutputFailure(() => {
    failure = true
  })
  const source = progress.observe('progress')
  for (let i = 0; i < 15; i++) source.accept({ kind: 'notice', text: `Information ${i}` })
  source.accept({ kind: 'notice', text: 'Retained blocking cause', severity: 'error' })
  await progress.flush()
  expect(failure).toBe(false)
  expect(output).toContain('Retained blocking cause')
  expect(
    progress.model.attention.find((a) => a.text === 'Retained blocking cause')?.committed,
  ).toBe(true)
  progress.close()
  await progress.flush()
})

test('attention charges full escaped receipt and capacity rejection is atomic', () => {
  const model = new PrivateRunModel()
  const text = '\u001b'.repeat(4096)
  for (let index = 0; index < 19; index++)
    expect(model.addAttention('Flow\u202e', text, 2)).toBe(true)
  const before = model.attention.length,
    bytes = model.attentionBytes
  expect(model.addAttention('Flow', text, 2)).toBe(false)
  expect(model.attention).toHaveLength(before)
  expect(model.attentionBytes).toBe(bytes)
  for (const report of model.attention)
    expect(report.bytes).toBe(Buffer.byteLength(privateAttentionReceipt(report)))
  expect(model.attentionBytes).toBeLessThanOrEqual(491520)
  expect(model.addAttention('Jig', 'Host safe cause', 4)).toBe(true)
})

test.each(['stage', 'complete', 'pause'] as const)(
  'animated %s remains usable after a failed-call burst',
  async (action) => {
    let output = '',
      failure = false
    const progress = new PrivateCliProgress(
      true,
      async (text) => {
        output += text
      },
      undefined,
      true,
    )
    progress.onOutputFailure(() => {
      failure = true
    })
    progress.stage('Waiting for the result')
    for (let i = 0; i < 32; i++)
      progress.observeCall({ ...event(String(i), 'failed'), cause: `Known safe cause ${i}` })
    if (action === 'stage') progress.stage('Stopping remaining work and cleaning up')
    else if (action === 'complete') progress.complete()
    else progress.pause()
    await progress.flush()
    expect(failure).toBe(false)
    expect(output).toContain('Known safe cause 31')
    progress.close()
    await progress.flush()
  },
)
