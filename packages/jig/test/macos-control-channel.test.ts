import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  privateMacosBefore,
  privateMacosControlChannel,
} from '../src/internal/macos-control-channel.js'

async function pair(
  run: (sender: Socket, reader: ReturnType<typeof privateMacosControlChannel>) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'jig-control-'))
  const path = join(directory, 'c')
  const server = createServer()
  const peers: Socket[] = []
  try {
    const accepted = new Promise<Socket>((resolve) =>
      server.once('connection', (socket) => {
        peers.push(socket)
        resolve(socket)
      }),
    )
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, resolve)
    })
    const sender = connect(path)
    sender.on('error', () => undefined)
    peers.push(sender)
    const reader = privateMacosControlChannel(await accepted)
    await privateMacosBefore(run(sender, reader), 2000)
  } finally {
    for (const socket of peers) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

test('private guardian framing preserves fragmented UTF-8 and queued terminal frames through EOF', async () => {
  await pair(async (sender, reader) => {
    const bytes = Buffer.from('{"type":"prepared","text":"é"}\n{"type":"terminal"}\n')
    sender.write(bytes.subarray(0, 29))
    sender.end(bytes.subarray(29))
    await Bun.sleep(20)
    expect(await reader.receive()).toEqual({ type: 'prepared', text: 'é' })
    expect(await reader.receive()).toEqual({ type: 'terminal' })
    await expect(reader.receive()).rejects.toThrow('ended')
    expect(() => reader.send({ type: 'admit' })).toThrow('unavailable')
  })
})

test('private guardian framing rejects malformed, oversized, truncated and excessive queued messages', async () => {
  for (const input of [
    Buffer.from([0xff, 10]),
    Buffer.alloc(65537, 32),
    Buffer.from('{"type":'),
    Buffer.from('{}\n'.repeat(9)),
  ]) {
    await pair(async (sender, reader) => {
      sender.end(input)
      await Bun.sleep(20)
      await expect(reader.receive()).rejects.toThrow('lost or malformed')
    })
  }
})
