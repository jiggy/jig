import { expect, test } from 'bun:test'
import { USER_UPDATES_CONTRACT } from '../src/index.js'

test('public SDK transport retains delayed send failure after successful abnormal close', async () => {
  const child = Bun.spawn(
    [process.execPath, new URL('./wire-fixture.ts', import.meta.url).pathname],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  )
  const lines: unknown[] = []
  let wake: (() => void) | undefined
  const reading = (async () => {
    let text = ''
    for await (const chunk of child.stdout) {
      text += new TextDecoder().decode(chunk)
      let newline: number
      while (true) {
        newline = text.indexOf('\n')
        if (newline < 0) break
        lines.push(JSON.parse(text.slice(0, newline)))
        text = text.slice(newline + 1)
        wake?.()
      }
    }
    wake?.()
  })()
  const next = async (): Promise<any> => {
    while (!lines.length)
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    return lines.shift()
  }
  const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n')
  const timeout = setTimeout(() => child.kill(), 8000)
  try {
    send({
      jsonrpc: '2.0',
      id: 'host:1',
      method: 'flow/run',
      params: {
        protocol: 'run/0',
        input: {},
        settings: {},
        attachments: {},
        scratch: '/tmp/run',
        deadlineUnixMs: Date.now() + 10_000,
        channels: {
          updates: {
            endpoint: 'updates:1',
            direction: 'send',
            delivery: 'direct',
            contract: USER_UPDATES_CONTRACT,
          },
        },
      },
    })
    const original = await next()
    expect(original.method).toBe('channel/send')
    const closing = await next()
    expect(closing).toMatchObject({
      method: 'channel/close',
      params: { endpoint: 'updates:1', error: 'LAGGED' },
    })
    send({ jsonrpc: '2.0', id: closing.id, result: null })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(lines).toEqual([])
    send({
      jsonrpc: '2.0',
      id: original.id,
      error: { code: -32000, message: 'RESOURCE_EXHAUSTED', data: { code: 'RESOURCE_EXHAUSTED' } },
    })
    expect(await next()).toMatchObject({
      id: 'host:1',
      result: { outcome: 'publisher-failed', output: 'RESOURCE_EXHAUSTED' },
    })
    child.stdin.end()
    expect(await child.exited).toBe(0)
  } finally {
    clearTimeout(timeout)
    child.kill()
    await child.exited
    await reading
  }
}, 10_000)
