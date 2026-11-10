import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const candidates = [
  { id: 'a', description: 'Translate supplied prose to French.' },
  { id: 'b', description: 'Summarize supplied prose in its original language.' },
]
const input = { task: 'Summarize this prose in its original language.', candidates }
const decision = { candidateId: 'b', reason: 'Preserves the requested language.' }
const completed = (structured = decision) => ({
  outcome: 'done', output: { text: JSON.stringify(structured), structured },
})

// Execute the production Flow. The sole controlled external boundary is the
// Agent Run/0 participant; no RunContext, native owner or execution receipt is replaced.
async function invoke(input, { serveAgent = () => ({ result: completed() }), cancel = false, invalidWire = false } = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    "const {runRouterFlow}=await import('./dist/flow.js');await runRouterFlow()"],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = '', stderr = '', terminal
  const calls = [], answered = new Set()
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + '\n')
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', text => { stderr += text })
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
  try {
    send({ jsonrpc: '2.0', id: 'run', method: 'flow/run', params: {
      protocol: 'run/0', input, settings: {}, attachments: {}, channels: {},
      scratch: root, deadlineUnixMs: Date.now() + 10_000,
    } })
    for await (const chunk of child.stdout) {
      buffer += chunk.toString('utf8')
      assert.ok(Buffer.byteLength(buffer) < 128 * 1024)
      while (buffer.includes('\n')) {
        const newline = buffer.indexOf('\n')
        const frame = JSON.parse(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        if (frame.method === 'flow/call') {
          assert.equal(frame.params.slot, 'agent')
          assert.equal(calls.push(frame.params), 1, 'The selector retried the Agent.')
          if (cancel) {
            send({ jsonrpc: '2.0', method: 'request/cancel', params: { requestId: 'run' } })
          } else {
            const reply = serveAgent(frame.params)
            answered.add(frame.id)
            send({ jsonrpc: '2.0', id: frame.id, ...reply })
          }
        } else if (frame.method === 'request/cancel') {
          const id = frame.params.requestId
          if (!answered.has(id)) {
            answered.add(id)
            send({ jsonrpc: '2.0', id, error: { code: -32000,
              message: 'Agent work cancelled.', data: { code: 'CANCELLED' } } })
          }
        } else if (frame.id === 'run') {
          assert.equal(terminal, undefined)
          terminal = frame
          child.stdin.end()
        } else assert.fail('Unexpected Flow frame: ' + JSON.stringify(frame))
      }
    }
    const exitCode = await closed
    if (invalidWire) return { exitCode, stderr, terminal, calls }
    assert.equal(exitCode, 0, stderr)
    assert.equal(stderr, '')
    assert.ok(terminal, 'The Flow produced no terminal response.')
    assert.equal(buffer, '')
    return { terminal, calls }
  } finally {
    clearTimeout(timer)
    child.stdin.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await closed
  }
}
const agent = (output) => ({ result: output })

test('empty candidates abstain without invoking an Agent', async () => {
  const { terminal, calls } = await invoke({ ...input, candidates: [] })
  assert.deepEqual(terminal.result, {
    outcome: 'done', output: { candidateId: null, reason: 'No eligible candidates supplied.' },
  })
  assert.equal(calls.length, 0)
})

test('a sole candidate receives an applicability judgment and can abstain', async () => {
  const { terminal, calls } = await invoke({ ...input, candidates: [candidates[0]] }, {
    serveAgent: () => agent(completed({ candidateId: null, reason: 'Translation cannot satisfy this task.' })),
  })
  assert.equal(terminal.result.output.candidateId, null)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].input.responseSchema.properties.candidateId.enum, ['a', null])
})

test('the actual process carries the complete bounded task and validates exact membership', async () => {
  const mutable = structuredClone(input)
  const { terminal, calls } = await invoke(mutable, { serveAgent: request => {
    mutable.candidates[1].id = 'changed'
    assert.ok(request.input.instructions.includes(JSON.stringify(input)))
    return agent(completed())
  } })
  assert.deepEqual(terminal.result, { outcome: 'done', output: decision })
  assert.equal(calls.length, 1)
})

test('invalid invocation data fails before Agent dispatch', async () => {
  for (const value of [null, {}, { ...input, extra: true }, { ...input, task: '' }]) {
    const { terminal, calls } = await invoke(value)
    assert.equal(terminal.error.data.code, 'INVALID_INPUT')
    assert.equal(calls.length, 0)
  }
})

test('malformed Agent decisions cannot invent targets, outcomes, fields or unbounded reasons', async () => {
  for (const response of [
    { outcome: 'done', output: {} },
    completed({ candidateId: 'outside', reason: 'Choose this target.' }),
    completed({ candidateId: 'b', reason: '', slot: 'outside' }),
    completed({ candidateId: 'b', reason: 'é'.repeat(1001) }),
    { outcome: 'cancelled', output: { text: 'Not an Agent outcome.' } },
  ]) {
    const { terminal, calls } = await invoke(input, { serveAgent: () => agent(response) })
    assert.equal(terminal.error.data.code, 'INVALID_RESULT')
    assert.equal(calls.length, 1)
  }
})

test('malformed Run/0 replies fail at the real protocol boundary', async () => {
  for (const response of [null, {}]) {
    const { exitCode, stderr, terminal, calls } = await invoke(input, {
      serveAgent: () => agent(response), invalidWire: true,
    })
    assert.notEqual(exitCode, 0)
    assert.match(stderr, /PROTOCOL_ERROR/)
    assert.equal(terminal, undefined)
    assert.equal(calls.length, 1)
  }
})

for (const outcome of ['blocked', 'limit']) {
  test(outcome + ' remains distinct from completed abstention', async () => {
    const { terminal, calls } = await invoke(input, {
      serveAgent: () => agent({ outcome, output: { text: 'No capacity.' } }),
    })
    assert.deepEqual(terminal.result, { outcome, output: { reason: 'No capacity.' } })
    assert.equal(calls.length, 1)
  })
}

test('operational Agent failure propagates without retry or fallback', async () => {
  const { terminal, calls } = await invoke(input, { serveAgent: () => ({
    error: { code: -32000, message: 'Agent unavailable.', data: { code: 'UNAVAILABLE' } },
  }) })
  assert.equal(terminal.error.data.code, 'UNAVAILABLE')
  assert.equal(calls.length, 1)
})

test('actual Run/0 cancellation settles the Agent and returns no decision', async () => {
  const { terminal, calls } = await invoke(input, { cancel: true })
  assert.equal(terminal.error.data.code, 'CANCELLED')
  assert.equal(terminal.result, undefined)
  assert.equal(calls.length, 1)
})
