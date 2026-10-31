import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MANIFESTS,
  MARKER,
  PACKAGE_NAMES,
  PACKAGES,
  PUBLISHED_PACKAGES,
  packageInputs,
  releaseClosure,
  rootPackageInputs,
} from './catalog.mjs'
import {
  alphaVersion,
  dependentNote,
  git,
  pendingChangesets,
  releaseState,
  requireRevision,
  sourceDigest,
  sourceFiles,
  sourceText,
  validateConfiguration,
  validateMarker,
} from './state.mjs'

const defaultRoot = resolve(import.meta.dirname, '../..')
const defaultCli = resolve(defaultRoot, 'node_modules/@changesets/cli/bin.js')
const dependencySections = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]
const generatedPrefix = 'release-dependents-'
const json = (value) => `${JSON.stringify(value, null, 2)}\n`

async function manifest(root, path, revision, optional = false) {
  const text = await sourceText(root, path, revision, optional)
  return text === undefined ? undefined : JSON.parse(text)
}

async function inventory(root, revision) {
  const manifests = new Map()
  for (const { kind, name } of PACKAGES) {
    const value = await manifest(root, `packages/${kind}/package.json`, revision)
    if (value.name !== name || value.private === true || !alphaVersion.test(value.version ?? ''))
      throw new Error(`Expected an independently versioned alpha package: ${name}`)
    manifests.set(name, value)
  }
  for (const { path } of sourceFiles(root, revision)) {
    if (!/^packages\/[^/]+\/package\.json$/.test(path)) continue
    const value = await manifest(root, path, revision, true)
    if (value && value.private !== true && !PACKAGE_NAMES.has(value.name))
      throw new Error(`Add the new package to the release catalog: ${value.name}`)
  }
  return manifests
}

async function currentNotes(root, revision) {
  await validateConfiguration(root, revision)
  const notes = await pendingChangesets(root, revision)
  if (notes.some(({ id }) => id.startsWith(generatedPrefix)))
    throw new Error('Release dependency notes are generated. Add an ordinary changeset instead.')
  return notes
}

function runChangesets(root, cli, args) {
  try {
    return execFileSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CI: 'true', NO_COLOR: '1' },
    })
  } catch (error) {
    throw new Error(`Changesets ${args[0]} failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`, {
      cause: error,
    })
  }
}

async function inspectPlan(root, notes, cli) {
  const output = await mkdtemp(join(tmpdir(), 'jig-changesets-status-'))
  try {
    runChangesets(root, cli, ['status', '--output', join(output, 'plan.json')])
    const plan = JSON.parse(await readFile(join(output, 'plan.json'), 'utf8'))
    const releases = plan.releases
      .filter(({ type }) => type !== 'none')
      .map(({ name, type, oldVersion, newVersion }) => {
        if (
          !PACKAGE_NAMES.has(name) ||
          !['patch', 'minor', 'major'].includes(type) ||
          !alphaVersion.test(oldVersion ?? '') ||
          !alphaVersion.test(newVersion ?? '') ||
          oldVersion === newVersion
        )
          throw new Error('Changesets must produce only owned independent alpha releases')
        return { name, type, oldVersion, newVersion }
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    const expected = releaseClosure(notes.flatMap((note) => note.releases.map(({ name }) => name)))
    if (JSON.stringify(releases.map(({ name }) => name)) !== JSON.stringify(expected))
      throw new Error('Changesets and the artifact dependency graph disagree about the release set')
    return releases
  } finally {
    await rm(output, { recursive: true, force: true })
  }
}

async function withPlanWorkspace(root, action) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-release-plan-'))
  try {
    for (const { path } of sourceFiles(root)) {
      if (
        !path.endsWith('/package.json') &&
        path !== 'package.json' &&
        !path.startsWith('.changeset/')
      )
        continue
      const text = await sourceText(root, path, undefined, true)
      if (text === undefined) continue
      await mkdir(dirname(join(temporary, path)), { recursive: true })
      await writeFile(join(temporary, path), text)
    }
    // ManyPkg uses lock existence to recognize Bun workspaces. It calculates
    // versions from manifests, never from this ignored dependency resolution.
    await copyWorkspaceLock(root, temporary)
    git(temporary, ['init', '--quiet', '--initial-branch=main'])
    git(temporary, ['add', '.'])
    git(temporary, [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Release plan',
      '-c',
      'user.email=release-plan@localhost',
      'commit',
      '--quiet',
      '-m',
      'Inspect release manifests',
    ])
    return await action(temporary)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function copyWorkspaceLock(root, destination) {
  try {
    await copyFile(join(root, 'bun.lock'), join(destination, 'bun.lock'))
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('Run bun install before planning or generating releases')
    throw error
  }
}

export async function releasePlan(root = defaultRoot, { cli = defaultCli } = {}) {
  const packages = await inventory(root)
  const notes = await currentNotes(root)
  const releases = notes.length
    ? await withPlanWorkspace(root, async (temporary) => {
        const dependent = dependentNote(notes)
        if (dependent)
          await writeFile(join(temporary, `.changeset/${dependent.id}.md`), dependent.text, {
            flag: 'wx',
          })
        return await inspectPlan(temporary, notes, cli)
      })
    : []
  const versions = new Map(releases.map(({ name, newVersion }) => [name, newVersion]))
  return {
    schemaVersion: 1,
    pendingChangesets: notes.map(({ id }) => id),
    releases,
    publicationPackages: PUBLISHED_PACKAGES.map(({ kind, name }) => ({
      kind,
      name,
      version: versions.get(name) ?? packages.get(name).version,
    })),
  }
}

async function synchronizePins(root) {
  const packages = await inventory(root)
  for (const { path } of sourceFiles(root)) {
    if (path !== 'package.json' && !path.endsWith('/package.json')) continue
    // Examples, fixtures and package manifests can carry exact internal pins.
    if (path !== 'package.json' && !path.startsWith('packages/') && !path.startsWith('examples/'))
      continue
    const value = await manifest(root, path, undefined, true)
    if (!value) continue
    let changed = false
    for (const section of dependencySections) {
      for (const [name, current] of Object.entries(value[section] ?? {})) {
        const version = packages.get(name)?.version
        if (!version || current.startsWith('workspace:') || current === version) continue
        value[section][name] = version
        changed = true
      }
    }
    if (
      value.engines?.jig !== undefined &&
      value.engines.jig !== packages.get('@jigging/jig').version
    ) {
      value.engines.jig = packages.get('@jigging/jig').version
      changed = true
    }
    if (changed) await writeFile(join(root, path), json(value))
  }
  const projectInit = 'packages/jig/src/project-init.ts'
  const source = await sourceText(root, projectInit, undefined, true)
  if (source !== undefined) {
    const pattern = /const AGENT_ACP_VERSION = '[^']+'/g
    if ([...source.matchAll(pattern)].length !== 1)
      throw new Error('Generated project ACP version must have one canonical declaration')
    await writeFile(
      join(root, projectInit),
      source.replace(
        pattern,
        `const AGENT_ACP_VERSION = '${packages.get('@jigging/agent-acp').version}'`,
      ),
    )
  }
  const reportingNotice = 'packages/display-model/THIRD_PARTY_NOTICES'
  const notice = await sourceText(root, reportingNotice, undefined, true)
  if (notice !== undefined) {
    const pattern = /^@jigging\/reporting \S+(?= is an exact external dependency under$)/gm
    if ([...notice.matchAll(pattern)].length !== 1)
      throw new Error('Reporting notice must have one canonical dependency version')
    await writeFile(
      join(root, reportingNotice),
      notice.replace(pattern, `@jigging/reporting ${packages.get('@jigging/reporting').version}`),
    )
  }
}

export async function versionRelease(root = defaultRoot, { cli = defaultCli } = {}) {
  if (git(root, ['status', '--porcelain', '--untracked-files=normal']).trim())
    throw new Error('Commit the reviewed source and changesets before generating release versions')
  const baseRevision = requireRevision(git(root, ['rev-parse', 'HEAD']).trim())
  await inventory(root)
  const notes = await currentNotes(root)
  if (!notes.length) throw new Error('There are no pending changesets to version')
  const { releases } = await releasePlan(root, { cli })
  const dependent = dependentNote(notes)
  if (dependent)
    await writeFile(join(root, `.changeset/${dependent.id}.md`), dependent.text, { flag: 'wx' })
  runChangesets(root, cli, ['version'])
  await synchronizePins(root)
  if ((await pendingChangesets(root)).length)
    throw new Error('Changesets left unconsumed release intent')
  const marker = {
    schemaVersion: 1,
    baseRevision,
    sourceDigest: await sourceDigest(root),
    changesets: notes.map(({ id, sha256 }) => ({ id, sha256 })),
    releases,
  }
  validateMarker(marker)
  await writeFile(join(root, MARKER), json(marker))
  return marker
}

async function verifyGeneratedRelease(
  root,
  baseRevision,
  sourceRevision,
  { cli = defaultCli } = {},
) {
  const raw = await sourceText(root, MARKER, sourceRevision)
  const marker = validateMarker(JSON.parse(raw))
  if (marker.baseRevision !== baseRevision)
    throw new Error('Release plan is stale. Regenerate it from the current PR base.')
  const temporary = await mkdtemp(join(tmpdir(), 'jig-release-replay-'))
  const checkout = join(temporary, 'source')
  try {
    git(root, ['clone', '--quiet', '--shared', '--no-checkout', root, checkout])
    git(checkout, ['checkout', '--quiet', '--detach', baseRevision])
    await copyWorkspaceLock(root, checkout)
    const expected = await versionRelease(checkout, { cli })
    if (
      JSON.stringify(marker) !== JSON.stringify(expected) ||
      marker.sourceDigest !== (await sourceDigest(root, sourceRevision))
    )
      throw new Error(
        'Release source differs from the generated Changesets versions and synchronized pins',
      )
    const state = await releaseState(root, sourceRevision)
    if (!state.eligible) throw new Error('Generated release source is not eligible')
    return state
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

export async function checkRelease(root, baseRevision, { cli = defaultCli } = {}) {
  requireRevision(baseRevision)
  const sourceRevision = requireRevision(git(root, ['rev-parse', 'HEAD']).trim())
  git(root, ['merge-base', '--is-ancestor', baseRevision, sourceRevision])
  await inventory(root, sourceRevision)
  await validateConfiguration(root, sourceRevision)
  const paths = git(root, [
    'diff',
    '--no-ext-diff',
    '--no-renames',
    '--name-only',
    '-z',
    baseRevision,
    sourceRevision,
  ])
    .split('\0')
    .filter(Boolean)
  if (paths.includes(MARKER)) {
    if ((await sourceText(root, MARKER, sourceRevision, true)) === undefined)
      throw new Error('Only the version command may replace the generated release plan')
    return {
      mode: 'versioned',
      ...(await verifyGeneratedRelease(root, baseRevision, sourceRevision, { cli })),
    }
  }
  for (const path of MANIFESTS) {
    const before = await manifest(root, path, baseRevision, true)
    const after = await manifest(root, path, sourceRevision)
    if (before && before.version !== after.version)
      throw new Error(`Do not edit ${path} versions manually. Add a changeset.`)
  }
  if (paths.some((path) => /^packages\/[^/]+\/CHANGELOG\.md$/.test(path)))
    throw new Error('Only the version command may update generated package changelogs')
  if (
    paths.some(
      (path) =>
        path.startsWith('.changeset/pre/') ||
        (path === '.changeset/pre.json' &&
          sourceFiles(root, baseRevision).some((entry) => entry.path === path)),
    )
  )
    throw new Error('Only the version command may consume alpha release intent')
  const prior = await pendingChangesets(root, baseRevision)
  const notes = await currentNotes(root, sourceRevision)
  const existingIds = new Set(prior.map(({ id }) => id))
  for (const note of prior) {
    if (notes.find(({ id }) => id === note.id)?.sha256 !== note.sha256)
      throw new Error(`Pending changeset ${note.id} changed. Add a new changeset instead.`)
  }
  const added = notes.filter(({ id }) => !existingIds.has(id))
  const covered = new Set(added.flatMap((note) => note.releases.map(({ name }) => name)))
  const affected = new Set(paths.flatMap(packageInputs))
  if (paths.includes('package.json')) {
    for (const name of rootPackageInputs(
      await manifest(root, 'package.json', baseRevision, true),
      await manifest(root, 'package.json', sourceRevision),
    ))
      affected.add(name)
  }
  const missing = [...affected].filter((name) => !covered.has(name)).sort()
  if (missing.length)
    throw new Error(
      `Missing new changesets for: ${missing.join(', ')}. Run just changeset and describe each changed package.`,
    )
  return {
    schemaVersion: 1,
    mode: 'feature',
    sourceRevision,
    affectedPackages: [...affected].sort(),
    releasePackages: releaseClosure(covered),
    changesets: added.map(({ id }) => id),
  }
}

async function main(args) {
  const command = args.shift()
  const options = {}
  while (args.length) {
    const key = args.shift(),
      value = args.shift()
    if (!['--base', '--source', '--output'].includes(key) || !value || key in options)
      throw new Error(
        'Use check --base SHA, plan [--output FILE], version, or state [--source SHA]',
      )
    options[key] = value
  }
  let result
  if (command === 'check' && options['--base'] && Object.keys(options).length === 1)
    result = await checkRelease(
      defaultRoot,
      git(defaultRoot, [
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${options['--base']}^{commit}`,
      ]).trim(),
    )
  else if (command === 'plan' && Object.keys(options).every((key) => key === '--output'))
    result = await releasePlan(defaultRoot)
  else if (command === 'version' && !Object.keys(options).length)
    result = await versionRelease(defaultRoot)
  else if (command === 'state' && Object.keys(options).every((key) => key === '--source'))
    result = await releaseState(
      defaultRoot,
      options['--source'] ?? git(defaultRoot, ['rev-parse', 'HEAD']).trim(),
    )
  else
    throw new Error('Use check --base SHA, plan [--output FILE], version, or state [--source SHA]')
  if (options['--output']) await writeFile(resolve(options['--output']), json(result))
  else process.stdout.write(json(result))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
