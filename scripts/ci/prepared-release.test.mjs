import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test, { after, before } from 'node:test'
import { MARKER } from '../release/catalog.mjs'
import { checkRelease, versionRelease } from '../release/cli.mjs'
import {
  applyPrepared,
  createPrepared,
  restoreWorkspaceLock,
  validatePrepared,
} from '../release/prepared.mjs'
import {
  git,
  releaseState,
  sourceDigest,
  sourceEntriesDigest,
  sourceFiles,
} from '../release/state.mjs'

const repository = resolve(import.meta.dirname, '../..')
const cli = join(repository, 'node_modules/@changesets/cli/bin.js')
const identity = { runId: '123', runAttempt: '1' }
const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const blobHash = (contents) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(contents)}\0`)
    .update(contents)
    .digest('hex')
let temporary
let sourceRevision
let generated
let payload
let nextClone = 0
let retainTemporary = false

async function clone(name) {
  const root = join(temporary, `${name}-${nextClone++}`)
  const source = generated ?? repository
  git(source, ['clone', '--quiet', '--shared', '--no-checkout', source, root])
  git(root, ['checkout', '--quiet', '--detach', sourceRevision])
  for (const [name, value] of [
    ['user.name', 'Prepared Release Test'],
    ['user.email', 'prepared-release-test@localhost'],
    ['commit.gpgsign', 'false'],
    ['core.hooksPath', '/dev/null'],
  ])
    git(root, ['config', name, value])
  await assert.rejects(lstat(join(root, 'node_modules')), { code: 'ENOENT' })
  return root
}

function commit(root, message = 'Apply prepared release') {
  git(root, ['add', '--all'])
  git(root, ['commit', '--quiet', '-m', message])
  return git(root, ['rev-parse', 'HEAD']).trim()
}

async function ignoredLock(root) {
  try {
    const path = join(root, 'bun.lock')
    const stat = await lstat(path)
    return {
      mode: stat.mode,
      link: stat.isSymbolicLink(),
      contents: stat.isSymbolicLink() ? await readlink(path) : await readFile(path, 'utf8'),
    }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function snapshot(root) {
  return {
    revision: git(root, ['rev-parse', 'HEAD']),
    status: git(root, ['status', '--porcelain', '--untracked-files=all']),
    diff: git(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--']),
    lock: await ignoredLock(root),
  }
}

async function rejectWithoutWrites(root, candidate, label, expected) {
  const original = await snapshot(root)
  await assert.rejects(
    restoreWorkspaceLock(root, candidate, identity),
    expected,
    `${label}: restore`,
  )
  assert.deepEqual(await snapshot(root), original, `${label}: restore changed the checkout or lock`)
  await assert.rejects(applyPrepared(root, candidate, identity), expected, `${label}: apply`)
  assert.deepEqual(await snapshot(root), original, `${label}: apply changed the checkout or lock`)
}

function preparedEntries(root, candidate) {
  const entries = new Map(
    sourceFiles(root, candidate.sourceRevision).map((entry) => [entry.path, entry]),
  )
  for (const { path, contents } of candidate.files) {
    if (contents === null) entries.delete(path)
    else entries.set(path, { path, mode: '100644', hash: blobHash(contents) })
  }
  return entries
}

function rebindDigest(root, candidate) {
  const entries = preparedEntries(root, candidate)
  const file = candidate.files.find(({ path }) => path === MARKER)
  const marker = JSON.parse(file.contents)
  marker.sourceDigest = sourceEntriesDigest(
    [...entries.values()].filter(({ path }) => path !== MARKER),
  )
  file.contents = json(marker)
  return candidate
}

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'jig-prepared-release-test-'))
  sourceRevision = git(repository, ['rev-parse', 'HEAD']).trim()
  generated = await clone('generator')
  await writeFile(
    join(generated, '.changeset/prepared-transfer-fixture.md'),
    '---\n"@jigging/agent-method": patch\n"@jigging/agent-acp": patch\n"@jigging/jig": patch\n---\n\nExercise prepared release transfer with real package versions.\n',
    { flag: 'wx' },
  )
  sourceRevision = commit(generated, 'Add prepared-release test intent')
  await copyFile(join(repository, 'bun.lock'), join(generated, 'bun.lock'))
  await versionRelease(generated, { cli })
  payload = await createPrepared(generated, identity)
})

after(async (t) => {
  if (retainTemporary) t.diagnostic(`Retained failed prepared-release fixture: ${temporary}`)
  else if (temporary) await rm(temporary, { recursive: true, force: true })
})

test('prepared release round trip reproduces the real generated tree without writer dependencies', async () => {
  const writer = await clone('round-trip')
  const original = await snapshot(writer)
  const validated = await validatePrepared(writer, payload, identity)
  assert.deepEqual(await snapshot(writer), original, 'validation must be read-only')
  assert.equal(validated.marker.sourceDigest, await sourceDigest(generated))
  assert.equal(await ignoredLock(writer), null)

  await restoreWorkspaceLock(writer, payload, identity)
  assert.equal(await readFile(join(writer, 'bun.lock'), 'utf8'), payload.workspaceLock)
  assert.equal(git(writer, ['status', '--porcelain']), '', 'the restored lock must remain ignored')
  const marker = await applyPrepared(writer, payload, identity)
  assert.deepEqual(marker, validated.marker)
  assert.equal(await sourceDigest(writer), await sourceDigest(generated))
  const revision = commit(writer)
  const state = await releaseState(writer, revision)
  let diagnostics
  if (!state.eligible) {
    retainTemporary = true
    const expected = preparedEntries(writer, payload)
    const committed = new Map(sourceFiles(writer, revision).map((entry) => [entry.path, entry]))
    const differences = []
    for (const path of new Set([...expected.keys(), ...committed.keys()])) {
      const before = expected.get(path)
      const after = committed.get(path)
      if (before?.mode === after?.mode && before?.hash === after?.hash) continue
      const stat = await lstat(join(writer, path)).catch((error) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })
      const bytes = stat
        ? stat.isSymbolicLink()
          ? await readlink(join(writer, path))
          : await readFile(join(writer, path))
        : undefined
      differences.push({
        path,
        expected: before,
        committed: after,
        workingHash: bytes === undefined ? null : blobHash(bytes),
        mtimeMs: stat?.mtimeMs,
        ctimeMs: stat?.ctimeMs,
      })
    }
    diagnostics = {
      directory: temporary,
      state,
      expectedDigest: marker.sourceDigest,
      committedDigest: await sourceDigest(writer, revision),
      workingDigest: await sourceDigest(writer),
      status: git(writer, ['status', '--porcelain', '--untracked-files=all']),
      differences,
    }
    await writeFile(join(temporary, 'failure-diagnostics.json'), json(diagnostics))
  }
  assert.equal(state.eligible, true, diagnostics ? json(diagnostics) : undefined)
  assert.equal((await checkRelease(writer, sourceRevision, { cli })).mode, 'versioned')
  await assert.rejects(lstat(join(writer, 'node_modules')), { code: 'ENOENT' })
})

test('foreign identity, malformed envelopes, and forbidden output paths refuse before any write', async () => {
  const writer = await clone('envelopes')
  await validatePrepared(writer, payload, identity)
  const mutations = [
    [
      'foreign source',
      (value) => {
        value.sourceRevision = '0'.repeat(40)
      },
    ],
    [
      'foreign run',
      (value) => {
        value.runId = '124'
      },
    ],
    [
      'foreign attempt',
      (value) => {
        value.runAttempt = '2'
      },
    ],
    [
      'unknown payload field',
      (value) => {
        value.extra = true
      },
    ],
    [
      'empty lock',
      (value) => {
        value.workspaceLock = ''
      },
    ],
    [
      'duplicate output',
      (value) => {
        value.files.push(structuredClone(value.files[0]))
      },
    ],
    [
      'unknown file field',
      (value) => {
        value.files[0].mode = '100755'
      },
    ],
    [
      'wrong preimage',
      (value) => {
        value.files[0].beforeHash = '0'.repeat(40)
      },
    ],
  ]
  for (const path of [
    '../outside.md',
    '.github/workflows/unauthorized.yml',
    'scripts/unauthorized.mjs',
  ])
    mutations.push([
      path,
      (value) => {
        value.files.push({ path, beforeHash: null, contents: 'Unapproved output.\n' })
      },
    ])
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(payload)
    mutate(candidate)
    await rejectWithoutWrites(writer, candidate, label)
  }
})

test('coherent digest tampering cannot change manifest meaning or add project source', async () => {
  const writer = await clone('structural')
  await validatePrepared(writer, payload, identity)
  const path = 'packages/jig/package.json'
  const mutations = [
    [
      'manifest scripts',
      (value) => {
        value.scripts = { check: 'node --version' }
      },
    ],
    [
      'external dependency',
      (value) => {
        value.devDependencies['@jigging/flow'] = '0.1.0-alpha.999'
      },
    ],
    [
      'private package',
      (value) => {
        value.private = true
      },
    ],
  ]
  for (const [label, mutate] of mutations) {
    const candidate = structuredClone(payload)
    const file = candidate.files.find((file) => file.path === path)
    assert.ok(file, 'the real release must include the Jig manifest')
    const value = JSON.parse(file.contents)
    mutate(value)
    file.contents = json(value)
    rebindDigest(writer, candidate)
    await rejectWithoutWrites(
      writer,
      candidate,
      label,
      /only owned versions and existing internal pins/,
    )
  }
  const candidate = structuredClone(payload)
  const project = candidate.files.find(({ path }) => path === 'packages/jig/src/project-init.ts')
  assert.ok(project, 'the real ACP release must synchronize the generated project version')
  project.contents += '\nexport const unrelatedPreparedChange = true\n'
  rebindDigest(writer, candidate)
  await rejectWithoutWrites(
    writer,
    candidate,
    'additional project source',
    /only the canonical ACP version literal/,
  )
})

test('incomplete or altered generated plans and consumed notes cannot be transferred', async () => {
  const writer = await clone('incomplete')
  const consumed = payload.files.find(({ path }) => path.startsWith('.changeset/pre/'))
  const deleted = payload.files.find(({ contents }) => contents === null)
  const synchronized = payload.files.find(
    ({ path }) => path.startsWith('examples/') && path.endsWith('/package.json'),
  )
  assert.ok(consumed)
  assert.ok(deleted)
  assert.ok(synchronized, 'the real release must synchronize an example manifest')
  for (const [path, expected] of [
    [consumed.path],
    [deleted.path],
    ['packages/jig/package.json'],
    [synchronized.path, /missing a synchronized manifest/],
    ['packages/jig/src/project-init.ts', /missing the synchronized project ACP version/],
  ]) {
    const candidate = structuredClone(payload)
    candidate.files = candidate.files.filter((file) => file.path !== path)
    rebindDigest(writer, candidate)
    await rejectWithoutWrites(writer, candidate, `missing ${path}`, expected)
  }
  const altered = structuredClone(payload)
  altered.files.find(({ path }) => path === consumed.path).contents += '\nChanged intent.\n'
  rebindDigest(writer, altered)
  await rejectWithoutWrites(writer, altered, 'altered consumed note', /consumed note differs/)
  const malformed = structuredClone(payload)
  malformed.files.find(({ path }) => path === MARKER).contents = json({ schemaVersion: 1 })
  await rejectWithoutWrites(
    writer,
    malformed,
    'malformed marker',
    /Malformed generated release plan/,
  )
  const missing = structuredClone(payload)
  missing.files = missing.files.filter(({ path }) => path !== MARKER)
  await rejectWithoutWrites(writer, missing, 'missing marker', /missing its generated plan/)
})

test('non-regular generated outputs and destination files refuse without following links', async () => {
  const output = join(generated, 'packages/jig/package.json')
  const contents = await readFile(output)
  const mode = (await lstat(output)).mode & 0o777
  await chmod(output, 0o755)
  try {
    await assert.rejects(createPrepared(generated, identity), /regular non-executable files/)
  } finally {
    await chmod(output, mode)
  }
  const target = join(temporary, 'unmodified-link-target.json')
  await writeFile(target, contents)
  await unlink(output)
  await symlink(target, output)
  try {
    await assert.rejects(createPrepared(generated, identity), /regular non-executable files/)
    assert.deepEqual(await readFile(target), contents)
  } finally {
    await unlink(output)
    await writeFile(output, contents, { mode })
  }

  const linkedWriter = await clone('linked-destination')
  await symlink(target, join(linkedWriter, 'bun.lock'))
  await rejectWithoutWrites(
    linkedWriter,
    payload,
    'linked ignored lock',
    /ordinary directories and data files/,
  )
  assert.deepEqual(await readFile(target), contents)
  const executableWriter = await clone('executable-destination')
  git(executableWriter, ['config', 'core.filemode', 'false'])
  const executable = join(executableWriter, 'packages/jig/package.json')
  await chmod(executable, 0o755)
  assert.equal(git(executableWriter, ['status', '--porcelain']), '')
  await rejectWithoutWrites(
    executableWriter,
    payload,
    'executable destination',
    /ordinary directories and data files/,
  )
  assert.equal((await lstat(executable)).mode & 0o777, 0o755)
})

test('dirty, stale, and dependency-installed writer checkouts reject the whole artifact', async () => {
  const dirty = await clone('dirty')
  await appendFile(join(dirty, 'README.md'), '\nUncommitted owner change.\n')
  await rejectWithoutWrites(dirty, payload, 'dirty destination', /clean source checkout/)

  const stale = await clone('stale')
  git(stale, ['checkout', '--quiet', '--detach', `${sourceRevision}^`])
  await rejectWithoutWrites(
    stale,
    payload,
    'stale destination',
    /source differs from this checkout/,
  )

  const installed = await clone('installed')
  await mkdir(join(installed, 'node_modules'))
  await writeFile(join(installed, 'node_modules', 'existing-input'), 'Preserve installed input.\n')
  await rejectWithoutWrites(
    installed,
    payload,
    'installed dependencies',
    /must not have installed workspace dependencies/,
  )
  assert.equal(
    await readFile(join(installed, 'node_modules', 'existing-input'), 'utf8'),
    'Preserve installed input.\n',
  )
})
