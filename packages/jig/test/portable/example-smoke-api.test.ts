import { afterAll, beforeAll, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startExampleSmokeApi } from '../fixtures/example-smoke-api.js'

let root: string
let certFile: string
let keyFile: string
let certificate: Buffer
const model = 'gpt-5.3-codex'
const token = 'jig-example-fixture-api-key'

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'jig-example-api-'))
  certFile = join(root, 'certificate.pem')
  keyFile = join(root, 'key.pem')
  const configuration = join(root, 'openssl.cnf')
  await writeFile(
    configuration,
    [
      '[req]',
      'distinguished_name = dn',
      'x509_extensions = extensions',
      'prompt = no',
      '[dn]',
      'CN = Jig example smoke fixture',
      '[extensions]',
      'subjectAltName = IP:127.0.0.1',
      'basicConstraints = critical,CA:TRUE',
      'keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign',
      'extendedKeyUsage = serverAuth',
      '',
    ].join('\n'),
  )
  const openssl = Bun.spawn(
    [
      'openssl',
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '2',
      '-config',
      configuration,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [code, stdout, stderr] = await Promise.all([
    openssl.exited,
    new Response(openssl.stdout).text(),
    new Response(openssl.stderr).text(),
  ])
  assert.equal(code, 0, stdout + stderr)
  certificate = await readFile(certFile)
})

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

function post(
  url: string,
  body: unknown,
  options: { token?: string; trust?: boolean } = {},
): Promise<{ status: number; contentType: string | undefined; text: string }> {
  return new Promise((resolve, reject) => {
    const client = request(
      url,
      {
        method: 'POST',
        ...(options.trust === false ? {} : { ca: certificate }),
        headers: {
          authorization: `Bearer ${options.token ?? token}`,
          'content-type': 'application/json',
        },
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          text += chunk
        })
        response.once('error', reject)
        response.once('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers['content-type'],
            text,
          }),
        )
      },
    )
    client.once('error', reject)
    client.setTimeout(5000, () => client.destroy(new Error('HTTPS fixture request timed out')))
    client.end(JSON.stringify(body))
  })
}

function input(text: string) {
  return {
    model,
    stream: true,
    instructions: 'Return the requested JSON.',
    input: [{ role: 'user', content: [{ type: 'input_text', text }] }],
  }
}

test('the trusted HTTPS peer returns a complete native Responses event stream', async () => {
  const api = await startExampleSmokeApi({
    certFile,
    keyFile,
    model,
    token,
    expectedRequests: 1,
    reply(prompt) {
      assert.equal(prompt, 'Return the requested JSON.\nResolve the labelled example.')
      return '{"ready":true}'
    },
  })
  try {
    assert.throws(() => api.assertConsumed(), /Unexpected model-request count/)
    const response = await post(`${api.baseURL}/responses`, input('Resolve the labelled example.'))
    assert.equal(response.status, 200)
    assert.match(response.contentType ?? '', /^text\/event-stream/)
    const events = response.text
      .trim()
      .split('\n\n')
      .map((frame) => {
        const lines = frame.split('\n')
        const data = lines.find((line) => line.startsWith('data: '))
        assert.ok(data, 'Each SSE frame needs a JSON data line')
        const event = JSON.parse(data.slice(6))
        assert.equal(lines[0], `event: ${event.type}`)
        return event
      })
    assert.deepEqual(
      events.map((event) => event.type),
      ['response.created', 'response.output_item.done', 'response.completed'],
    )
    assert.equal(events[1].item.role, 'assistant')
    assert.equal(events[1].item.content[0].text, '{"ready":true}')
    assert.deepEqual(events[2].response.output, [events[1].item])
    assert.equal(events[2].response.status, 'completed')
    assert.equal(api.consumedRequests, 1)
    api.assertConsumed()
  } finally {
    await api.close()
  }
}, 10_000)

test('concurrent native model requests dispatch by actual task content', async () => {
  const api = await startExampleSmokeApi({
    certFile,
    keyFile,
    model,
    token,
    expectedRequests: 2,
    async reply(prompt) {
      if (prompt.endsWith('first task')) {
        await Bun.sleep(10)
        return '{"job":"first"}'
      }
      assert.ok(prompt.endsWith('second task'))
      return '{"job":"second"}'
    },
  })
  try {
    const results = await Promise.all(
      ['first task', 'second task'].map((task) => post(`${api.baseURL}/responses`, input(task))),
    )
    assert.ok(results.every(({ status }) => status === 200))
    assert.ok(results[0].text.includes('first'))
    assert.ok(results[1].text.includes('second'))
    api.assertConsumed()
  } finally {
    await api.close()
  }
}, 10_000)

test('the HTTPS peer requires ordinary certificate trust before a task can run', async () => {
  const api = await startExampleSmokeApi({
    certFile,
    keyFile,
    model,
    token,
    expectedRequests: 1,
    reply: () => '{"ready":true}',
  })
  try {
    await assert.rejects(post(`${api.baseURL}/responses`, input('task'), { trust: false }))
    assert.equal(api.consumedRequests, 0)
    assert.throws(() => api.assertConsumed(), /Unexpected model-request count/)
  } finally {
    await api.close()
  }
}, 10_000)

test('unknown endpoints, credentials, model requests and tasks cannot count as a passing smoke', async () => {
  for (const refusal of ['endpoint', 'credential', 'model', 'stream', 'input', 'task'] as const) {
    let called = false
    const api = await startExampleSmokeApi({
      certFile,
      keyFile,
      model,
      token,
      expectedRequests: 1,
      reply: () => {
        called = true
        throw new Error('Unknown task text must stay private')
      },
    })
    try {
      const body = input('task')
      if (refusal === 'model') body.model = 'unexpected'
      if (refusal === 'stream') body.stream = false
      if (refusal === 'input') {
        const message = body.input[0]
        assert.ok(message)
        const content = message.content[0]
        assert.ok(content)
        content.type = 'input_image'
      }
      const response = await post(
        `${api.baseURL}/${refusal === 'endpoint' ? 'unknown' : 'responses'}`,
        body,
        refusal === 'credential' ? { token: 'unexpected-token' } : {},
      )
      assert.ok(response.status >= 400)
      assert.equal(api.consumedRequests, 0)
      assert.throws(() => api.assertConsumed(), /Example smoke API refused requests/)
      assert.ok(!response.text.includes('Unknown task text'))
      if (refusal === 'input') {
        assert.equal(called, false, 'Invalid Responses input must not reach the task callback')
        assert.match(response.text, /invalid-responses-input/)
      }
      if (refusal === 'task') {
        assert.equal(called, true)
        assert.match(response.text, /unexpected-task/)
      }
    } finally {
      await api.close()
    }
  }
}, 10_000)

test('extra requests fail even after every expected response completed', async () => {
  const api = await startExampleSmokeApi({
    certFile,
    keyFile,
    model,
    token,
    expectedRequests: 1,
    reply: () => '{"ready":true}',
  })
  try {
    assert.equal((await post(`${api.baseURL}/responses`, input('task'))).status, 200)
    api.assertConsumed()
    assert.equal((await post(`${api.baseURL}/responses`, input('task'))).status, 409)
    assert.throws(() => api.assertConsumed(), /extra-model-request/)
  } finally {
    await api.close()
  }
}, 10_000)
