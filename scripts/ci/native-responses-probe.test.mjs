import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { inspectResponsesProbe } from './native-responses-probe.mjs'

const root = resolve(import.meta.dirname, '../..')
const privateText = 'PRIVATE_TOKEN_MESSAGE_RESPONSE_ID_HEADER'

async function observe({
  status = 200,
  contentType = 'text/event-stream',
  body,
  hold = false,
  milliseconds = 2_000,
}) {
  let requests = 0
  const server = createServer((_, response) => {
    requests++
    response.writeHead(status, { 'Content-Type': contentType, 'X-Request-ID': privateText })
    if (hold) {
      response.flushHeaders()
      return
    }
    response.end(body)
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const signal = AbortSignal.timeout(milliseconds)
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal })
    const result = await inspectResponsesProbe(response, signal)
    assert.deepEqual(Object.keys(result).sort(), ['errorCode', 'httpStatus', 'terminal'])
    assert.equal(JSON.stringify(result).includes(privateText), false)
    assert.equal(requests, 1)
    return result
  } finally {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
}
const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`

test('actual streaming HTTP observation retains only closed terminal facts', async () => {
  const body =
    ': keepalive\r\n\r\n' +
    event({ type: 'response.output_text.delta', delta: privateText }) +
    event({ type: 'response.completed', response: { id: privateText, output: privateText } })
  assert.deepEqual(await observe({ body }), {
    httpStatus: 200,
    errorCode: null,
    terminal: 'completed',
  })
  assert.deepEqual(
    await observe({
      body: event({
        type: 'response.failed',
        response: { error: { code: 503, message: privateText } },
      }),
    }),
    { httpStatus: 200, errorCode: 503, terminal: 'failed' },
  )
  assert.deepEqual(await observe({ body: event({ type: 'response.incomplete' }) }), {
    httpStatus: 200,
    errorCode: null,
    terminal: 'incomplete',
  })
})

test('actual HTTP errors retain only listed numeric provider codes', async () => {
  for (const code of [429, '429', 499, privateText, { token: privateText }]) {
    assert.deepEqual(
      await observe({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ id: privateText, error: { code, message: privateText } }),
      }),
      { httpStatus: 429, errorCode: code === 429 ? 429 : null, terminal: 'failed' },
    )
  }
})

test('missing, malformed and oversized bodies remain closed observations', async () => {
  assert.deepEqual(await observe({ body: 'data: [DONE]\n\n' }), {
    httpStatus: 200,
    errorCode: null,
    terminal: 'missing',
  })
  assert.deepEqual(
    await observe({ status: 502, contentType: 'text/html', body: `<html>${privateText}</html>` }),
    { httpStatus: 502, errorCode: null, terminal: 'malformed' },
  )
  assert.deepEqual(
    await observe({
      body: event({ type: 'response.failed', error: { message: privateText.repeat(2000) } }),
    }),
    { httpStatus: 200, errorCode: null, terminal: 'overflow' },
  )
})

test('the same deadline bounds an actual stalled response body', { timeout: 5_000 }, async () => {
  assert.deepEqual(await observe({ hold: true, milliseconds: 500 }), {
    httpStatus: 200,
    errorCode: null,
    terminal: 'deadline',
  })
})

test('missing credential CLI emits only a closed observation without network work', async () => {
  const environment = { ...process.env }
  delete environment.OPENROUTER_API_KEY
  const child = spawnSync(process.execPath, ['scripts/ci/native-responses-probe.mjs'], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: 2_000,
  })
  assert.ifError(child.error)
  assert.equal(child.status, 0)
  assert.deepEqual(JSON.parse(child.stdout), {
    httpStatus: null,
    errorCode: null,
    terminal: 'missing-credential',
  })
  assert.equal(child.stderr, '')
})

test('the actual failure hook probes Codex once and preserves native and transcript failures', async () => {
  const workflow = parse(
    await readFile(join(root, '.github/workflows/native-agent-api-qualification.yml'), 'utf8'),
  )
  const step = workflow.jobs.qualification.steps.find((step) => step.id === 'native-api')
  assert.ok(step.env.OPENROUTER_API_KEY)
  const hook = step.run.slice(
    step.run.indexOf('qualification_status='),
    step.run.indexOf('node --input-type=module -e'),
  )
  assert.equal((hook.match(/native-responses-probe\.mjs/g) ?? []).length, 1)
  assert.ok(
    hook.includes('timeout --kill-after=2s 30s node scripts/ci/native-responses-probe.mjs || true'),
  )
  const temporary = await mkdtemp(join(tmpdir(), 'jig-native-probe-hook-'))
  try {
    await mkdir(join(temporary, 'bin'))
    await writeFile(join(temporary, 'bin/node'), '#!/bin/sh\nexit 91\n', { mode: 0o700 })
    for (const scenario of [
      { client: 'codex', native: 7, probeFails: false, teeFails: false, exit: 7, observed: true },
      { client: 'codex', native: 7, probeFails: true, teeFails: false, exit: 7, observed: false },
      { client: 'claude', native: 9, probeFails: false, teeFails: false, exit: 9, observed: false },
      { client: 'codex', native: 0, probeFails: false, teeFails: true, exit: 1, observed: false },
      { client: 'codex', native: 0, probeFails: false, teeFails: false, exit: 0, observed: false },
    ]) {
      const env = {
        ...process.env,
        JIG_NATIVE_API_CLIENT: scenario.client,
        PATH: scenario.probeFails
          ? join(temporary, 'bin') + ':' + process.env.PATH
          : dirname(process.execPath) + ':' + process.env.PATH,
      }
      delete env.OPENROUTER_API_KEY
      const destination = scenario.teeFails ? temporary : join(temporary, 'transcript')
      const script = `set -euo pipefail\nset +e\n"$1" -e 'process.exit(${scenario.native})' | tee "$2"\n${hook}`
      const child = spawnSync(
        '/bin/bash',
        ['-c', script, 'probe-hook', process.execPath, destination],
        { cwd: root, env, encoding: 'utf8', timeout: 3_000 },
      )
      assert.ifError(child.error)
      assert.equal(child.status, scenario.exit)
      assert.equal(child.stdout.includes('missing-credential'), scenario.observed)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
