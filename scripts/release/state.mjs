import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { MARKER, PACKAGE_NAMES, PUBLISHED_PACKAGES, releaseClosure } from './catalog.mjs'

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const alphaVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/
const revisionPattern = /^[0-9a-f]{40}$/
const digestPattern = /^[0-9a-f]{64}$/
const activeNote = /^\.changeset\/([A-Za-z0-9][A-Za-z0-9_-]*)\.md$/
const guidanceNote = /^(?:AGENTS|CLAUDE|GEMINI)\.md$/i

export function git(root, args, options = {}) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    ...options,
  })
}

export function requireRevision(revision) {
  if (!revisionPattern.test(revision ?? ''))
    throw new Error('Release source must be a full Git revision')
  return revision
}

export function sourceFiles(root, revision) {
  if (revision) {
    requireRevision(revision)
    return git(root, ['ls-tree', '-rz', '--full-tree', revision])
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const match = /^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(entry)
        if (!match) throw new Error('Release sources must contain ordinary Git blobs')
        return { mode: match[1], hash: match[2], path: match[3] }
      })
  }
  return [
    ...new Set(
      git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean),
    ),
  ].map((path) => ({ path }))
}

export async function sourceText(root, path, revision, optional = false) {
  if (revision) {
    requireRevision(revision)
    if (optional && !sourceFiles(root, revision).some((entry) => entry.path === path))
      return undefined
    return git(root, ['show', `${revision}:${path}`])
  }
  try {
    return await readFile(join(root, path), 'utf8')
  } catch (error) {
    if (optional && error.code === 'ENOENT') return undefined
    throw error
  }
}

export function sourceEntriesDigest(entries) {
  return sha256(
    [...entries]
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
      .map(({ mode, hash, path }) => `${mode} ${hash}\t${path}\0`)
      .join(''),
  )
}

export async function sourceDigest(root, revision) {
  const entries = []
  for (const entry of sourceFiles(root, revision)) {
    if (entry.path === MARKER) continue
    if (revision) {
      entries.push(entry)
      continue
    }
    let stat
    try {
      stat = await lstat(join(root, entry.path))
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!stat.isFile() && !stat.isSymbolicLink())
      throw new Error(`Unsupported release source: ${entry.path}`)
    const bytes = stat.isSymbolicLink()
      ? Buffer.from(await readlink(join(root, entry.path)))
      : await readFile(join(root, entry.path))
    entries.push({
      path: entry.path,
      mode: stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644',
      hash: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
    })
  }
  return sourceEntriesDigest(entries)
}

export function dependentNote(notes) {
  const direct = new Set(notes.flatMap((note) => note.releases.map(({ name }) => name)))
  const indirect = releaseClosure(direct).filter((name) => !direct.has(name))
  if (!indirect.length) return undefined
  const id = `release-dependents-${sha256(JSON.stringify(notes.map(({ id, sha256 }) => ({ id, sha256 })))).slice(0, 16)}`
  return {
    id,
    text: `---\n${indirect.map((name) => `${JSON.stringify(name)}: patch`).join('\n')}\n---\n\nRebuild packages that include changed workspace inputs.\n`,
  }
}

export function parseChangeset(text, id) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)$/.exec(text.replace(/\r\n/g, '\n'))
  if (!match?.[2].trim())
    throw new Error(`Changeset ${id} needs package frontmatter and a release summary`)
  const releases = []
  const seen = new Set()
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue
    const row =
      /^\s*(?:"(@jigging\/[a-z-]+)"|'(@jigging\/[a-z-]+)'|(@jigging\/[a-z-]+)):\s*(patch|minor|major)\s*$/.exec(
        line,
      )
    const name = row?.[1] ?? row?.[2] ?? row?.[3]
    if (!row || !PACKAGE_NAMES.has(name) || seen.has(name))
      throw new Error(
        `Changeset ${id} must name each owned npm package once with patch, minor, or major`,
      )
    seen.add(name)
    releases.push({ name, type: row[4] })
  }
  if (!releases.length) throw new Error(`Changeset ${id} does not release a package`)
  return { id, releases, sha256: sha256(text) }
}

export async function pendingChangesets(root, revision) {
  const notes = []
  for (const { path } of sourceFiles(root, revision)) {
    if (!path.startsWith('.changeset/')) continue
    const filename = path.slice('.changeset/'.length)
    if (guidanceNote.test(filename))
      throw new Error(
        `Guidance file .changeset/${filename} is not a release note. Move its instructions outside .changeset/.`,
      )
    if (
      filename.includes('/') ||
      filename.startsWith('.') ||
      !filename.endsWith('.md') ||
      /^README\.md$/i.test(filename)
    )
      continue
    const match = activeNote.exec(path)
    if (!match)
      throw new Error(
        `Unsupported changeset filename: ${filename}. Use letters, digits, hyphens, or underscores before .md.`,
      )
    const text = await sourceText(root, path, revision, true)
    if (text !== undefined) notes.push(parseChangeset(text, match[1]))
  }
  return notes.sort((a, b) => a.id.localeCompare(b.id, 'en'))
}

export async function validateConfiguration(root, revision) {
  const config = JSON.parse(await sourceText(root, '.changeset/config.json', revision))
  const pre = JSON.parse(await sourceText(root, '.changeset/pre.json', revision))
  if (
    ['fixed', 'linked', 'ignore'].some(
      (key) => !Array.isArray(config[key]) || config[key].length,
    ) ||
    config.commit !== false ||
    config.access !== 'public' ||
    config.privatePackages?.version !== false ||
    config.privatePackages?.tag !== false ||
    pre.mode !== 'pre' ||
    pre.tag !== 'alpha' ||
    Object.keys(pre).length !== 2
  )
    throw new Error(
      'Jig requires independent alpha Changesets with private packages and automatic commits disabled',
    )
}

export function validateMarker(marker) {
  const keys = ['schemaVersion', 'baseRevision', 'sourceDigest', 'changesets', 'releases']
  if (
    !marker ||
    Object.keys(marker).sort().join() !== keys.sort().join() ||
    marker.schemaVersion !== 1 ||
    !revisionPattern.test(marker.baseRevision ?? '') ||
    !digestPattern.test(marker.sourceDigest ?? '') ||
    !Array.isArray(marker.changesets) ||
    !marker.changesets.length ||
    !Array.isArray(marker.releases) ||
    !marker.releases.length
  )
    throw new Error('Malformed generated release plan')
  const noteIds = new Set()
  for (const note of marker.changesets) {
    if (
      !note ||
      Object.keys(note).sort().join() !== 'id,sha256' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(note.id ?? '') ||
      noteIds.has(note.id) ||
      !digestPattern.test(note.sha256 ?? '')
    )
      throw new Error('Malformed generated changeset identity')
    noteIds.add(note.id)
  }
  const names = new Set()
  for (const item of marker.releases) {
    if (
      !item ||
      Object.keys(item).sort().join() !== 'name,newVersion,oldVersion,type' ||
      !PACKAGE_NAMES.has(item.name) ||
      names.has(item.name) ||
      !['patch', 'minor', 'major'].includes(item.type) ||
      !alphaVersion.test(item.oldVersion ?? '') ||
      !alphaVersion.test(item.newVersion ?? '') ||
      item.oldVersion === item.newVersion
    )
      throw new Error('Malformed generated package version')
    names.add(item.name)
  }
  return marker
}

export async function releaseState(root, sourceRevision) {
  requireRevision(sourceRevision)
  const packages = []
  for (const { kind, name } of PUBLISHED_PACKAGES) {
    const manifest = JSON.parse(
      await sourceText(root, `packages/${kind}/package.json`, sourceRevision),
    )
    if (manifest.name !== name || !alphaVersion.test(manifest.version ?? ''))
      throw new Error(`Invalid release manifest: ${name}`)
    packages.push({ kind, name, version: manifest.version })
  }
  const pending = await pendingChangesets(root, sourceRevision)
  const rawMarker = await sourceText(root, MARKER, sourceRevision, true)
  const marker = rawMarker === undefined ? undefined : validateMarker(JSON.parse(rawMarker))
  const result = {
    schemaVersion: 1,
    sourceRevision,
    eligible: false,
    reason: pending.length ? 'pending-changesets' : 'feature-source',
    packages,
    pendingPackages: releaseClosure(
      pending.flatMap((note) => note.releases.map(({ name }) => name)),
    ),
  }
  if (pending.length || marker) await validateConfiguration(root, sourceRevision)
  if (pending.length || !marker) return result
  if (marker.sourceDigest !== (await sourceDigest(root, sourceRevision)))
    return { ...result, reason: 'stale-release-plan' }
  git(root, ['merge-base', '--is-ancestor', marker.baseRevision, sourceRevision])
  const original = await pendingChangesets(root, marker.baseRevision)
  if (
    JSON.stringify(marker.changesets) !==
    JSON.stringify(original.map(({ id, sha256 }) => ({ id, sha256 })))
  )
    throw new Error('Generated release plan does not consume its exact base changesets')
  const expected = releaseClosure(original.flatMap((note) => note.releases.map(({ name }) => name)))
  if (
    JSON.stringify([...marker.releases.map(({ name }) => name)].sort()) !== JSON.stringify(expected)
  )
    throw new Error('Generated release plan omits an affected package')
  for (const item of marker.releases) {
    const path = `packages/${item.name.slice('@jigging/'.length)}/package.json`
    const before = JSON.parse(await sourceText(root, path, marker.baseRevision))
    const after = JSON.parse(await sourceText(root, path, sourceRevision))
    if (before.version !== item.oldVersion || after.version !== item.newVersion)
      throw new Error('Generated release versions differ from their source manifests')
  }
  for (const note of original) {
    const consumed = await sourceText(root, `.changeset/pre/${note.id}.md`, sourceRevision)
    if (sha256(consumed) !== note.sha256) throw new Error('Consumed release note changed')
  }
  return {
    ...result,
    eligible: true,
    reason: 'versioned-release',
    releasePlanSha256: sha256(rawMarker),
  }
}
