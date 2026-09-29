import type { Socket } from 'node:net'

/** Bounded private framing. Payload bytes travel on separate streams. */
export function privateMacosControlChannel(socket: Socket) {
  const messages: unknown[] = []
  let buffer = Buffer.alloc(0)
  let ended = false
  let failure: Error | undefined
  let pending: { resolve(value: unknown): void; reject(error: Error): void } | undefined
  const fail = () => {
    failure ??= new Error('macOS control channel lost or malformed')
    ended = true
    messages.length = 0
    pending?.reject(failure)
    pending = undefined
    socket.destroy()
  }
  const end = () => {
    if (buffer.length !== 0) return fail()
    ended = true
    failure ??= new Error('macOS control channel ended')
    pending?.reject(failure)
    pending = undefined
  }
  socket.on('data', (data: Buffer) => {
    try {
      if (ended || buffer.length + data.length > 65536) return fail()
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        const newline = buffer.indexOf(10)
        if (newline < 0) break
        const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, newline))
        buffer = buffer.subarray(newline + 1)
        const message = JSON.parse(text) as unknown
        if (messages.length >= 8) return fail()
        if (pending !== undefined) {
          const waiter = pending
          pending = undefined
          waiter.resolve(message)
        } else messages.push(message)
      }
    } catch {
      fail()
    }
  })
  socket.on('error', fail)
  socket.on('end', end)
  socket.on('close', end)
  return Object.freeze({
    receive(): Promise<unknown> {
      if (messages.length) return Promise.resolve(messages.shift())
      if (failure !== undefined) return Promise.reject(failure)
      if (pending !== undefined)
        return Promise.reject(new Error('concurrent macOS control readers'))
      return new Promise((resolve, reject) => {
        pending = { resolve, reject }
      })
    },
    send(value: unknown): void {
      const bytes = Buffer.from(`${JSON.stringify(value)}\n`)
      if (ended || bytes.length > 65536 || socket.writableLength + bytes.length > 65536)
        throw new Error('macOS control delivery unavailable')
      socket.write(bytes)
    },
    close: () => socket.destroy(),
  })
}

export async function privateMacosBefore<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('macOS control deadline expired')),
          Math.max(1, milliseconds),
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
