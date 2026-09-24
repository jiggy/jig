import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

export type AcceptanceCase = {
  id: string
  args: string[]
  stdin: string
  stdout: string
  stderr: string
  exitCode: number
}

export function checkName(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value))
    throw new TypeError('Select a check set by its lowercase name, such as logs.')
  return value
}

/** Acceptance policy comes from reviewed package bytes, never candidate files. */
export async function loadChecks(
  name: unknown,
  directory = import.meta.dir,
): Promise<AcceptanceCase[]> {
  const filename = `${checkName(name)}-cases.json`
  const file = await open(
    join(directory, filename),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch(() => {
    throw new TypeError(
      `Cannot read ${filename}. Add the check set to the root Flow package and review the application.`,
    )
  })
  let value: unknown
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 256 * 1024)
      throw new TypeError('Check sets must be regular JSON files of at most 256 KiB.')
    const bytes = Buffer.alloc(256 * 1024 + 1)
    let size = 0
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size, null)
      if (!read.bytesRead) break
      size += read.bytesRead
    }
    if (size > 256 * 1024) throw new TypeError('Check set exceeds 256 KiB.')
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)))
  } finally {
    await file.close()
  }
  const text = (v: unknown, limit: number): v is string =>
    typeof v === 'string' &&
    Buffer.byteLength(v) <= limit &&
    Buffer.from(v).toString('utf8') === v &&
    !v.includes('\0')
  if (!Array.isArray(value) || value.length < 1 || value.length > 8)
    throw new TypeError('Supply 1–8 independent CLI acceptance cases.')
  for (const c of value) {
    if (
      !c ||
      typeof c !== 'object' ||
      Object.keys(c).sort().join(',') !== 'args,exitCode,id,stderr,stdin,stdout' ||
      !text(c.id, 64) ||
      !Array.isArray(c.args) ||
      c.args.length > 8 ||
      !c.args.every((a: unknown) => text(a, 1024)) ||
      !text(c.stdin, 8192) ||
      !text(c.stdout, 8192) ||
      !text(c.stderr, 8192) ||
      !Number.isInteger(c.exitCode) ||
      c.exitCode < 0 ||
      c.exitCode > 255
    )
      throw new TypeError(`Invalid acceptance case in ${filename}.`)
  }
  if (new Set(value.map((c) => c.id)).size !== value.length)
    throw new TypeError('Duplicate acceptance case.')
  return value
}
