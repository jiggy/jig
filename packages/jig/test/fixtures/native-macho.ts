/** Inert Mach-O metadata. These bytes are never execution evidence. */
export function nativeMachO(
  options: {
    readonly library?: string
    readonly needed?: readonly string[]
    readonly weak?: readonly string[]
    readonly search?: readonly string[]
    readonly commands?: readonly Buffer[]
  } = {},
): Buffer {
  const commands: Buffer[] = []
  function string(command: number, value: string, minimum: number) {
    const bytes = Buffer.alloc(Math.ceil((minimum + Buffer.byteLength(value) + 1) / 8) * 8)
    bytes.writeUInt32LE(command)
    bytes.writeUInt32LE(bytes.length, 4)
    bytes.writeUInt32LE(minimum, 8)
    bytes.write(value, minimum)
    commands.push(bytes)
  }
  if (options.library === undefined) string(0xe, '/usr/lib/dyld', 12)
  else string(0xd, options.library, 24)
  for (const value of options.needed ?? []) string(0xc, value, 24)
  for (const value of options.weak ?? []) string(0x80000018, value, 24)
  for (const value of options.search ?? []) string(0x8000001c, value, 12)
  const platform = Buffer.alloc(24)
  platform.writeUInt32LE(0x32)
  platform.writeUInt32LE(24, 4)
  platform.writeUInt32LE(1, 8)
  platform.writeUInt32LE(0x000d0000, 12)
  commands.push(platform, ...(options.commands ?? []))
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf)
  header.writeUInt32LE(0x01000007, 4)
  header.writeUInt32LE(3, 8)
  header.writeUInt32LE(options.library === undefined ? 2 : 6, 12)
  header.writeUInt32LE(commands.length, 16)
  header.writeUInt32LE(
    commands.reduce((n, bytes) => n + bytes.length, 0),
    20,
  )
  return Buffer.concat([header, ...commands])
}

export function universalMachO(slice: Buffer, wide = false, little = false): Buffer {
  const bytes = Buffer.alloc(4096 + slice.length)
  const u32 = (value: number, offset: number) =>
    little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset)
  const u64 = (value: number, offset: number) =>
    little
      ? bytes.writeBigUInt64LE(BigInt(value), offset)
      : bytes.writeBigUInt64BE(BigInt(value), offset)
  u32(wide ? 0xcafebabf : 0xcafebabe, 0)
  u32(1, 4)
  u32(0x01000007, 8)
  u32(3, 12)
  if (wide) {
    u64(4096, 16)
    u64(slice.length, 24)
    u32(12, 32)
  } else {
    u32(4096, 16)
    u32(slice.length, 20)
    u32(12, 24)
  }
  slice.copy(bytes, 4096)
  return bytes
}
