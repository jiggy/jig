import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'

const repositoryURL = 'https://github.com/jiggy/jig'
const docsPrefix = 'docs/jig/'
const manifestPath = 'skills/references.json'
const notices = [
  'LICENSES.md',
  'LICENSE.md',
  'PRICING.md',
  'LICENSES/Apache-2.0.txt',
  'LICENSES/CC-BY-4.0.txt',
  'LICENSES/MPL-2.0.txt',
]
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const posix = (path) => path.split(sep).join('/')
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/')

function safePath(path) {
  return (
    typeof path === 'string' &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    path.split('/').every((part) => part && !part.startsWith('.'))
  )
}

async function sourceStat(root, path) {
  if (!safePath(path) || path.split('/').includes('AGENTS.md'))
    throw new Error(`Invalid public source path: ${path}`)
  let current = root
  let stat
  for (const part of path.split('/')) {
    current = join(current, part)
    try {
      stat = await lstat(current)
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Missing source: ${path}`)
      throw error
    }
    if (stat.isSymbolicLink()) throw new Error(`Source cannot be a symbolic link: ${path}`)
  }
  return stat
}

async function sourceBytes(root, path) {
  if (!(await sourceStat(root, path)).isFile())
    throw new Error(`Source must be a regular file: ${path}`)
  return readFile(join(root, path))
}

function decodeText(bytes, source) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`Source must contain UTF-8 text: ${source}`)
  }
}

function validateManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !manifest.skills ||
    typeof manifest.skills !== 'object' ||
    Array.isArray(manifest.skills) ||
    !Object.keys(manifest.skills).length
  )
    throw new Error('Expected a version 1 skill reference manifest')
  for (const [name, references] of Object.entries(manifest.skills)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64)
      throw new Error(`Invalid skill name: ${name}`)
    if (
      !Array.isArray(references) ||
      !references.length ||
      new Set(references).size !== references.length ||
      references.some(
        (path) =>
          !safePath(path) ||
          !path.startsWith(docsPrefix) ||
          !/\.(?:md|json)$/.test(path) ||
          path.split('/').includes('AGENTS.md'),
      )
    )
      throw new Error(`Invalid or repeated documentation sources for ${name}`)
  }
}

function maskCodeSpans(line) {
  const delimiters = [...line.matchAll(/`+/g)]
  const characters = line.split('')
  for (let index = 0; index < delimiters.length; index++) {
    const opening = delimiters[index]
    const end = delimiters.findIndex(
      (closing, other) => other > index && closing[0].length === opening[0].length,
    )
    if (end < 0) continue
    const closing = delimiters[end]
    characters.fill(' ', opening.index, closing.index + closing[0].length)
    index = end
  }
  return characters.join('')
}

// Keep executable examples byte-for-byte intact while relocating prose links.
async function rewriteMarkdown(text, rewrite) {
  let fence
  const lines = text.split(/(?<=\n)/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line.trimEnd())
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim())
        fence = undefined
      continue
    }
    if (fence || /^(?: {4}|\t)/.test(line)) continue
    const masked = maskCodeSpans(line)
    const targets = []
    for (const expression of [
      /!?\[[^\]\n]*\]\(\s*(?:<(?<angle>[^>]+)>|(?<bare>[^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/dg,
      /^\s{0,3}\[[^\]]+\]:\s*(?:<(?<angle>[^>]+)>|(?<bare>\S+))/dg,
      /\b(?:href|src)\s*=\s*["'](?<bare>[^"']+)["']/dg,
    ]) {
      for (const match of masked.matchAll(expression)) {
        const range = match.indices.groups.angle ?? match.indices.groups.bare
        targets.push({ start: range[0], end: range[1] })
      }
    }
    for (const { start, end } of targets.sort((a, b) => b.start - a.start))
      lines[index] =
        lines[index].slice(0, start) +
        (await rewrite(line.slice(start, end))) +
        lines[index].slice(end)
  }
  return lines.join('')
}

async function validateSkill(root, name, references) {
  const skillSource = `skills/${name}/SKILL.md`
  const skill = decodeText(await sourceBytes(root, skillSource), skillSource)
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skill)?.[1]
  let metadata
  try {
    metadata = frontmatter && parse(frontmatter)
  } catch {
    throw new Error(`${skillSource} needs valid YAML frontmatter`)
  }
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.name !== name ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 1024
  )
    throw new Error(
      `${skillSource} needs its directory name and a nonempty description of at most 1024 characters`,
    )
  await rewriteMarkdown(skill, async (target) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return target
    const path = decodeURIComponent(target.split(/[?#]/, 1)[0])
    const local = posix(
      relative(dirname(join(root, skillSource)), resolve(root, dirname(skillSource), path)),
    )
    if (!safePath(local))
      throw new Error(`${skillSource}: link must stay inside the skill: ${target}`)
    if (local.startsWith('reference/')) {
      if (!references.has(local.slice('reference/'.length)))
        throw new Error(`${skillSource}: reference is missing from the manifest: ${target}`)
    } else await sourceBytes(root, `skills/${name}/${local}`)
    return target
  })
}

async function referenceFiles(root, name, references, manifestBytes) {
  const sources = new Map([
    ...references.map((source) => [source, source.slice(docsPrefix.length)]),
    ...notices.map((source) => [source, source]),
  ])
  const inputs = new Map()
  const siteSources = new Map()
  for (const source of sources.keys()) {
    const bytes = await sourceBytes(root, source)
    inputs.set(source, bytes)
    if (source.startsWith(docsPrefix) && source.endsWith('.md')) {
      const url = `https://jig.md/${source.slice(docsPrefix.length)}`
      siteSources.set(url, source)
      siteSources.set(url.replace(/\.md$/, ''), source)
    }
    if (source.endsWith('.json')) {
      const data = JSON.parse(decodeText(bytes, source))
      if (typeof data?.$id === 'string') siteSources.set(data.$id, source)
    }
  }

  const files = new Map()
  const records = []
  for (const [source, destination] of sources) {
    const bytes = inputs.get(source)
    let output = bytes
    if (source.startsWith(docsPrefix) && source.endsWith('.md')) {
      const text = await rewriteMarkdown(decodeText(bytes, source), async (target) => {
        const match = /^([^?#]*)([\s\S]*)$/.exec(target)
        const [pathname, suffix] = [match[1], match[2]]
        if (!pathname) return target
        const siteTarget = pathname.startsWith('/') ? `https://jig.md${pathname}` : pathname
        let linkedSource = siteSources.get(siteTarget)
        if (!linkedSource && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(pathname)) return target
        if (!linkedSource && pathname.startsWith('/')) return siteTarget + suffix
        if (!linkedSource) {
          let decoded
          try {
            decoded = decodeURIComponent(pathname)
          } catch {
            throw new Error(`${source}: invalid link encoding ${target}`)
          }
          linkedSource = posix(relative(root, resolve(root, dirname(source), decoded)))
        }
        const stat = await sourceStat(root, linkedSource)
        const bundled = sources.get(linkedSource)
        if (bundled) return encodePath(posix(relative(dirname(destination), bundled))) + suffix
        if (linkedSource.startsWith(docsPrefix) && /\.(?:md|mdx)$/.test(linkedSource))
          return `https://jig.md/${encodePath(linkedSource.slice(docsPrefix.length).replace(/\.mdx$/, '.md'))}${suffix}`
        return `${repositoryURL}/${stat.isDirectory() ? 'tree' : 'blob'}/main/${encodePath(linkedSource)}${suffix}`
      })
      output = Buffer.from(text)
    }
    files.set(destination, output)
    records.push({ source, destination, sourceSha256: digest(bytes), outputSha256: digest(output) })
  }
  files.set(
    'provenance.json',
    Buffer.from(
      JSON.stringify(
        {
          version: 1,
          repository: repositoryURL,
          manifest: { source: manifestPath, sha256: digest(manifestBytes) },
          files: records,
        },
        null,
        2,
      ) + '\n',
    ),
  )
  await validateSkill(root, name, files)
  return files
}

async function existingReferences(directory) {
  const files = new Map()
  try {
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(`Generated reference path must be a real directory: ${directory}`)
  } catch (error) {
    if (error.code === 'ENOENT') return files
    throw error
  }
  async function visit(prefix) {
    for (const entry of await readdir(join(directory, prefix))) {
      const path = join(prefix, entry)
      const stat = await lstat(join(directory, path))
      if (stat.isSymbolicLink())
        throw new Error(`Generated reference cannot be a symbolic link: ${path}`)
      if (stat.isDirectory()) await visit(path)
      else if (stat.isFile()) files.set(posix(path), await readFile(join(directory, path)))
      else throw new Error(`Generated reference must be a regular file: ${path}`)
    }
  }
  await visit('')
  return files
}

async function removeEmptyDirectories(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name)
    await removeEmptyDirectories(path)
    if (!(await readdir(path)).length) await rmdir(path)
  }
}

export async function syncSkills({ root, check = false }) {
  root = resolve(root)
  const manifestBytes = await sourceBytes(root, manifestPath)
  const manifest = JSON.parse(decodeText(manifestBytes, manifestPath))
  validateManifest(manifest)
  const plans = []
  const changes = []
  for (const name of Object.keys(manifest.skills).sort()) {
    const files = await referenceFiles(root, name, manifest.skills[name], manifestBytes)
    const directory = join(root, 'skills', name, 'reference')
    const existing = await existingReferences(directory)
    const removed = [...existing.keys()].filter((path) => !files.has(path))
    const updated = [...files.keys()].filter((path) => !existing.get(path)?.equals(files.get(path)))
    changes.push(...[...removed, ...updated].map((path) => `skills/${name}/reference/${path}`))
    plans.push({ directory, files, removed, updated })
  }
  changes.sort()
  if (check) {
    if (changes.length)
      throw new Error(`Skill references are stale:\n${changes.join('\n')}\nRun just sync-skills.`)
    return changes
  }
  // Validate every input and output subtree before changing any generated files.
  for (const { directory, files, removed, updated } of plans) {
    for (const path of removed) await rm(join(directory, path))
    await removeEmptyDirectories(directory)
    for (const path of updated) {
      const target = join(directory, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, files.get(path))
    }
  }
  return changes
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    let check = false
    let selectedRoot = false
    const args = process.argv.slice(2)
    while (args.length) {
      const arg = args.shift()
      if (arg === '--check' && !check) check = true
      else if (arg === '--root' && !selectedRoot && args[0] && !args[0].startsWith('--')) {
        root = resolve(args.shift())
        selectedRoot = true
      } else throw new Error('usage: node scripts/sync-skills.mjs [--check] [--root PATH]')
    }
    const changes = await syncSkills({ root, check })
    console.log(
      check
        ? 'Skill references are current.'
        : `Synchronized ${changes.length} generated skill files.`,
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
