import { constants } from 'node:fs'
import { type FileHandle, mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import { invalid, unavailable } from '../diagnostics.js'
import { decodeJson1 } from '../json.js'
import { parseInvocationContract } from '../invocation-contract.js'
import type { PrepareCapturedFlow } from '../project/flow-source.js'
import type { PrivateProjectRoot } from '../project/root.js'
import { assertPrivateAgentResponseSchema } from './openai-agent-client.js'
import { generateContract, type GeneratedContract } from './contract-authoring-client.js'

const SOURCE = 'FLOW.contract.tsp'
const DESCRIPTOR = 'FLOW.contract.json'
const MAX_RECORD = 4 * 1024 * 1024
type Files = Record<string, string | null>
interface Generation {
  source: string
  outputs: Record<string, string>
}
interface Journal {
  before: Files
  after: Files
  next: Generation | null
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const pathOf = (directory: FileHandle, name: string) => `/proc/self/fd/${directory.fd}/${name}`
const conflict = (name: string): never =>
  invalid(
    'AUTHORING_CONFLICT',
    'Generated files or source changed. Preserve edits and resolve ownership before generation.',
    name,
  )

async function read(
  directory: FileHandle,
  name: string,
  limit = MAX_RECORD,
): Promise<string | null> {
  let file: FileHandle
  try {
    file = await open(
      pathOf(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return conflict(name)
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) conflict(name)
    const bytes = await file.readFile()
    if (bytes.length > limit) conflict(name)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    await file.close()
  }
}

async function directory(
  parent: FileHandle,
  name: string,
  create: boolean,
): Promise<FileHandle | undefined> {
  if (create)
    await mkdir(pathOf(parent, name), { mode: 0o700 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
  try {
    return await open(
      pathOf(parent, name),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return conflict(name)
  }
}

async function write(directory: FileHandle, name: string, value: string): Promise<void> {
  const temporary = `.write-${randomUUID()}`
  const file = await open(
    pathOf(directory, temporary),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await file.writeFile(value)
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await rename(pathOf(directory, temporary), pathOf(directory, name))
    await directory.sync()
  } finally {
    await unlink(pathOf(directory, temporary)).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

function names(files: Files): void {
  if (Object.keys(files).length > 66) conflict('generation state')
  for (const [name, value] of Object.entries(files)) {
    if (
      name !== SOURCE &&
      name !== DESCRIPTOR &&
      name !== 'FLOW.contract.d.ts' &&
      !/^[a-z][a-z0-9-]*\.schema\.json$(?![\s\S])/.test(name)
    )
      conflict(name)
    if (value !== null && (typeof value !== 'string' || Buffer.byteLength(value) > 262144))
      conflict(name)
  }
}

function decode<T>(text: string): T {
  return decodeJson1(Buffer.from(text)) as unknown as T
}

function state(text: string | null): Generation | null {
  if (text === null) return null
  const value = decode<Generation | null>(text)
  if (value === null) return null
  if (typeof value.source !== 'string' || !value.outputs || Array.isArray(value.outputs))
    conflict('generation state')
  names(value.outputs)
  if (Object.values(value.outputs).some((v) => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)))
    conflict('generation state')
  return value
}

/** Called only beneath the project's exclusive session; never from Run or generic inspection. */
export function prepareContractGeneration(options: {
  project: PrivateProjectRoot
  generate: boolean
  signal: AbortSignal
  verify: () => Promise<void>
  report?: (path: string, files: readonly string[]) => void
  compile?: (source: string, signal: AbortSignal) => Promise<GeneratedContract>
  afterPublish?: (name: string) => Promise<void>
}): PrepareCapturedFlow {
  const refreshed = new Set<string>()
  let compilations = 0
  return async (packageDirectory, provenance, captured) => {
    options.signal.throwIfAborted()
    const sourceFile = captured.files.find((f) => f.path === SOURCE)
    const source = sourceFile
      ? new TextDecoder('utf-8', { fatal: true }).decode(await captured.read(SOURCE, 65536))
      : null
    const jig = await directory(options.project.handle, '.jig', false)
    if (!jig) unavailable('AUTHORING_STATE', 'The project state is unavailable.')
    const handles = [jig]
    try {
      const root = await directory(jig, 'authoring', options.generate && source !== null)
      if (!root) {
        if (source !== null && !captured.files.some((f) => f.path === DESCRIPTOR))
          unavailable(
            'AUTHORING_STALE',
            'Generate the source-only contract with jig review --generate-contracts.',
            SOURCE,
          )
        return false
      }
      handles.push(root)
      const maybeRecord = await directory(
        root,
        hash(provenance.projectPath),
        options.generate && source !== null,
      )
      if (!maybeRecord) {
        if (source !== null && !captured.files.some((f) => f.path === DESCRIPTOR))
          unavailable(
            'AUTHORING_STALE',
            'Generate the source-only contract with jig review --generate-contracts.',
            SOURCE,
          )
        return false
      }
      const record = maybeRecord
      handles.push(record)
      const current = async (name: string) => read(packageDirectory, name, 262144)
      const previous = state(await read(record, 'current.json'))
      const pending = await read(record, 'pending.json')
      if (pending !== null) {
        if (!options.generate)
          unavailable(
            'AUTHORING_INTERRUPTED',
            'Complete the recorded generation with jig review --generate-contracts; no revision was admitted.',
            SOURCE,
          )
        const journal = decode<Journal>(pending)
        names(journal.before)
        names(journal.after)
        state(JSON.stringify(journal.next))
        if (
          Object.keys(journal.before).sort().join('\0') !==
          Object.keys(journal.after).sort().join('\0')
        )
          conflict('generation journal')
        await publish(journal, true)
        return true
      }
      if (previous) {
        for (const [name, digest] of Object.entries(previous.outputs)) {
          const content = await current(name)
          if (content === null || hash(content) !== digest) conflict(name)
          const retained = captured.files.some((f) => f.path === name)
            ? new TextDecoder('utf-8', { fatal: true }).decode(await captured.read(name, 262144))
            : null
          if (retained !== content) conflict(name)
        }
        if (
          previous.source === source &&
          (!options.generate || refreshed.has(provenance.projectPath))
        )
          return false
        if (!options.generate)
          unavailable(
            'AUTHORING_STALE',
            'Authored contract changed; regenerate with jig review --generate-contracts.',
            SOURCE,
          )
      } else if (source === null || !options.generate) {
        if (source !== null && !captured.files.some((f) => f.path === DESCRIPTOR))
          unavailable(
            'AUTHORING_STALE',
            'Generate the source-only contract with jig review --generate-contracts.',
            SOURCE,
          )
        return false
      }

      options.signal.throwIfAborted()
      if (++compilations > 32)
        unavailable('AUTHORING_LIMIT', 'A review can generate at most 32 contracts.')
      const generated =
        source === null ? null : await (options.compile ?? generateContract)(source, options.signal)
      const after: Files = Object.create(null)
      if (generated) {
        if (
          typeof generated.source !== 'string' ||
          !generated.artifacts ||
          Array.isArray(generated.artifacts)
        )
          conflict('compiler output')
        names(generated.artifacts)
        if (SOURCE in generated.artifacts || typeof generated.artifacts[DESCRIPTOR] !== 'string')
          conflict('compiler output')
        parseInvocationContract(Buffer.from(generated.artifacts[DESCRIPTOR]!), DESCRIPTOR)
        for (const [name, content] of Object.entries(generated.artifacts)) {
          if (name !== DESCRIPTOR && name !== 'FLOW.contract.d.ts')
            assertPrivateAgentResponseSchema(decode(content))
          after[name] = content
        }
        after[SOURCE] = generated.source
      } else {
        // Explicit source removal relinquishes the unchanged outputs to manual JSON authoring.
        after[SOURCE] = null
      }
      if (generated)
        for (const name of Object.keys(previous?.outputs ?? {}))
          if (!(name in after)) after[name] = null
      names(after)
      const before: Files = Object.create(null)
      for (const name of Object.keys(after)) {
        before[name] = await current(name)
        if (name === SOURCE) {
          if (before[name] !== source) conflict(name)
        } else if (previous?.outputs[name]) {
          if (before[name] === null || hash(before[name]!) !== previous.outputs[name])
            conflict(name)
        } else if (before[name] !== null && before[name] !== after[name]) conflict(name)
      }
      const next: Generation | null = generated
        ? {
            source: generated.source,
            outputs: Object.fromEntries(
              Object.entries(generated.artifacts).map(([name, text]) => [name, hash(text)]),
            ),
          }
        : null
      const journal: Journal = { before, after, next }
      refreshed.add(provenance.projectPath)
      if (
        previous &&
        JSON.stringify(previous) === JSON.stringify(next) &&
        Object.keys(after).every((name) => before[name] === after[name])
      )
        return false
      const encoded = JSON.stringify(journal)
      if (Buffer.byteLength(encoded) > MAX_RECORD) conflict('generation size')
      options.signal.throwIfAborted()
      await options.verify()
      // Full previous source and outputs stay recoverable, outside the portable package.
      await write(record, 'previous.json', JSON.stringify({ previous, before }))
      await write(record, 'pending.json', encoded)
      await publish(journal, false)
      return true

      async function publish(journal: Journal, recovering: boolean): Promise<void> {
        // Validate the WHOLE batch before modifying a member. Never overwrite a third value.
        for (const name of Object.keys(journal.after)) {
          const observed = await current(name)
          if (
            observed !== journal.before[name] &&
            (!recovering || observed !== journal.after[name])
          )
            conflict(name)
        }
        options.report?.(provenance.projectPath, Object.keys(journal.after))
        for (const [name, content] of Object.entries(journal.after)) {
          options.signal.throwIfAborted()
          await options.verify()
          const observed = await current(name)
          if (observed === content) continue
          if (observed !== journal.before[name]) conflict(name)
          if (content === null) await unlink(pathOf(packageDirectory, name))
          else {
            await write(record, 'staged', content)
            await rename(pathOf(record, 'staged'), pathOf(packageDirectory, name))
          }
          await packageDirectory.sync()
          await options.afterPublish?.(name)
        }
        options.signal.throwIfAborted()
        await options.verify()
        for (const [name, content] of Object.entries(journal.after))
          if ((await current(name)) !== content) conflict(name)
        await write(record, 'current.json', JSON.stringify(journal.next))
        await unlink(pathOf(record, 'pending.json'))
        await record.sync()
      }
    } finally {
      for (const handle of handles.reverse()) await handle.close()
    }
  }
}
