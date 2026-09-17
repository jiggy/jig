import { expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from './fixtures/bounded-command.js'

const evidence = async () => join(await mkdtemp(join(tmpdir(), 'jig-command-test-')), 'command')
const spawn = (script: string) =>
  Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' })

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
