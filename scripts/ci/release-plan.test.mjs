import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { PACKAGES } from '../release/catalog.mjs'
import { checkRelease, releasePlan, versionRelease } from '../release/cli.mjs'
import { git, releaseState, sourceDigest } from '../release/state.mjs'

const repository = resolve(import.meta.dirname, '../..')
const json = (value) => `${JSON.stringify(value, null, 2)}\n`

async function put(root, path, value) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : json(value))
}

async function get(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

function commit(root, message = 'Fixture change') {
  git(root, ['add', '--all'])
  git(root, ['commit', '--quiet', '-m', message])
  return git(root, ['rev-parse', 'HEAD']).trim()
}

async function note(root, id, names) {
  await put(
    root,
    `.changeset/${id}.md`,
    `---\n${names.map((name) => `${JSON.stringify(name)}: patch`).join('\n')}\n---\n\nFix the package behavior.\n`,
  )
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jig-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  git(root, ['init', '--quiet', '--initial-branch=main'])
  git(root, ['config', 'user.name', 'Release Test'])
  git(root, ['config', 'user.email', 'release-test@localhost'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  git(root, ['config', 'core.hooksPath', '/dev/null'])
  await put(root, '.gitignore', 'bun.lock\nnode_modules/\n.tmp/\n')
  await put(root, 'package.json', {
    name: 'release-fixture',
    private: true,
    workspaces: ['packages/*', 'examples/*', 'packages/jig/test/fixtures/consumer'],
  })
  await mkdir(join(root, '.changeset'))
  await copyFile(join(repository, '.changeset/config.json'), join(root, '.changeset/config.json'))
  await copyFile(join(repository, '.changeset/pre.json'), join(root, '.changeset/pre.json'))
  // The installed lock is only ManyPkg's Bun workspace marker. Changesets reads
  // versions from these fixture manifests, without installing or networking.
  await copyFile(join(repository, 'bun.lock'), join(root, 'bun.lock'))
  for (const { kind, name } of PACKAGES) {
    const versions = { 'agent-method': 9, 'agent-acp': 11, jig: 37 }
    const value = {
      name,
      version: `0.1.0-alpha.${versions[kind] ?? 1}`,
      publishConfig: { access: 'public' },
      devDependencies: { '@jigging/flow': '0.1.0-alpha.15' },
    }
    if (kind === 'agent-acp') value.devDependencies['@jigging/agent-method'] = 'workspace:*'
    if (kind === 'jig')
      Object.assign(value.devDependencies, {
        '@jigging/agent-method': 'workspace:*',
        '@jigging/agent-acp': 'workspace:*',
        '@jigging/display-web': '0.1.0-alpha.1',
        '@jigging/flow-authoring': '0.1.0-alpha.1',
      })
    if (kind === 'display-model') value.dependencies = { '@jigging/reporting': '0.1.0-alpha.1' }
    if (kind === 'display-web' || kind === 'display-tui')
      value.dependencies = {
        '@jigging/reporting': '0.1.0-alpha.1',
        '@jigging/display-model': '0.1.0-alpha.1',
      }
    await put(root, `packages/${kind}/package.json`, value)
    await put(root, `packages/${kind}/src/index.ts`, 'export const value = 1\n')
  }
  for (const path of [
    'examples/app/package.json',
    'packages/jig/test/fixtures/consumer/package.json',
  ])
    await put(root, path, {
      name: path.startsWith('examples') ? 'example-app' : 'fixture-app',
      private: true,
      version: '0.0.0',
      dependencies: {
        '@jigging/agent-method': '0.1.0-alpha.9',
        '@jigging/agent-acp': '0.1.0-alpha.11',
        '@jigging/reporting': '0.1.0-alpha.1',
        '@jigging/flow': '0.1.0-alpha.15',
      },
    })
  await put(
    root,
    'packages/jig/src/project-init.ts',
    "const AGENT_ACP_VERSION = '0.1.0-alpha.11'\nconst GREETING_SDK_VERSION = '0.1.0-alpha.15'\n",
  )
  return { root, base: commit(root, 'Initial fixture') }
}

test('PR coverage requires a new note for each directly changed package', async (t) => {
  const { root, base } = await fixture(t)
  await put(root, 'packages/agent-method/src/index.ts', 'export const value = 2\n')
  await put(root, 'packages/agent-acp/test/new.test.ts', '// Shipped Agent test\n')
  await note(root, 'method-change', ['@jigging/agent-method'])
  commit(root)
  await assert.rejects(checkRelease(root, base), /Missing new changesets for: @jigging\/agent-acp/)
  await note(root, 'acp-change', ['@jigging/agent-acp'])
  await assert.rejects(
    checkRelease(root, base),
    /Missing new changesets for: @jigging\/agent-acp/,
    'an uncommitted note cannot cover the pinned PR source',
  )
  const nextBase = commit(root)
  const checked = await checkRelease(root, base)
  assert.deepEqual(checked.affectedPackages, ['@jigging/agent-acp', '@jigging/agent-method'])
  assert.deepEqual(checked.releasePackages, [
    '@jigging/agent-acp',
    '@jigging/agent-method',
    '@jigging/jig',
  ])
  const state = await releaseState(root, nextBase)
  assert.equal(state.eligible, false)
  assert.equal(state.reason, 'pending-changesets')
  assert.deepEqual(state.pendingPackages, checked.releasePackages)
  await put(root, 'packages/agent-method/README.md', 'Changed shipped documentation.\n')
  commit(root)
  await assert.rejects(
    checkRelease(root, nextBase),
    /Missing new changesets for: @jigging\/agent-method/,
  )
})

test('unshipped tests are exempt, while copied contracts and licenses require coverage', async (t) => {
  const { root, base } = await fixture(t)
  await put(root, 'packages/jig/test/new.test.ts', '// Unshipped test\n')
  await put(root, 'docs/jig/guide/example.md', 'Guide change.\n')
  await put(root, 'site/example.css', 'body { color: black }\n')
  let head = commit(root)
  assert.deepEqual((await checkRelease(root, base)).affectedPackages, [])
  assert.equal((await releaseState(root, head)).reason, 'feature-source')
  const contractBase = head
  await put(root, 'docs/jig/spec/contracts/example.json', '{}\n')
  head = commit(root)
  await assert.rejects(
    checkRelease(root, contractBase),
    /Missing new changesets for: @jigging\/jig/,
  )
  await note(root, 'contract-change', ['@jigging/jig'])
  const licenseBase = commit(root)
  await checkRelease(root, contractBase)
  await put(root, 'LICENSE.md', 'Changed copied license.\n')
  commit(root)
  await assert.rejects(checkRelease(root, licenseBase), /@jigging\/display-model/)
  await note(root, 'license-change', [
    '@jigging/jig',
    '@jigging/display-model',
    '@jigging/display-web',
    '@jigging/display-tui',
  ])
  commit(root)
  assert.equal((await checkRelease(root, licenseBase)).affectedPackages.length, 4)
})

test('root tooling stays independent, but dependency patches require all affected package notes', async (t) => {
  const { root, base } = await fixture(t)
  const value = await get(root, 'package.json')
  value.devDependencies = { '@changesets/cli': '3.0.3' }
  await put(root, 'package.json', value)
  const patchedBase = commit(root)
  assert.deepEqual((await checkRelease(root, base)).affectedPackages, [])
  value.patchedDependencies = { 'some-bundled-package@1.0.0': 'patches/fix.patch' }
  await put(root, 'package.json', value)
  await put(root, 'patches/fix.patch', 'Changed dependency bytes.\n')
  commit(root)
  await assert.rejects(checkRelease(root, patchedBase), /Missing new changesets/)
  await note(
    root,
    'dependency-fix',
    PACKAGES.map(({ name }) => name),
  )
  commit(root)
  assert.equal((await checkRelease(root, patchedBase)).affectedPackages.length, 7)
})

test('real Changesets preserves independent alpha counters and synchronizes all internal pins', async (t) => {
  const { root } = await fixture(t)
  await note(root, 'method-fix', ['@jigging/agent-method'])
  const base = commit(root)
  const status = git(root, ['status', '--porcelain'])
  const plan = await releasePlan(root)
  assert.equal(git(root, ['status', '--porcelain']), status, 'planning must not modify source')
  assert.deepEqual(
    Object.fromEntries(plan.releases.map(({ name, newVersion }) => [name, newVersion])),
    {
      '@jigging/agent-acp': '0.1.0-alpha.12',
      '@jigging/agent-method': '0.1.0-alpha.10',
      '@jigging/jig': '0.1.0-alpha.38',
    },
  )
  const marker = await versionRelease(root)
  assert.equal(marker.baseRevision, base)
  for (const path of [
    'examples/app/package.json',
    'packages/jig/test/fixtures/consumer/package.json',
  ]) {
    const value = await get(root, path)
    assert.equal(value.version, '0.0.0')
    assert.equal(value.dependencies['@jigging/agent-method'], '0.1.0-alpha.10')
    assert.equal(value.dependencies['@jigging/agent-acp'], '0.1.0-alpha.12')
    assert.equal(value.dependencies['@jigging/reporting'], '0.1.0-alpha.1')
    assert.equal(value.dependencies['@jigging/flow'], '0.1.0-alpha.15')
  }
  const jig = await get(root, 'packages/jig/package.json')
  assert.equal(jig.devDependencies['@jigging/agent-acp'], 'workspace:*')
  assert.equal(jig.devDependencies['@jigging/flow-authoring'], '0.1.0-alpha.1')
  const init = await readFile(join(root, 'packages/jig/src/project-init.ts'), 'utf8')
  assert.match(init, /AGENT_ACP_VERSION = '0\.1\.0-alpha\.12'/)
  assert.match(init, /GREETING_SDK_VERSION = '0\.1\.0-alpha\.15'/)
  const head = commit(root, 'Generated release')
  assert.equal(await sourceDigest(root, head), marker.sourceDigest)
  const state = await releaseState(root, head)
  assert.equal(state.eligible, true)
  assert.equal(state.reason, 'versioned-release')
  assert.match(state.releasePlanSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual((await releasePlan(root)).pendingChangesets, [])
  assert.equal((await checkRelease(root, base)).mode, 'versioned')

  await note(root, 'jig-followup', ['@jigging/jig'])
  await put(root, 'packages/jig/src/index.ts', 'export const value = 3\n')
  const secondBase = commit(root, 'New feature after release')
  assert.equal((await releaseState(root, secondBase)).reason, 'pending-changesets')
  await checkRelease(root, head)
  const second = await releasePlan(root)
  assert.deepEqual(
    second.releases.map(({ name, newVersion }) => [name, newVersion]),
    [['@jigging/jig', '0.1.0-alpha.39']],
  )
  await versionRelease(root)
  commit(root, 'Second generated release')
  assert.equal((await checkRelease(root, secondBase)).eligible, true)
})

test('feature-only clones and detached checkouts generate and replay without a local main', async (t) => {
  const { root } = await fixture(t)
  git(root, ['checkout', '--quiet', '-b', 'release-feature'])
  await note(root, 'committed-method-fix', ['@jigging/agent-method'])
  const base = commit(root)
  const temporary = await mkdtemp(join(tmpdir(), 'jig-release-clone-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))

  for (const detached of [false, true]) {
    const checkout = join(temporary, detached ? 'detached' : 'feature')
    git(root, [
      'clone',
      '--quiet',
      '--single-branch',
      '--branch',
      'release-feature',
      root,
      checkout,
    ])
    for (const [name, value] of [
      ['user.name', 'Release Test'],
      ['user.email', 'release-test@localhost'],
      ['commit.gpgsign', 'false'],
      ['core.hooksPath', '/dev/null'],
    ])
      git(checkout, ['config', name, value])
    await copyFile(join(root, 'bun.lock'), join(checkout, 'bun.lock'))
    if (detached) git(checkout, ['checkout', '--quiet', '--detach', base])
    assert.equal(git(checkout, ['for-each-ref', '--format=%(refname)', 'refs/heads/main']), '')

    const plan = await releasePlan(checkout)
    assert.deepEqual(plan.pendingChangesets, ['committed-method-fix'])
    assert.equal(plan.releases.length, 3, 'committed notes and their dependents stay in the plan')
    const marker = await versionRelease(checkout)
    assert.deepEqual(marker.releases, plan.releases)
    assert.equal(marker.baseRevision, base)
    const head = commit(checkout, 'Generated release without main')
    assert.equal((await releaseState(checkout, head)).eligible, true)
    assert.equal((await checkRelease(checkout, base)).mode, 'versioned')
    assert.equal(git(checkout, ['for-each-ref', '--format=%(refname)', 'refs/heads/main']), '')
  }
})

test('qualification input releases propagate to Jig without adding publication selectors', async (t) => {
  const { root } = await fixture(t)
  await note(root, 'renderer-fix', ['@jigging/display-web'])
  commit(root)
  const plan = await releasePlan(root)
  assert.deepEqual(
    plan.releases.map(({ name }) => name),
    ['@jigging/display-web', '@jigging/jig'],
  )
  assert.deepEqual(
    plan.publicationPackages.map(({ kind }) => kind),
    ['agent-method', 'agent-acp', 'jig'],
  )
  await versionRelease(root)
  assert.equal((await get(root, 'packages/display-web/package.json')).version, '0.1.0-alpha.2')
  assert.equal(
    (await get(root, 'packages/jig/package.json')).devDependencies['@jigging/display-web'],
    '0.1.0-alpha.2',
  )
})

test('manual versions, changelogs, removed intent, and external package notes fail', async (t) => {
  const { root, base } = await fixture(t)
  const value = await get(root, 'packages/jig/package.json')
  value.version = '0.1.0-alpha.38'
  await put(root, 'packages/jig/package.json', value)
  commit(root)
  await assert.rejects(checkRelease(root, base), /versions manually/)
  value.version = '0.1.0-alpha.37'
  await put(root, 'packages/jig/package.json', value)
  const changelogBase = commit(root)
  await put(root, 'packages/jig/CHANGELOG.md', 'Invented release.\n')
  commit(root)
  await assert.rejects(checkRelease(root, changelogBase), /generated package changelogs/)
  await rm(join(root, 'packages/jig/CHANGELOG.md'))
  await note(root, 'keep-intent', ['@jigging/jig'])
  const intentBase = commit(root)
  await rm(join(root, '.changeset/keep-intent.md'))
  commit(root)
  await assert.rejects(checkRelease(root, intentBase), /Pending changeset keep-intent changed/)
  await note(root, 'external-flow', ['@jigging/flow'])
  commit(root)
  await assert.rejects(releasePlan(root), /owned npm package/)
})

test('fresh source and exact replay reject stale, malformed, and fabricated release plans', async (t) => {
  const { root } = await fixture(t)
  await note(root, 'jig-fix', ['@jigging/jig'])
  const base = commit(root)
  await versionRelease(root)
  const release = commit(root)
  await put(root, 'README.md', 'Later source change.\n')
  let head = commit(root)
  assert.equal((await releaseState(root, head)).reason, 'stale-release-plan')
  await assert.rejects(checkRelease(root, base), /differs from the generated/)
  await put(root, '.changeset/release.json', { schemaVersion: 1 })
  head = commit(root)
  await assert.rejects(releaseState(root, head), /Malformed generated release plan/)

  git(root, ['checkout', '--quiet', '--detach', release])
  const marker = await get(root, '.changeset/release.json')
  const value = await get(root, 'packages/jig/package.json')
  value.version = '0.1.0-alpha.99'
  await put(root, 'packages/jig/package.json', value)
  marker.releases[0].newVersion = value.version
  marker.sourceDigest = await sourceDigest(root)
  await put(root, '.changeset/release.json', marker)
  commit(root, 'Fabricated matching marker')
  await assert.rejects(checkRelease(root, base), /differs from the generated/)
})

test('a release PR must regenerate after its target base advances', async (t) => {
  const { root } = await fixture(t)
  await note(root, 'jig-fix', ['@jigging/jig'])
  const base = commit(root)
  git(root, ['checkout', '--quiet', '-b', 'release-test'])
  await versionRelease(root)
  commit(root, 'Generated release')
  git(root, ['checkout', '--quiet', 'main'])
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), base)
  await put(root, 'README.md', 'Concurrent source change.\n')
  const advanced = commit(root)
  git(root, ['merge', '--quiet', '--no-ff', '-m', 'Simulated PR merge', 'release-test'])
  await assert.rejects(checkRelease(root, advanced), /Release plan is stale/)
})

test('unsupported note-only filenames fail instead of silently losing release intent', async (t) => {
  const { root, base } = await fixture(t)
  await put(root, '.changeset/.hidden.md', 'Hidden files are not Changesets notes.\n')
  await put(root, '.changeset/README.md', 'Release documentation.\n')
  await put(root, '.changeset/AGENTS.md', 'Release guidance.\n')
  const notesBase = commit(root)
  assert.deepEqual((await checkRelease(root, base)).changesets, [])
  assert.deepEqual((await releasePlan(root)).pendingChangesets, [])
  await note(root, 'fix.acp', ['@jigging/agent-acp'])
  const head = commit(root)
  await assert.rejects(
    checkRelease(root, notesBase),
    /Unsupported changeset filename: fix\.acp\.md/,
  )
  await assert.rejects(releasePlan(root), /Unsupported changeset filename: fix\.acp\.md/)
  await assert.rejects(releaseState(root, head), /Unsupported changeset filename: fix\.acp\.md/)
  await rm(join(root, '.changeset/fix.acp.md'))
  await note(root, 'fix acp', ['@jigging/agent-acp'])
  commit(root)
  await assert.rejects(checkRelease(root, notesBase), /Unsupported changeset filename: fix acp\.md/)
})
