import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { PrivateExplorerClient } from '../dist/explorer-client.js'

const project = (targetId = 'review') => ({
  kind: 'project', revision: 'approved-one', state: 'approved',
  targets: [
    { id: 'review', label: 'Review changes', kind: 'binding', description: 'Draft, check, and review a change.', availability: 'ready' },
    { id: 'draft', label: 'Prepare a draft', kind: 'flow', availability: 'ready' },
    { id: 'worker', label: '<script>Worker</script>', kind: 'flow', availability: 'ready' },
  ],
  selected: {
    targetId,
    composition: {
      state: 'available', provenance: 'admitted', rootId: targetId,
      nodes: [
        { id: targetId, label: targetId === 'review' ? 'Review changes' : 'Prepare a draft', kind: targetId === 'review' ? 'binding' : 'flow' },
        { id: 'worker', label: '<script>Worker</script>', kind: 'flow' },
      ],
      edges: [{ id: 'worker-slot', source: targetId, target: 'worker', slot: 'draft' }],
    },
    input: { state: 'schema', schema: { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] } },
    attachments: [], receives: [], launch: { state: 'available' },
  },
})

async function serverFor(handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    origin: 'http://127.0.0.1:' + server.address().port,
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) },
  }
}
const send = (response, value, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(value))
}
const read = async (request) => {
  let body = ''
  for await (const chunk of request) body += chunk.toString()
  return body
}
async function until(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) {
    if (Date.now() > end) throw new Error('The real HTTP response did not arrive')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('real HTTP client reconciles a lost launch reply without submitting the Run again', async () => {
  const cap = 'c'.repeat(43)
  let status = { state: 'idle' }
  const submissions = []
  let requests = 0
  const server = await serverFor(async (request, response) => {
    requests++
    if (request.headers.authorization !== 'Bearer ' + cap) return send(response, {}, 401)
    if (request.url === '/api/project') return send(response, project())
    if (request.url === '/api/run' && request.method === 'GET') return send(response, status)
    if (request.url === '/api/run' && request.method === 'POST') {
      const source = await read(request)
      submissions.push(source)
      const value = JSON.parse(source)
      status = { state: 'starting', requestId: value.requestId, targetId: value.targetId }
      response.destroy()
      return
    }
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient(cap, () => {}, server.origin)
  try {
    await client.refreshProject()
    await client.refreshRun()
    assert.equal(client.canLaunch, true)
    await client.launch('{"issue":"first","issue":"second"}', 'run-one')
    await until(() => client.run?.state === 'starting')
    assert.equal(client.unresolvedRequest, undefined)
    assert.equal(client.canLaunch, false)
    assert.equal(submissions.length, 1)
    assert.match(submissions[0], /"input":\{"issue":"first","issue":"second"\}/)
    assert.equal(JSON.parse(submissions[0]).revision, 'approved-one')
    assert.equal(await client.launch('{}', 'run-two'), false)
    assert.equal(submissions.length, 1)
    status = { state: 'settled', requestId: 'run-one', targetId: 'review' }
    await client.refreshRun()
    assert.equal(client.canLaunch, true)
    assert(requests >= 5)
  } finally {
    client.stop()
    await server.close()
  }
})

test('a stale status reply cannot replace a newly accepted launch', async () => {
  let gets = 0
  let release
  const server = await serverFor(async (request, response) => {
    if (request.url === '/api/project') return send(response, project())
    if (request.method === 'GET' && request.url === '/api/run') {
      gets++
      if (gets === 2) { release = () => send(response, { state: 'idle' }); return }
      return send(response, gets === 1 ? { state: 'idle' } : { state: 'starting', requestId: 'new-run', targetId: 'review' })
    }
    if (request.method === 'POST' && request.url === '/api/run') {
      await read(request)
      return send(response, { state: 'starting', requestId: 'new-run', targetId: 'review' }, 202)
    }
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    await client.refreshProject()
    await client.refreshRun()
    const oldRead = client.refreshRun()
    await until(() => !!release)
    await client.launch('{}', 'new-run')
    release()
    await oldRead
    await until(() => client.runCurrent)
    assert.equal(client.run.state, 'starting')
    assert.equal(client.run.requestId, 'new-run')
    assert.equal(client.canLaunch, false)
  } finally {
    client.stop()
    await server.close()
  }
})

test('malformed project replacement retains stale configuration and disables launch', async () => {
  let malformed = false
  const server = await serverFor((request, response) => {
    if (request.url.startsWith('/api/project')) return send(response, malformed ? { kind: 'project', revision: 'changed', targets: [] } : project())
    if (request.url === '/api/run') return send(response, { state: 'idle' })
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    await client.refreshProject()
    await client.refreshRun()
    assert.equal(client.canLaunch, true)
    malformed = true
    await client.refreshProject()
    assert.equal(client.project.revision, 'approved-one')
    assert.equal(client.connection, 'stale')
    assert.equal(client.canLaunch, false)
    assert.match(client.projectError, /could not be read/)
  } finally {
    client.stop()
    await server.close()
  }
})

test('an explicit ingress refusal keeps the cause and allows a corrected request after status reconciliation', async () => {
  let posts = 0
  let status = { state: 'idle' }
  const server = await serverFor(async (request, response) => {
    if (request.url.startsWith('/api/project')) return send(response, project())
    if (request.url === '/api/run' && request.method === 'GET') return send(response, status)
    if (request.url === '/api/run' && request.method === 'POST') {
      const value = JSON.parse(await read(request))
      posts++
      if (posts === 1) return send(response, { reason: 'Duplicate JSON members are not accepted.' }, 400)
      status = { state: 'starting', requestId: value.requestId, targetId: value.targetId }
      return send(response, status, 202)
    }
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    await client.refreshProject()
    await client.refreshRun()
    assert.equal(await client.launch('{"issue":1,"issue":2}', 'refused-input'), false)
    await until(() => client.runCurrent)
    assert.equal(client.unresolvedRequest, undefined)
    assert.match(client.requestError, /Duplicate JSON members/)
    assert.equal(client.canLaunch, true)
    assert.equal(posts, 1)
    assert.equal(await client.launch('{"issue":"corrected"}', 'corrected-input'), true)
    assert.equal(client.requestError, '')
    assert.equal(posts, 2)
    assert.equal(client.canLaunch, false)
  } finally {
    client.stop()
    await server.close()
  }
})

test('repeated target selection fences late project reads by exact identity', async () => {
  let release
  const server = await serverFor((request, response) => {
    if (request.url === '/api/project?target=review') { release = () => send(response, project('review')); return }
    if (request.url === '/api/project?target=draft') return send(response, project('draft'))
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    const first = client.refreshProject('review')
    await until(() => !!release)
    await client.refreshProject('draft')
    release()
    await first
    assert.equal(client.project.selected.targetId, 'draft')
    assert.equal(client.connection, 'current')
    client.stop()
    assert.equal(client.project, undefined)
    assert.equal(client.canLaunch, false)
  } finally {
    client.stop()
    await server.close()
  }
})

test('a changed approval reloads the catalogue once without reusing or submitting the stale selection', async () => {
  let changed = false
  const paths = []
  const server = await serverFor((request, response) => {
    paths.push(request.method + ' ' + request.url)
    if (request.url === '/api/project?target=review' && changed)
      return send(response, { code: 'PROJECT_CHANGED', reason: 'The approval changed.' }, 409)
    if (request.url === '/api/project')
      return send(response, { ...project(), revision: changed ? 'approved-two' : 'approved-one' })
    if (request.url === '/api/run') return send(response, { state: 'idle' })
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    await client.refreshProject()
    changed = true
    await client.refreshProject()
    assert.equal(client.project.revision, 'approved-two')
    assert.equal(client.connection, 'current')
    assert.match(client.projectNotice, /workflow changed/)
    assert.equal(client.canLaunch, false, 'Run status has not been read')
    assert.deepEqual(paths, ['GET /api/project', 'GET /api/project?target=review', 'GET /api/project'])
  } finally {
    client.stop()
    await server.close()
  }
})

test('an unconfirmed Close stays fenced across late and fresh Run status replies until explicit Close retry', async () => {
  let statusReads = 0
  let closePosts = 0
  let runPosts = 0
  let release
  const server = await serverFor((request, response) => {
    if (request.url === '/api/project') return send(response, project())
    if (request.url === '/api/run' && request.method === 'GET') {
      statusReads++
      if (statusReads === 2) { release = () => send(response, { state: 'idle' }); return }
      return send(response, { state: 'idle' })
    }
    if (request.url === '/api/close' && request.method === 'POST') {
      closePosts++
      if (closePosts === 1) { response.destroy(); return }
      return send(response, {})
    }
    if (request.url === '/api/run' && request.method === 'POST') runPosts++
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    await client.refreshProject()
    await client.refreshRun()
    assert.equal(client.canLaunch, true)
    const oldRead = client.refreshRun()
    await until(() => !!release)
    assert.equal(await client.close(), false)
    release()
    await oldRead
    await until(() => client.runCurrent)
    assert.equal(client.run.state, 'idle')
    assert(statusReads >= 3, 'read-only status reconciliation resumes after the failed Close')
    assert.equal(client.canLaunch, false)
    assert.match(client.runError, /Closing the explorer was not confirmed/)
    await client.refreshRun()
    assert.equal(client.canLaunch, false, 'fresh idle status cannot undo the Close fence')
    assert.match(client.runError, /try Close explorer again/)
    assert.equal(await client.launch('{}', 'after-close'), false)
    assert.equal(runPosts, 0)
    assert.equal(closePosts, 1, 'reconciliation never retries Close automatically')
    assert.equal(await client.close(), true)
    assert.equal(closePosts, 2)
    assert.equal(client.connection, 'closed')
    assert.equal(client.canLaunch, false)
  } finally {
    client.stop()
    await server.close()
  }
})

test('a lost busy refusal resolves by request identity while only global state permits the next launch', async () => {
  let status = { state: 'idle' }
  let retained
  let reveal = false
  let posts = 0
  const reads = []
  const server = await serverFor(async (request, response) => {
    if (request.url.startsWith('/api/project')) return send(response, project())
    if (request.url === '/api/run' && request.method === 'GET') {
      reads.push('global')
      return send(response, status)
    }
    if (request.url.startsWith('/api/run?requestId=') && request.method === 'GET') {
      reads.push('request')
      if (!reveal) return send(response, { code: 'REQUEST_UNKNOWN', reason: 'No retained result is available for this request. This does not confirm that it did not start.' }, 404)
      return send(response, retained)
    }
    if (request.url === '/api/run' && request.method === 'POST') {
      const value = JSON.parse(await read(request))
      posts++
      status = { state: 'running', requestId: 'another-tab-' + posts, targetId: 'draft' }
      retained = { state: 'refused', requestId: value.requestId, targetId: value.targetId, reason: 'Another run belongs to this explorer.' }
      if (posts === 1) response.destroy()
      else send(response, retained)
      return
    }
    send(response, {}, 404)
  })
  const client = new PrivateExplorerClient('a'.repeat(43), () => {}, server.origin)
  try {
    await client.refreshProject()
    await client.refreshRun()
    await client.launch('{}', 'busy-request')
    await until(() => client.runCurrent && client.runError.includes('No retained result'))
    assert.equal(client.unresolvedRequest, 'busy-request')
    assert.equal(client.canLaunch, false, 'an unknown lookup never establishes that work did not start')
    assert.equal(posts, 1)
    reveal = true
    await client.refreshRun()
    assert.equal(client.unresolvedRequest, undefined)
    assert.match(client.requestError, /Another run/)
    assert.equal(client.run.state, 'running')
    assert.equal(client.run.requestId, 'another-tab-1')
    assert.equal(client.canLaunch, false, 'the resolved refusal does not replace the actual active run')
    assert.deepEqual(reads.slice(-2), ['global', 'request'])
    status = { state: 'settled', requestId: 'another-tab-1', targetId: 'draft' }
    await client.refreshRun()
    assert.equal(client.canLaunch, true)
    assert.equal(await client.launch('{}', 'acknowledged-busy-request'), false)
    assert.equal(client.canLaunch, false, 'even an acknowledged refusal waits for global reconciliation')
    await until(() => client.runCurrent)
    assert.equal(client.run.requestId, 'another-tab-2')
    assert.equal(client.run.state, 'running')
    assert.equal(client.canLaunch, false)
    assert.equal(posts, 2, 'only the two explicit launch calls submit work')
  } finally {
    client.stop()
    await server.close()
  }
})
