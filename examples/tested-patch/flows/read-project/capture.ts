import { constants } from 'node:fs'
import { open, opendir } from 'node:fs/promises'
import { join } from 'node:path'
import { type AcceptanceCase, loadChecks } from './checks.ts'

function validText(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) <= limit &&
    Buffer.from(value).toString('utf8') === value &&
    !value.includes('\0')
  )
}
export async function readProject(
  value: unknown,
  source: string,
  selectedCases?: AcceptanceCase[],
) {
  const request = value as { issue: string; editPaths: string[]; checks?: string }
  if (
    !request ||
    Object.keys(request).some((field) => !['editPaths', 'issue', 'checks'].includes(field)) ||
    !validText(request.issue, 8000) ||
    !request.issue.trim() ||
    !Array.isArray(request.editPaths) ||
    request.editPaths.length < 1 ||
    request.editPaths.length > 8 ||
    new Set(request.editPaths).size !== request.editPaths.length
  )
    throw new TypeError('Supply an issue and selected editPaths.')
  const cases =
    selectedCases ?? (await loadChecks(request.checks === undefined ? 'logs' : request.checks))
  const files: Record<string, string> = Object.create(null)
  let remainingBytes = 65536
  let entryCount = 0
  const walk = async (relative: string) => {
    const directory = await opendir(join(source, relative))
    for await (const entry of directory) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (
        ++entryCount > 64 ||
        !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(path) ||
        path.split('/').length > 16 ||
        ['node_modules', '.git', '.jig'].includes(entry.name) ||
        entry.isSymbolicLink()
      )
        throw new TypeError('Unsupported source path or tree size.')
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (Object.keys(files).length >= 16) throw new TypeError('Expected at most 16 text files.')
      const file = await open(
        join(source, path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > remainingBytes)
          throw new TypeError('Expected regular text files totaling at most 64 KiB.')
        const buffer = await file.readFile()
        const used = buffer.byteLength
        if (used > remainingBytes) throw new TypeError('Source exceeds 64 KiB.')
        if (used !== info.size)
          throw new TypeError('Source changed or could not be read completely.')
        remainingBytes -= used
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          buffer.subarray(0, used),
        )
        if (!validText(content, 65536)) throw new TypeError('Expected Unicode source without NUL.')
        files[path] = content
      } finally {
        await file.close()
      }
    }
  }
  await walk('')
  if (!Object.values(files).some((content) => content.length > 0))
    throw new TypeError('Expected source files with captured content.')
  if (
    request.editPaths.some(
      (path) =>
        typeof path !== 'string' ||
        !path.startsWith('src/') ||
        !/\.(ts|js)$/.test(path) ||
        !Object.hasOwn(files, path),
    )
  )
    throw new TypeError('Select existing TypeScript or JavaScript source files below src/.')
  return { issue: request.issue, editPaths: request.editPaths, files, cases }
}
