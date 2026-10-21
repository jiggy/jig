import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, readlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { MANIFESTS, MARKER, PACKAGES, releaseClosure } from './catalog.mjs'
import {
  alphaVersion,
  dependentNote,
  git,
  pendingChangesets,
  requireRevision,
  sourceDigest,
  sourceEntriesDigest,
  sourceFiles,
  sourceText,
  validateConfiguration,
  validateMarker,
} from './state.mjs'

const maximumBytes = 16 * 1024 * 1024
const projectInit = 'packages/jig/src/project-init.ts'
const reportingNotice = 'packages/display-model/THIRD_PARTY_NOTICES'
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const blobHash = (bytes) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(bytes)}\0`)
    .update(bytes)
    .digest('hex')
const json = (value) => `${JSON.stringify(value, null, 2)}\n`

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join()
  )
}

function identityFromEnvironment() {
  return { runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT }
}

function validateIdentity(identity) {
  if (
    ![identity?.runId, identity?.runAttempt].every(
      (value) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value),
    )
  )
    throw new Error('Prepared releases require a GitHub run ID and attempt')
}

function isManifest(path) {
  return (
    path === 'package.json' ||
    ((path.startsWith('packages/') || path.startsWith('examples/')) &&
      path.endsWith('/package.json'))
  )
}

// This validates data from the read-only job without loading installed
// dependencies or executing artifact code. Only release-derived edits pass.
export async function validatePrepared(root, prepared, identity) {
  validateIdentity(identity)
  if (
    !exactKeys(prepared, [
      'schemaVersion',
      'sourceRevision',
      'runId',
      'runAttempt',
      'workspaceLock',
      'files',
    ]) ||
    prepared.schemaVersion !== 1 ||
    prepared.runId !== identity.runId ||
    prepared.runAttempt !== identity.runAttempt ||
    typeof prepared.workspaceLock !== 'string' ||
    !prepared.workspaceLock.length ||
    !Array.isArray(prepared.files) ||
    !prepared.files.length ||
    Buffer.byteLength(JSON.stringify(prepared)) > maximumBytes
  )
    throw new Error('Malformed prepared release or mismatched run identity')
  requireRevision(prepared.sourceRevision)
  if (prepared.sourceRevision !== git(root, ['rev-parse', 'HEAD']).trim())
    throw new Error(
      'Prepared release source differs from this checkout. Generate it again from main.',
    )
  const base = new Map(
    sourceFiles(root, prepared.sourceRevision).map((entry) => [entry.path, entry]),
  )
  if (base.has('bun.lock')) throw new Error('The prepared workspace lock must remain untracked')
  const files = new Map()
  for (const file of prepared.files) {
    if (
      !exactKeys(file, ['path', 'beforeHash', 'contents']) ||
      typeof file.path !== 'string' ||
      files.has(file.path) ||
      (file.beforeHash !== null && !/^[0-9a-f]{40}$/.test(file.beforeHash)) ||
      (file.contents !== null && typeof file.contents !== 'string') ||
      (file.beforeHash === null && file.contents === null)
    )
      throw new Error('Malformed or duplicate prepared release file')
    files.set(file.path, file)
  }
  const markerText = files.get(MARKER)?.contents
  if (typeof markerText !== 'string')
    throw new Error('Prepared release is missing its generated plan')
  const marker = validateMarker(JSON.parse(markerText))
  if (marker.baseRevision !== prepared.sourceRevision)
    throw new Error('Prepared release plan has a different source')
  await validateConfiguration(root, prepared.sourceRevision)
  const notes = await pendingChangesets(root, prepared.sourceRevision)
  if (
    !isDeepStrictEqual(
      marker.changesets,
      notes.map(({ id, sha256 }) => ({ id, sha256 })),
    ) ||
    !isDeepStrictEqual(
      marker.releases.map(({ name }) => name).sort(),
      releaseClosure(notes.flatMap((note) => note.releases.map(({ name }) => name))),
    )
  )
    throw new Error(
      'Prepared release must consume the exact pending changesets and package closure',
    )

  const versions = new Map()
  for (const { kind, name } of PACKAGES) {
    const manifest = JSON.parse(
      await sourceText(root, `packages/${kind}/package.json`, prepared.sourceRevision),
    )
    const release = marker.releases.find((item) => item.name === name)
    if (
      manifest.name !== name ||
      !alphaVersion.test(manifest.version ?? '') ||
      (release && release.oldVersion !== manifest.version)
    )
      throw new Error('Prepared release versions differ from the source manifests')
    versions.set(name, release?.newVersion ?? manifest.version)
  }
  const consumed = new Map()
  const deleted = new Set()
  for (const { id } of notes) {
    const path = `.changeset/${id}.md`
    deleted.add(path)
    consumed.set(`.changeset/pre/${id}.md`, await sourceText(root, path, prepared.sourceRevision))
  }
  const dependent = dependentNote(notes)
  if (dependent) consumed.set(`.changeset/pre/${dependent.id}.md`, dependent.text)
  const manifests = new Set([...base.keys()].filter(isManifest))
  const expectedManifests = new Map()
  const requiredManifests = new Set()
  for (const path of manifests) {
    const before = JSON.parse(await sourceText(root, path, prepared.sourceRevision))
    const expected = structuredClone(before)
    if (MANIFESTS.includes(path)) expected.version = versions.get(expected.name)
    for (const section of dependencySections) {
      for (const [name, value] of Object.entries(expected[section] ?? {})) {
        if (versions.has(name) && typeof value === 'string' && !value.startsWith('workspace:'))
          expected[section][name] = versions.get(name)
      }
    }
    expectedManifests.set(path, expected)
    if (!isDeepStrictEqual(before, expected)) requiredManifests.add(path)
  }
  let expectedProjectInit
  let requireProjectInit = false
  if (base.has(projectInit)) {
    const before = await sourceText(root, projectInit, prepared.sourceRevision)
    const pattern = /const AGENT_ACP_VERSION = '[^']+'/g
    if ([...before.matchAll(pattern)].length !== 1)
      throw new Error('Generated project ACP version must have one canonical declaration')
    expectedProjectInit = before.replace(
      pattern,
      `const AGENT_ACP_VERSION = '${versions.get('@jigging/agent-acp')}'`,
    )
    requireProjectInit = before !== expectedProjectInit
  }
  let expectedReportingNotice
  let requireReportingNotice = false
  if (base.has(reportingNotice)) {
    const before = await sourceText(root, reportingNotice, prepared.sourceRevision)
    const pattern = /^@jigging\/reporting \S+(?= is an exact external dependency under$)/gm
    if ([...before.matchAll(pattern)].length !== 1)
      throw new Error('Reporting notice must have one canonical dependency version')
    expectedReportingNotice = before.replace(
      pattern,
      `@jigging/reporting ${versions.get('@jigging/reporting')}`,
    )
    requireReportingNotice = before !== expectedReportingNotice
  }
  const changelogs = new Set(
    marker.releases.map(({ name }) => `packages/${name.slice('@jigging/'.length)}/CHANGELOG.md`),
  )
  const allowed = new Set([MARKER, ...manifests, ...changelogs, ...consumed.keys(), ...deleted])
  if (base.has(projectInit)) allowed.add(projectInit)
  if (base.has(reportingNotice)) allowed.add(reportingNotice)
  const resulting = new Map(base)
  for (const [path, file] of files) {
    if (!allowed.has(path)) throw new Error('Prepared release contains a forbidden output path')
    const before = base.get(path)
    if (file.beforeHash !== (before?.hash ?? null) || (before && before.mode !== '100644'))
      throw new Error('Prepared release file has a different base or a non-regular mode')
    if (deleted.has(path)) {
      if (file.contents !== null)
        throw new Error('Prepared release must remove consumed active notes')
      resulting.delete(path)
      continue
    }
    if (typeof file.contents !== 'string')
      throw new Error('Prepared release cannot delete this output')
    if (manifests.has(path)) {
      if (!isDeepStrictEqual(JSON.parse(file.contents), expectedManifests.get(path)))
        throw new Error(
          'Prepared manifest may change only owned versions and existing internal pins',
        )
    } else if (path === projectInit) {
      if (file.contents !== expectedProjectInit)
        throw new Error('Prepared project source may change only the canonical ACP version literal')
    } else if (path === reportingNotice) {
      if (file.contents !== expectedReportingNotice)
        throw new Error(
          'Prepared display-model notice may change only the canonical Reporting version',
        )
    } else if (consumed.has(path) && file.contents !== consumed.get(path)) {
      throw new Error('Prepared consumed note differs from its exact source')
    }
    resulting.set(path, { path, mode: '100644', hash: blobHash(file.contents) })
  }
  for (const path of deleted)
    if (resulting.has(path)) throw new Error('Prepared release leaves an active changeset')
  for (const [path, contents] of consumed)
    if (resulting.get(path)?.hash !== blobHash(contents))
      throw new Error('Prepared release is missing an exact consumed note')
  for (const path of requiredManifests)
    if (!files.has(path)) throw new Error('Prepared release is missing a synchronized manifest')
  if (requireProjectInit && !files.has(projectInit))
    throw new Error('Prepared release is missing the synchronized project ACP version')
  if (requireReportingNotice && !files.has(reportingNotice))
    throw new Error('Prepared release is missing the synchronized Reporting notice')
  if (
    sourceEntriesDigest([...resulting.values()].filter(({ path }) => path !== MARKER)) !==
    marker.sourceDigest
  )
    throw new Error('Prepared release does not match its complete generated source digest')
  return { marker, files: [...files.values()] }
}

export async function createPrepared(root, identity) {
  validateIdentity(identity)
  const sourceRevision = requireRevision(git(root, ['rev-parse', 'HEAD']).trim())
  const base = new Map(sourceFiles(root, sourceRevision).map((entry) => [entry.path, entry]))
  const files = []
  for (const { path } of sourceFiles(root)) {
    const before = base.get(path)
    let stat
    try {
      stat = await lstat(join(root, path))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (before) files.push({ path, beforeHash: before.hash, contents: null })
      continue
    }
    const bytes = stat.isSymbolicLink()
      ? Buffer.from(await readlink(join(root, path)))
      : await readFile(join(root, path))
    const mode = stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644'
    if (before?.hash === blobHash(bytes) && before.mode === mode) continue
    if (!stat.isFile() || mode !== '100644')
      throw new Error('Prepared release outputs must be regular non-executable files')
    files.push({
      path,
      beforeHash: before?.hash ?? null,
      contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    })
  }
  const prepared = {
    schemaVersion: 1,
    sourceRevision,
    runId: identity.runId,
    runAttempt: identity.runAttempt,
    workspaceLock: await readFile(join(root, 'bun.lock'), 'utf8'),
    files,
  }
  await validatePrepared(root, prepared, identity)
  return prepared
}

async function regularDestination(root, path) {
  const parts = path.split('/')
  for (let index = 1; index <= parts.length; index++) {
    try {
      const stat = await lstat(join(root, ...parts.slice(0, index)))
      if (index < parts.length ? !stat.isDirectory() : !stat.isFile() || (stat.mode & 0o111) !== 0)
        throw new Error(
          'Prepared release destination must contain ordinary directories and data files',
        )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

async function validateDestination(root, prepared, identity) {
  if (git(root, ['status', '--porcelain', '--untracked-files=all']).trim())
    throw new Error('Apply prepared releases only to a clean source checkout')
  try {
    await lstat(join(root, 'node_modules'))
    throw new Error('The release writer must not have installed workspace dependencies')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const validated = await validatePrepared(root, prepared, identity)
  for (const { path } of validated.files) await regularDestination(root, path)
  await regularDestination(root, 'bun.lock')
  return validated
}

export async function restoreWorkspaceLock(root, prepared, identity) {
  await validateDestination(root, prepared, identity)
  git(root, ['check-ignore', '--quiet', '--', 'bun.lock'])
  // ManyPkg only needs the actual generated lock as a workspace marker. No
  // package manager runs here, and this ignored data never enters the commit.
  await writeFile(join(root, 'bun.lock'), prepared.workspaceLock, { mode: 0o644 })
}

export async function applyPrepared(root, prepared, identity) {
  const { marker, files } = await validateDestination(root, prepared, identity)
  for (const { path, contents } of files) {
    const target = join(root, path)
    if (contents === null) await unlink(target)
    else {
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents, { mode: 0o644 })
    }
  }
  if ((await sourceDigest(root)) !== marker.sourceDigest)
    throw new Error('Applied release differs from the validated prepared source')
  return marker
}

export async function readPrepared(path) {
  let artifact
  try {
    artifact = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (error.code === 'ELOOP') throw new Error('Invalid prepared release artifact')
    throw error
  }
  try {
    const stat = await artifact.stat()
    if (!stat.isFile() || stat.size > maximumBytes)
      throw new Error('Invalid prepared release artifact')
    const contents = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < contents.length) {
      const { bytesRead } = await artifact.read(contents, length, contents.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length !== stat.size) throw new Error('Prepared release artifact changed while reading')
    return JSON.parse(contents.subarray(0, length).toString('utf8'))
  } finally {
    await artifact.close()
  }
}

async function main() {
  const [command, path, ...extra] = process.argv.slice(2)
  if (!['create', 'restore-lock', 'apply'].includes(command) || !path || extra.length)
    throw new Error('Usage: node scripts/release/prepared.mjs create|restore-lock|apply <file>')
  const root = resolve(import.meta.dirname, '../..')
  const identity = identityFromEnvironment()
  if (command === 'create') {
    await writeFile(path, json(await createPrepared(root, identity)), { flag: 'wx', mode: 0o600 })
    return
  }
  const prepared = await readPrepared(path)
  if (command === 'restore-lock') await restoreWorkspaceLock(root, prepared, identity)
  else await applyPrepared(root, prepared, identity)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
