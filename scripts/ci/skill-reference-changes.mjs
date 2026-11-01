import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const maximumBytes = 16 * 1024 * 1024
const revision = /^[0-9a-f]{40}$/
const git = (root, args, options = {}) =>
  execFileSync('git', ['-C', root, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: maximumBytes,
    ...options,
  })
const text = (root, args, options) => git(root, args, options).toString('utf8').trim()
const exactKeys = (value, keys) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join()

function generatedPath(path) {
  return (
    typeof path === 'string' &&
    /^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/reference\//.test(path) &&
    path.split('/').every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part))
  )
}

function treeFiles(root, source) {
  if (!revision.test(source)) throw new Error('Expected a complete source revision')
  return new Map(
    git(root, ['ls-tree', '-rz', '--full-tree', source])
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const match = /^(\d+) (\w+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry)
        if (!match) throw new Error('Malformed Git tree entry')
        return [match[4], { mode: match[1], type: match[2], hash: match[3] }]
      }),
  )
}

function validateIdentity(identity) {
  if (
    !exactKeys(identity, ['runId', 'runAttempt']) ||
    ![identity.runId, identity.runAttempt].every(
      (value) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value),
    )
  )
    throw new Error('Expected a GitHub run and attempt identity')
}

// The generator stages only its output. This handoff carries data, never code
// for the privileged writer to execute.
export async function prepareSkillChanges({ root, source, identity }) {
  validateIdentity(identity)
  if (text(root, ['rev-parse', 'HEAD']) !== source)
    throw new Error('The generator checkout differs from the PR source')
  const before = treeFiles(root, source)
  const after = treeFiles(root, text(root, ['write-tree']))
  const files = []
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(path)
    const current = after.get(path)
    if (previous?.hash === current?.hash && previous?.mode === current?.mode) continue
    if (
      !generatedPath(path) ||
      [previous, current].some(
        (entry) => entry && (entry.mode !== '100644' || entry.type !== 'blob'),
      )
    )
      throw new Error(`Refusing a change outside regular generated references: ${path}`)
    files.push({
      path,
      before: previous?.hash ?? null,
      content: current ? git(root, ['cat-file', 'blob', current.hash]).toString('base64') : null,
    })
  }
  const prepared = { version: 1, sourceRevision: source, ...identity, files }
  if (Buffer.byteLength(JSON.stringify(prepared)) > maximumBytes)
    throw new Error('Prepared references exceed the transfer bound')
  return prepared
}

export function validateSkillChanges({ root, source, identity, prepared }) {
  validateIdentity(identity)
  if (
    !exactKeys(prepared, ['version', 'sourceRevision', 'runId', 'runAttempt', 'files']) ||
    prepared.version !== 1 ||
    prepared.sourceRevision !== source ||
    prepared.runId !== identity.runId ||
    prepared.runAttempt !== identity.runAttempt ||
    !Array.isArray(prepared.files) ||
    !prepared.files.length ||
    prepared.files.length > 1024 ||
    Buffer.byteLength(JSON.stringify(prepared)) > maximumBytes
  )
    throw new Error('Malformed prepared references or mismatched source/run identity')
  const before = treeFiles(root, source)
  const seen = new Set()
  for (const file of prepared.files) {
    if (
      !exactKeys(file, ['path', 'before', 'content']) ||
      !generatedPath(file.path) ||
      seen.has(file.path) ||
      !(file.before === null || (typeof file.before === 'string' && revision.test(file.before))) ||
      !(file.content === null || typeof file.content === 'string') ||
      (file.before === null && file.content === null)
    )
      throw new Error('Malformed, repeated, or unauthorized generated reference')
    seen.add(file.path)
    const previous = before.get(file.path)
    if (
      (previous?.hash ?? null) !== file.before ||
      (previous && (previous.mode !== '100644' || previous.type !== 'blob'))
    )
      throw new Error('Prepared reference does not match its original file')
    const parts = file.path.split('/')
    for (let index = 1; index < parts.length; index++) {
      if (before.has(parts.slice(0, index).join('/')))
        throw new Error('Generated reference has a non-directory ancestor')
    }
    if (
      file.content !== null &&
      Buffer.from(file.content, 'base64').toString('base64') !== file.content
    )
      throw new Error('Malformed generated reference encoding')
  }
}

export async function skillChangesTree(options) {
  validateSkillChanges(options)
  const { root, source, prepared } = options
  const temporary = await mkdtemp(join(tmpdir(), 'jig-skill-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
  try {
    git(root, ['read-tree', source], { env })
    const entries = prepared.files.map((file) => {
      if (file.content === null) return `0 ${'0'.repeat(40)}\t${file.path}\0`
      const hash = text(root, ['hash-object', '-w', '--stdin'], {
        input: Buffer.from(file.content, 'base64'),
      })
      return `100644 ${hash}\t${file.path}\0`
    })
    git(root, ['update-index', '-z', '--index-info'], { env, input: entries.join('') })
    return text(root, ['write-tree'], { env })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, root, source, path, ...extra] = process.argv.slice(2)
    if (
      !['prepare', 'validate', 'tree'].includes(command) ||
      !root ||
      !source ||
      !path ||
      extra.length
    )
      throw new Error('usage: skill-reference-changes.mjs prepare|validate|tree ROOT SOURCE FILE')
    const identity = {
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    }
    if (command === 'prepare') {
      const prepared = await prepareSkillChanges({ root, source, identity })
      await writeFile(path, JSON.stringify(prepared) + '\n', { flag: 'wx' })
      console.log(prepared.files.length)
    } else {
      const bytes = await readFile(path)
      if (bytes.length > maximumBytes)
        throw new Error('Prepared references exceed the transfer bound')
      const options = { root, source, identity, prepared: JSON.parse(bytes.toString('utf8')) }
      if (command === 'validate') validateSkillChanges(options)
      else console.log(await skillChangesTree(options))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
