/** Inert ELF metadata fixture; never used as execution evidence. */
export function nativeElf(
  options: {
    readonly needed?: readonly string[]
    readonly search?: string
    readonly interpreter?: string
    readonly wrapper?: string
  } = {},
): Buffer {
  const strings = [Buffer.from([0])]
  const entries: [number, number][] = []
  let length = 1
  function add(tag: number, value: string): void {
    entries.push([tag, length])
    const bytes = Buffer.from(`${value}\0`)
    strings.push(bytes)
    length += bytes.length
  }
  for (const name of options.needed ?? []) add(1, name)
  if (options.search !== undefined) add(29, options.search)
  const dynamicOffset = 256
  const stringOffset = dynamicOffset + (entries.length + 3) * 16
  entries.push([5, stringOffset], [10, length], [0, 0])
  const interpreter = Buffer.from(`${options.interpreter ?? ''}\0`)
  const interpreterOffset = stringOffset + length
  const bytes = Buffer.alloc(
    interpreterOffset + interpreter.length + Buffer.byteLength(options.wrapper ?? '') + 1,
  )
  Buffer.from([127, 69, 76, 70, 2, 1, 1]).copy(bytes)
  bytes.writeUInt16LE(3, 16)
  bytes.writeUInt16LE(62, 18)
  bytes.writeUInt32LE(1, 20)
  bytes.writeBigUInt64LE(64n, 32)
  bytes.writeUInt16LE(64, 52)
  bytes.writeUInt16LE(56, 54)
  bytes.writeUInt16LE(options.interpreter === undefined ? 2 : 3, 56)
  function segment(index: number, type: number, offset: number, size: number): void {
    const start = 64 + index * 56
    bytes.writeUInt32LE(type, start)
    bytes.writeBigUInt64LE(BigInt(offset), start + 8)
    bytes.writeBigUInt64LE(BigInt(offset), start + 16)
    bytes.writeBigUInt64LE(BigInt(size), start + 32)
    bytes.writeBigUInt64LE(BigInt(size), start + 40)
  }
  segment(0, 1, 0, bytes.length)
  segment(1, 2, dynamicOffset, entries.length * 16)
  if (options.interpreter !== undefined) segment(2, 3, interpreterOffset, interpreter.length)
  for (const [index, [tag, value]] of entries.entries()) {
    bytes.writeBigUInt64LE(BigInt(tag), dynamicOffset + index * 16)
    bytes.writeBigUInt64LE(BigInt(value), dynamicOffset + index * 16 + 8)
  }
  Buffer.concat(strings).copy(bytes, stringOffset)
  interpreter.copy(bytes, interpreterOffset)
  bytes.write(options.wrapper ?? '', interpreterOffset + interpreter.length)
  return bytes
}
