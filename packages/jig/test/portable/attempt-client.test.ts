import { afterAll, beforeAll, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type CanonicalRequest,
  createAttemptClient,
  parseAttemptEnvelope,
  parseAttemptFrame,
} from '../../src/client.js'

const digest = `sha256:${'0'.repeat(64)}`
const request: CanonicalRequest = {
  expectedApproval: digest,
  target: 'binding:test',
  input: null,
  files: [],
  constraints: { durationMs: 1000, resultBytes: 1024, artifactBytes: 0 },
  outputIntent: { packet: true, receive: [] },
}
let directory: string
let executable: string
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jig-client-'))
  executable = join(directory, 'installed fixture')
  await writeFile(
    executable,
    `#!${process.execPath}
const { connect } = require('node:net');
const mode = process.env.FIXTURE_MODE;
let text = '', sent = false;
const digest = ${JSON.stringify(digest)};
const receipt = {runId:'original',requestDigest:digest,acceptedAt:'2026-01-01T00:00:00Z',target:'binding:test',approval:digest,artifactResults:[]};
const observation = {identity:'accepted',dispatch:'possible',receipt,execution:'terminal',cleanup:'confirmed',retained:'available',terminal:{status:'lost',code:'COORDINATOR_LOST',message:'lost'}};
let operation;
const emit = value => process.stdout.write(JSON.stringify({protocolVersion:1,operation,...value})+'\\n');
process.stdin.on('data', chunk => {
 text += chunk;
 if(sent || !text.includes('\\n')) return;
 sent = true;
 const envelope = JSON.parse(text.split('\\n')[0]);
 operation = envelope.operation;
 if(JSON.stringify(process.argv).includes('private-ticket')) process.exit(7);
 if(process.argv.slice(2).join(' ') !== 'attempt '+operation+' --json') process.exit(8);
 if(mode === 'unary-abort') {
   const socket = connect(Number(process.env.FIXTURE_PORT), '127.0.0.1');
   process.on('SIGTERM', () => socket.end('terminated', () => process.exit(0)));
   socket.on('connect', () => socket.write('ready'));
   return;
 }
 if(mode === 'partial') { process.stdout.write('{"private-ticket":'); process.exit(0); }
 if(mode === 'malformed') { process.stdout.write('private-ticket\\n'); process.stderr.write('secret private-ticket'); process.exit(0); }
 if(mode === 'oversize') { process.stdout.write('x'.repeat(16777217)); return; }
 if(mode === 'uncertain-before-accepted') { emit({event:'error',code:'EXECUTION_UNCERTAIN',message:'private-ticket'}); return; }
 if(operation === 'submit') {
   if(mode === 'wrong-accepted-target') receipt.target = 'binding:other';
   if(mode === 'wrong-accepted-approval') receipt.approval = 'sha256:'+'f'.repeat(64);
   emit({event:'accepted',role:mode==='observer'?'observer':'owner',receipt});
   if(mode === 'owner-close' || mode === 'observer') return;
   if(mode === 'accepted-eof') process.exit(0);
   if(mode === 'wrong-run') observation.receipt = {...receipt,runId:'other'};
   if(mode === 'wrong-request') observation.receipt = {...receipt,requestDigest:'sha256:'+'f'.repeat(64)};
   if(mode === 'wrong-acceptance') observation.receipt = {...receipt,acceptedAt:'2026-01-02T00:00:00Z'};
   if(mode === 'wrong-target') observation.receipt = {...receipt,target:'binding:other'};
   if(mode === 'wrong-approval') observation.receipt = {...receipt,approval:'sha256:'+'f'.repeat(64)};
   if(mode === 'missing-receipt') delete observation.receipt;
   if(mode === 'lossy-stderr') observation.terminal = {status:'failed',code:'EXECUTION_FAILED',message:'reported failure',diagnostics:{stderr:'\\ufffd'.repeat(65536),stderrBytes:65536,stderrTruncated:false}};
   setTimeout(() => emit({event:'terminal',observation}), 30);
 } else if(operation === 'inspect') {
   emit({event:'result',value:{state:'unchecked',approval:digest,targets:[]}});
 } else if(operation === 'prepare') {
   emit({event:'result',value:{ticket:'private-ticket',requestDigest:digest,submitBefore:'2026-01-01T00:00:00Z',retainUntil:'2026-01-02T00:00:00Z',canonicalRequest:envelope.request}});
 } else emit({event:'result',value:observation});
});
process.stdin.on('end', () => {
 if(mode === 'unary-abort') return;
 if(operation === 'submit' && mode === 'owner-close') emit({event:'terminal',observation});
 process.exit(0);
});
`,
  )
  await chmod(executable, 0o700)
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})
const client = (mode = 'normal') =>
  createAttemptClient({
    executable,
    cwd: directory,
    env: { ...process.env, FIXTURE_MODE: mode },
    timeoutMs: 5000,
  })
test('strict shared request and frame parsers reject unknown fields and enum spoofing', () => {
  expect(() =>
    parseAttemptEnvelope('lookup', {
      protocolVersion: 1,
      operation: 'lookup',
      request: { ticket: 't', extra: true },
    }),
  ).toThrow()
  expect(() =>
    parseAttemptFrame('lookup', {
      protocolVersion: 1,
      operation: 'lookup',
      event: 'result',
      value: { identity: 'fresh' },
    }),
  ).toThrow()
  expect(() =>
    parseAttemptEnvelope('lookup', {
      protocolVersion: 2,
      operation: 'lookup',
      request: { ticket: 't' },
    }),
  ).toThrow()
})
test('owner keeps request connection open until terminal, preserving original receipt', async () => {
  const submission = await client().submit({ ticket: 'private-ticket', request })
  expect(submission.role).toBe('owner')
  expect(submission.receipt.runId).toBe('original')
  expect((await submission.completion)?.cleanup).toBe('confirmed')
})
test('inspection uses the same installed boundary without submitting work', async () => {
  expect(await client().inspect()).toEqual({ state: 'unchecked', approval: digest, targets: [] })
})
test('observer closes without requiring terminal or acquiring execution ownership', async () => {
  const submission = await client('observer').submit({ ticket: 'private-ticket', request })
  expect(submission.role).toBe('observer')
  expect(await submission.completion).toBeUndefined()
})
test('explicit owner connection close lets host settle cancellation', async () => {
  const submission = await client('owner-close').submit({ ticket: 'private-ticket', request })
  submission.close()
  expect((await submission.completion)?.execution).toBe('terminal')
})
for (const mode of ['partial', 'malformed', 'oversize']) {
  test(`bounded ${mode} failure never exposes ticket or stderr`, async () => {
    try {
      await client(mode).lookup({ ticket: 'private-ticket' })
      throw new Error('expected failure')
    } catch (error) {
      expect(String(error)).not.toContain('private-ticket')
      expect(String(error)).not.toContain('secret')
      expect(error).toHaveProperty('uncertain', true)
    }
  })
}
test('EOF after acceptance preserves uncertainty and does not retry', async () => {
  const submission = await client('accepted-eof').submit({ ticket: 'private-ticket', request })
  await expect(submission.completion).rejects.toHaveProperty('code', 'TRANSPORT_UNCERTAIN')
})
test('host uncertainty before accepted delivery remains uncertain to the application', async () => {
  try {
    await client('uncertain-before-accepted').submit({ ticket: 'private-ticket', request })
    throw new Error('expected failure')
  } catch (error) {
    expect(error).toHaveProperty('code', 'EXECUTION_UNCERTAIN')
    expect(error).toHaveProperty('uncertain', true)
    expect(String(error)).not.toContain('private-ticket')
  }
})
test('lossy diagnostic decoding preserves raw byte counters rather than inventing protocol failure', async () => {
  const submission = await client('lossy-stderr').submit({ ticket: 'private-ticket', request })
  const observation = await submission.completion
  expect(observation?.terminal?.status).toBe('failed')
  if (observation?.terminal?.status !== 'failed') throw new Error('expected failed execution')
  expect(observation.terminal.diagnostics.stderrBytes).toBe(65536)
  expect(observation.terminal.diagnostics.stderr).toBe('\ufffd'.repeat(65536))
  expect(observation.terminal.diagnostics.stderrTruncated).toBe(false)
})
for (const mode of [
  'wrong-run',
  'wrong-request',
  'wrong-acceptance',
  'wrong-target',
  'wrong-approval',
  'missing-receipt',
]) {
  test(`terminal ${mode} cannot replace the original acceptance`, async () => {
    const submission = await client(mode).submit({ ticket: 'private-ticket', request })
    await expect(submission.completion).rejects.toHaveProperty('code', 'PROTOCOL_ERROR')
  })
}
test('pre-aborted signal never launches and is definitely local', async () => {
  const controller = new AbortController()
  controller.abort('private-ticket')
  await expect(
    client().lookup({ ticket: 'private-ticket' }, { signal: controller.signal }),
  ).rejects.toHaveProperty('uncertain', false)
})
test('unary abort signals a ready ordinary child and preserves uncertainty without retry', async () => {
  const controller = new AbortController()
  const sockets: Socket[] = []
  let transcript = ''
  let ready!: () => void
  let drained!: () => void
  const readiness = new Promise<void>((resolve) => {
    ready = resolve
  })
  const drain = new Promise<void>((resolve) => {
    drained = resolve
  })
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('end', drained)
    socket.on('data', (chunk) => {
      transcript += chunk.toString()
      if (transcript === 'ready') ready()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('expected TCP listener')
  const pending = createAttemptClient({
    executable,
    cwd: directory,
    timeoutMs: 5000,
    env: { ...process.env, FIXTURE_MODE: 'unary-abort', FIXTURE_PORT: String(address.port) },
  }).lookup({ ticket: 'private-ticket' }, { signal: controller.signal })
  const settled = pending.catch((error) => error)
  let timer!: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('child handshake deadline exceeded')), 4000)
  })
  try {
    await Promise.race([readiness, deadline])
    expect(transcript).toBe('ready')
    controller.abort('private-ticket')
    const error = await settled
    expect(error).toHaveProperty('code', 'ABORTED')
    expect(error).toHaveProperty('uncertain', true)
    expect(String(error)).not.toContain('private-ticket')
    await Promise.race([drain, deadline])
    expect(transcript).toBe('readyterminated')
    expect(sockets).toHaveLength(1)
  } finally {
    clearTimeout(timer)
    controller.abort()
    await settled
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 10000)
for (const mode of ['wrong-accepted-target', 'wrong-accepted-approval']) {
  test(`${mode} cannot accept a different submitted identity`, async () => {
    await expect(client(mode).submit({ ticket: 'private-ticket', request })).rejects.toHaveProperty(
      'code',
      'PROTOCOL_ERROR',
    )
  })
}
for (const mode of ['owner-close', 'observer']) {
  test(`AbortSignal closes ${mode} connection without sending private reason`, async () => {
    const controller = new AbortController()
    const submission = await client(mode).submit(
      { ticket: 'private-ticket', request },
      { signal: controller.signal },
    )
    controller.abort('private-ticket')
    // An observer can already have cleanly closed before the signal arrives.
    try {
      await submission.completion
    } catch (error) {
      expect(error).toHaveProperty('code', 'ABORTED')
      expect(String(error)).not.toContain('private-ticket')
    }
  })
}
test('joined run awaits persistence before submitting', async () => {
  let persisted = false
  const result = await client().run(request, {
    persist: async (prepared) => {
      expect(prepared.ticket).toBe('private-ticket')
      persisted = true
    },
  })
  expect(persisted).toBe(true)
  expect(result.receipt.runId).toBe('original')
})
test('one-shot run needs no persistence callback and adds no alternative lifecycle', async () => {
  const result = await client().run(request)
  expect(result.role).toBe('owner')
  expect(result.receipt.runId).toBe('original')
  expect(result.observation?.execution).toBe('terminal')
})
