import { handle } from '@jigging/flow'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

await handle(async (run) => {
  const input = run.input as {
    files?: { path: string; content: string }[]
    entry?: string
    exportName?: string
    calls?: unknown[][]
  }
  if (
    !input ||
    !Array.isArray(input.files) ||
    input.files.length < 1 ||
    input.files.length > 16 ||
    typeof input.entry !== 'string' ||
    typeof input.exportName !== 'string' ||
    !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(input.exportName) ||
    !Array.isArray(input.calls) ||
    input.calls.length > 32
  ) {
    throw new TypeError('Expected bounded source, entry, export, and argument arrays.')
  }
  const paths = new Set<string>()
  let bytes = 0
  for (const file of input.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(file.path) ||
      paths.has(file.path) ||
      typeof file.content !== 'string'
    )
      throw new TypeError('Invalid source path/content.')
    paths.add(file.path)
    bytes += Buffer.byteLength(file.content)
  }
  if (bytes > 65536 || !paths.has(input.entry) || !input.calls.every(Array.isArray))
    throw new TypeError('Invalid source or calls.')
  const directory = await mkdtemp(join(run.scratch, 'candidate-'))
  for (const { path, content } of input.files) {
    const target = join(directory, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { flag: 'wx' })
  }
  const module = await import(pathToFileURL(join(directory, input.entry)).href)
  const callable = module[input.exportName]
  if (typeof callable !== 'function')
    throw new TypeError('The candidate omitted its exported function.')
  const values = input.calls.map((args) => {
    let value
    try {
      value = callable(...args)
    } catch (error) {
      return { threw: error instanceof Error ? error.name : 'NonError' }
    }
    if (value instanceof Promise || value === undefined)
      throw new TypeError('Expected synchronous JSON results.')
    return { returned: value }
  })
  // The SDK validates JSON; the caller independently checks every observation.
  return { outcome: 'done', output: { values } }
})
