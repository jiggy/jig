import { expect, test } from 'bun:test'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from '.././fixtures/bounded-command.js'

const evidence = async () => join(await mkdtemp(join(tmpdir(), 'jig-command-test-')), 'command')
const spawn = (script: string) =>
  Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })

test('retains observed output before the command exits', async () => {
  const path = await evidence()
  const child = spawn('console.log("early"); setInterval(()=>{},100)')
  const pending = settleTestCommand(child, { evidence: path, timeoutMs: 2000 })
  try {
    let observed = ''
    for (let attempt = 0; attempt < 100 && observed !== 'early\n'; attempt++) {
      await Bun.sleep(10)
      observed = await readFile(`${path}.stdout`, 'utf8').catch(() => '')
    }
    expect(observed).toBe('early\n')
    expect(child.exitCode).toBeNull()
  } finally {
    child.kill('SIGINT')
    await pending
  }
})
test('an evidence collision stops the command without overwriting the old record', async () => {
  const path = await evidence()
  await writeFile(`${path}.stdout`, 'previous evidence')
  const child = spawn('setInterval(()=>{},100)')
  await expect(settleTestCommand(child, { evidence: path, graceMs: 30 })).rejects.toBeInstanceOf(
    AggregateError,
  )
  expect(await readFile(`${path}.stdout`, 'utf8')).toBe('previous evidence')
  expect(await child.exited).toBe(130)
  expect(child.signalCode).toBe('SIGINT')
})
test('installed command keeps exact bounded output and waits for exit', async () => {
  const path = await evidence()
  const result = await settleTestCommand(
    spawn('console.log("answer"); console.error("diagnostic")'),
    { evidence: path },
  )
  expect(result).toEqual({ code: 0, stdout: 'answer\n', stderr: 'diagnostic\n' })
  expect(await readFile(`${path}.stderr`, 'utf8')).toBe(result.stderr)
})
test('output overflow preserves the prefix and reaps a child ignoring interruption', async () => {
  const path = await evidence()
  const child = spawn(
    'process.on("SIGINT",()=>{}); console.log("x".repeat(500)); setInterval(()=>{},100)',
  )
  await expect(
    settleTestCommand(child, { evidence: path, stdoutLimit: 32, graceMs: 30 }),
  ).rejects.toBeInstanceOf(AggregateError)
  expect(child.signalCode).toBe('SIGKILL')
  expect(await child.exited).toBe(137)
  expect(await readFile(`${path}.stdout`, 'utf8')).toBe('x'.repeat(32))
})
test('timeout escalates and waits for a child ignoring SIGINT', async () => {
  const path = await evidence()
  const child = spawn('process.on("SIGINT",()=>{}); console.log("ready"); setInterval(()=>{},100)')
  await expect(
    settleTestCommand(child, { evidence: path, timeoutMs: 300, graceMs: 30 }),
  ).rejects.toBeInstanceOf(AggregateError)
  expect(child.signalCode).toBe('SIGKILL')
  expect(await readFile(`${path}.stdout`, 'utf8')).toBe('ready\n')
})
test('reader failure retains diagnostics and waits for actual child exit', async () => {
  const path = await evidence()
  const child = spawn(
    'process.on("SIGINT",()=>{}); console.error("ready"); setInterval(()=>{},100)',
  )
  const failed = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => controller.error(new Error('read failed')), 300)
    },
  })
  await expect(
    settleTestCommand(
      {
        exited: child.exited,
        stdout: failed,
        stderr: child.stderr,
        kill: (signal) => child.kill(signal),
      },
      { evidence: path, graceMs: 30 },
    ),
  ).rejects.toBeInstanceOf(AggregateError)
  expect(child.signalCode).toBe('SIGKILL')
  expect(await child.exited).toBe(137)
  expect(await readFile(`${path}.stderr`, 'utf8')).toBe('ready\n')
})

test('unconfirmed exit after escalation refuses instead of hanging or establishing cleanup', async () => {
  const path = await evidence()
  const signals: string[] = []
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('retained prefix\n'))
      },
    })
  const outcome = settleTestCommand(
    {
      exited: new Promise<number>(() => {}),
      stdout: stream(),
      stderr: stream(),
      kill(signal) {
        signals.push(signal)
      },
    },
    { evidence: path, timeoutMs: 20, graceMs: 20 },
  )
  const failure = await outcome.then(
    () => undefined,
    (error) => error,
  )
  expect(failure).toBeInstanceOf(AggregateError)
  expect(failure.errors.some((error: Error) => error.message.includes('exit is unconfirmed'))).toBe(
    true,
  )
  expect(signals).toEqual(['SIGINT', 'SIGKILL'])
  expect(await readFile(`${path}.stdout`, 'utf8')).toBe('retained prefix\n')
  expect((await stat(`${path}.stdout`)).mode & 0o777).toBe(0o600)
})

test('a zero exit after the command deadline cannot turn timeout into success', async () => {
  const path = await evidence()
  let resolveExit!: (code: number) => void
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve
  })
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  const failure = await settleTestCommand(
    {
      exited,
      stdout: stream(),
      stderr: stream(),
      kill() {
        resolveExit(0)
      },
    },
    { evidence: path, timeoutMs: 20, graceMs: 20 },
  ).then(
    () => undefined,
    (error) => error,
  )
  expect(failure).toBeInstanceOf(AggregateError)
  expect(
    failure.errors.some((error: Error) => error.message === 'Installed command timed out'),
  ).toBe(true)
})

test('a rejected exit observer retains escalation and refuses unconfirmed exit', async () => {
  const path = await evidence()
  const signals: string[] = []
  const observerError = new Error('exit observation failed')
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  const failure = await settleTestCommand(
    {
      exited: Promise.reject(observerError),
      stdout: stream(),
      stderr: stream(),
      kill(signal) {
        signals.push(signal)
      },
    },
    { evidence: path, timeoutMs: 200, graceMs: 20 },
  ).then(
    () => undefined,
    (error) => error,
  )
  expect(failure).toBeInstanceOf(AggregateError)
  expect(failure.errors).toContain(observerError)
  expect(failure.errors.some((error: Error) => error.message.includes('exit is unconfirmed'))).toBe(
    true,
  )
  expect(signals).toEqual(['SIGINT', 'SIGKILL'])
})
