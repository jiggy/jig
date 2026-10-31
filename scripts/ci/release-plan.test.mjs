import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import { PACKAGES } from '../release/catalog.mjs'
import { checkRelease, releasePlan, versionRelease } from '../release/cli.mjs'
import { git, releaseState, sourceDigest } from '../release/state.mjs'
import { releaseBase } from './release-base.mjs'

const repository = resolve(import.meta.dirname, '../..')
const changesetsCli = join(repository, 'node_modules/@changesets/cli/bin.js')
const json = (value) => `${JSON.stringify(value, null, 2)}\n`

async function put(root, path, value) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), typeof value === 'string' ? value : json(value))
}

async function get(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'))
}

function stockChangesets(root, args) {
  return execFileSync(process.execPath, [changesetsCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  })
}

async function stockStatus(root) {
  const temporary = await mkdtemp(join(tmpdir(), 'jig-release-stock-status-'))
  try {
    stockChangesets(root, ['status', '--output', join(temporary, 'plan.json')])
    return await get(temporary, 'plan.json')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
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
      engines: { jig: '0.1.0-alpha.37', node: '>=22' },
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
  await put(
    root,
    'packages/display-model/THIRD_PARTY_NOTICES',
    'Third-party fixture notice.\n\n@jigging/reporting 0.1.0-alpha.1 is an exact external dependency under\nMPL-2.0. Preserve the license and source notice.\n',
  )
  return { root, base: commit(root, 'Initial fixture') }
}

test('automatic native scope selects exact generated releases and preserves manual diagnostics', async (t) => {
  const { root } = await fixture(t)
  for (const name of ['state.mjs', 'catalog.mjs'])
    await put(
      root,
      `scripts/release/${name}`,
      await readFile(join(repository, 'scripts/release', name), 'utf8'),
    )
  const workflow = parse(
    await readFile(
      join(repository, '.github/workflows/native-agent-api-qualification.yml'),
      'utf8',
    ),
  )
  const step = workflow.jobs.scope.steps.find((entry) => entry.id === 'release')
  const directory = join(root, '.tmp/native-scope')
  await mkdir(directory, { recursive: true })
  const output = join(directory, 'output')
  const summary = join(directory, 'summary')
  async function select(source, event = 'workflow_run') {
    await writeFile(output, '')
    await writeFile(summary, '')
    execFileSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
        GITHUB_EVENT_NAME: event,
        SOURCE_REVISION: source,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
      },
      encoding: 'utf8',
      timeout: 10_000,
      stdio: 'pipe',
    })
    return { output: await readFile(output, 'utf8'), summary: await readFile(summary, 'utf8') }
  }
  const feature = commit(root, 'Native scope source')
  assert.deepEqual(await select(feature), {
    output: 'qualify=false\n',
    summary: `## Native qualification source\n\nSource: ${feature}\n\nOmitted: feature-source.\n\nSource selection creates no qualification evidence. Publication still requires all three native clients.\n`,
  })
  await note(root, 'native-scope-change', ['@jigging/jig'])
  const pending = commit(root, 'Pending release')
  assert.equal((await select(pending)).output, 'qualify=false\n')
  assert.match((await select(pending)).summary, /Omitted: pending-changesets/)
  await versionRelease(root)
  const release = commit(root, 'Generated release')
  assert.equal((await select(release)).output, 'qualify=true\n')
  await put(root, 'README.md', 'Unrelated documentation changes.\n')
  const stale = commit(root, 'Advance complete source')
  assert.equal((await select(stale)).output, 'qualify=false\n')
  assert.match((await select(stale)).summary, /Omitted: stale-release-plan/)
  assert.equal(
    (await select(release)).output,
    'qualify=true\n',
    'Select the triggering source, not the newer checkout',
  )
  assert.equal((await select(stale, 'workflow_dispatch')).output, 'qualify=true\n')
  await put(root, '.changeset/release.json', '{malformed\n')
  const malformed = commit(root, 'Malformed release metadata')
  await assert.rejects(select(malformed))
  assert.equal(
    await readFile(output, 'utf8'),
    '',
    'Invalid automatic source cannot select live jobs',
  )
  const manual = await select(malformed, 'workflow_dispatch')
  assert.equal(manual.output, 'qualify=true\n')
  assert.match(manual.summary, /Selected: explicit manual diagnostics/)
})

test('release Git joins real automatic maintenance before temporary repository cleanup', async (t) => {
  const { root } = await fixture(t)
  for (const [name, value] of [
    ['maintenance.auto', 'true'],
    ['maintenance.autoDetach', 'true'],
    ['gc.autoDetach', 'true'],
    ['maintenance.strategy', 'incremental'],
    ['maintenance.commit-graph.enabled', 'true'],
    ['maintenance.commit-graph.auto', '-1'],
    ['maintenance.gc.enabled', 'false'],
    ['maintenance.loose-objects.enabled', 'false'],
    ['maintenance.incremental-repack.enabled', 'false'],
    ['maintenance.prefetch.enabled', 'false'],
  ])
    git(root, ['config', name, value])
  const configuration = git(root, ['config', '--local', '--list'])
  await put(root, 'README.md', 'Exercise real automatic maintenance.\n')
  git(root, ['add', '.'])
  const trace = join(root, '.git', 'maintenance-trace.jsonl')
  git(root, ['commit', '--quiet', '-m', 'Trigger automatic maintenance'], {
    env: { ...process.env, GIT_TRACE2_EVENT: trace },
  })

  const events = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse)
  const starts = events.filter(({ event }) => event === 'start')
  assert.ok(starts.some(({ argv }) => argv.includes('maintenance')))
  assert.ok(starts.some(({ argv }) => argv.includes('commit-graph') && argv.includes('write')))
  assert.equal(
    events.some(({ category, label }) => category === 'maintenance' && label === 'detach'),
    false,
    'Automatic maintenance must not detach from the owning Git invocation',
  )
  for (const { sid } of starts) {
    assert.ok(
      events.some((event) => event.event === 'atexit' && event.sid === sid && event.code === 0),
      'Every real Git child must finish successfully before the owning call returns',
    )
  }
  const ownerExit = events.findIndex(
    ({ event, sid }) => event === 'atexit' && sid === starts[0].sid,
  )
  assert.ok(events.slice(ownerExit + 1).every(({ event }) => event !== 'atexit'))
  const graphs = await readdir(join(root, '.git', 'objects', 'info', 'commit-graphs'))
  assert.ok(graphs.includes('commit-graph-chain'))
  assert.ok(graphs.some((name) => /^graph-[a-f0-9]+\.graph$/.test(name)))
  assert.ok(graphs.every((name) => !name.endsWith('.lock') && !name.startsWith('tmp_')))
  git(root, ['commit-graph', 'verify'])
  assert.equal(git(root, ['config', '--local', '--list']), configuration)
})

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

test('candidate builder coverage includes every package each builder can change', async (t) => {
  const protectedNames = ['@jigging/agent-acp', '@jigging/agent-method', '@jigging/jig']
  const qualificationNames = [
    '@jigging/display-model',
    '@jigging/display-tui',
    '@jigging/display-web',
    '@jigging/reporting',
  ]
  for (const [path, expected] of [
    ['scripts/ci/build-candidates.mjs', [...protectedNames, ...qualificationNames].sort()],
    ['scripts/build-agent-candidate.ts', protectedNames],
  ]) {
    const { root, base } = await fixture(t)
    await put(root, path, '// Changed package archive construction.\n')
    await note(root, 'protected-builder-change', protectedNames)
    commit(root)
    if (path === 'scripts/ci/build-candidates.mjs') {
      await assert.rejects(
        checkRelease(root, base),
        /Missing new changesets for: @jigging\/display-model, @jigging\/display-tui, @jigging\/display-web, @jigging\/reporting/,
      )
      await note(root, 'qualification-builder-change', qualificationNames)
      commit(root)
    }
    assert.deepEqual((await checkRelease(root, base)).affectedPackages, expected)
    assert.deepEqual(
      (await releasePlan(root)).releases.map(({ name }) => name),
      expected,
    )
  }
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
    assert.deepEqual(value.engines, { jig: '0.1.0-alpha.38', node: '>=22' })
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
  const noticePath = join(root, 'packages/display-model/THIRD_PARTY_NOTICES')
  const notice = await readFile(noticePath, 'utf8')
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
  assert.equal(await readFile(noticePath, 'utf8'), notice)
})

test('Reporting releases synchronize the shipped notice and dependent display versions', async (t) => {
  const { root } = await fixture(t)
  const path = 'packages/display-model/THIRD_PARTY_NOTICES'
  const before = await readFile(join(root, path), 'utf8')
  await note(root, 'reporting-change', ['@jigging/reporting'])
  const base = commit(root)
  const marker = await versionRelease(root)
  assert.deepEqual(
    Object.fromEntries(marker.releases.map(({ name, newVersion }) => [name, newVersion])),
    {
      '@jigging/display-model': '0.1.0-alpha.2',
      '@jigging/display-tui': '0.1.0-alpha.2',
      '@jigging/display-web': '0.1.0-alpha.2',
      '@jigging/jig': '0.1.0-alpha.38',
      '@jigging/reporting': '0.1.0-alpha.2',
    },
  )
  assert.equal(
    await readFile(join(root, path), 'utf8'),
    before.replace('@jigging/reporting 0.1.0-alpha.1', '@jigging/reporting 0.1.0-alpha.2'),
  )
  for (const kind of ['display-model', 'display-web', 'display-tui'])
    assert.equal(
      (await get(root, `packages/${kind}/package.json`)).dependencies['@jigging/reporting'],
      '0.1.0-alpha.2',
    )
  const head = commit(root, 'Generated Reporting release')
  assert.equal(await sourceDigest(root, head), marker.sourceDigest)
  assert.equal((await checkRelease(root, base)).mode, 'versioned')
})

test('release generation refuses missing or ambiguous canonical Reporting declarations', async (t) => {
  for (const duplicate of [false, true]) {
    const { root } = await fixture(t)
    const path = 'packages/display-model/THIRD_PARTY_NOTICES'
    const original = await readFile(join(root, path), 'utf8')
    await put(root, path, duplicate ? `${original}\n${original}` : 'No dependency declaration.\n')
    await note(root, 'reporting-change', ['@jigging/reporting'])
    commit(root)
    await assert.rejects(
      versionRelease(root),
      /Reporting notice must have one canonical dependency version/,
    )
  }
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

test('feature release checks exclude target changes made after the event base', async (t) => {
  const { root, base: eventBase } = await fixture(t)
  git(root, ['checkout', '--quiet', '-b', 'feature-test'])
  await put(root, 'packages/agent-method/src/index.ts', 'export const value = 2\n')
  await note(root, 'method-pr-fix', ['@jigging/agent-method'])
  const head = commit(root, 'Covered feature change')

  git(root, ['checkout', '--quiet', 'main'])
  const jig = await get(root, 'packages/jig/package.json')
  jig.version = '0.1.0-alpha.38'
  await put(root, 'packages/jig/package.json', jig)
  const advanced = commit(root, 'Concurrent target version bump')
  git(root, ['merge', '--quiet', '--no-ff', '-m', 'Test PR against current target', 'feature-test'])
  const source = git(root, ['rev-parse', 'HEAD']).trim()
  await assert.rejects(checkRelease(root, eventBase), /versions manually/)

  const selected = releaseBase({
    repository: root,
    env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: source },
    event: { pull_request: { base: { sha: eventBase }, head: { sha: head } } },
  })
  assert.equal(selected, advanced)
  const checked = await checkRelease(root, selected)
  assert.equal(checked.mode, 'feature')
  assert.deepEqual(checked.affectedPackages, ['@jigging/agent-method'])
  assert.deepEqual(checked.changesets, ['method-pr-fix'])
})

test('generated release replay rejects an empty target advance despite matching source bytes', async (t) => {
  const { root } = await fixture(t)
  await note(root, 'jig-fix', ['@jigging/jig'])
  const base = commit(root)
  git(root, ['checkout', '--quiet', '-b', 'release-test'])
  const marker = await versionRelease(root)
  const head = commit(root, 'Generated release')

  git(root, ['checkout', '--quiet', 'main'])
  git(root, ['commit', '--quiet', '--allow-empty', '-m', 'Advance target without source edits'])
  const advanced = git(root, ['rev-parse', 'HEAD']).trim()
  assert.notEqual(advanced, base)
  git(root, [
    'merge',
    '--quiet',
    '--no-ff',
    '-m',
    'Test stale release against target',
    'release-test',
  ])
  const source = git(root, ['rev-parse', 'HEAD']).trim()
  assert.equal(await sourceDigest(root, source), marker.sourceDigest)

  const selected = releaseBase({
    repository: root,
    env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: source },
    event: { pull_request: { base: { sha: base }, head: { sha: head } } },
  })
  assert.equal(selected, advanced)
  await assert.rejects(checkRelease(root, selected), /Release plan is stale/)
})

test('unsupported note-only filenames fail instead of silently losing release intent', async (t) => {
  const { root, base } = await fixture(t)
  await put(root, '.changeset/.hidden.md', 'Hidden files are not Changesets notes.\n')
  await put(root, '.changeset/README.md', 'Release documentation.\n')
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

test('guidance filenames fail before planning or versioning, regardless of case', async (t) => {
  const stockIgnores = new Set(['AGENTS', 'CLAUDE', 'GEMINI'])
  for (const id of [
    'AGENTS',
    'agents',
    'Agents',
    'CLAUDE',
    'claude',
    'Claude',
    'GEMINI',
    'gemini',
    'Gemini',
  ]) {
    const { root, base } = await fixture(t)
    await note(root, id, ['@jigging/jig'])
    const head = commit(root)
    const status = await stockStatus(root)
    const stockConsumes = !stockIgnores.has(id)
    assert.deepEqual(
      status.changesets.map(({ id }) => id),
      stockConsumes ? [id] : [],
    )

    const expected = {
      message: `Guidance file .changeset/${id}.md is not a release note. Move its instructions outside .changeset/.`,
    }
    await assert.rejects(checkRelease(root, base), expected)
    await assert.rejects(releasePlan(root), expected)
    await assert.rejects(releaseState(root, head), expected)
    await assert.rejects(versionRelease(root), expected)
    assert.equal(git(root, ['status', '--porcelain']), '', 'refusal must precede version edits')

    if (stockConsumes) stockChangesets(root, ['version'])
    else
      assert.throws(
        () => stockChangesets(root, ['version']),
        (error) => error.status === 1 && /No unreleased changesets found/.test(error.stdout),
      )
    assert.equal(
      (await get(root, 'packages/jig/package.json')).version,
      stockConsumes ? '0.1.0-alpha.38' : '0.1.0-alpha.37',
    )
    const retained = `.changeset/${stockConsumes ? 'pre/' : ''}${id}.md`
    assert.match(await readFile(join(root, retained), 'utf8'), /Fix the package behavior/)
  }
})

test('README spelling, hidden files, and extension filters agree with real status and version', async (t) => {
  for (const readme of ['README.md', 'readme.md', 'ReadMe.md']) {
    const { root } = await fixture(t)
    const ignored = ['.hidden.md', '.AGENTS.md', 'ignored.MD', readme]
    for (const filename of ignored)
      await put(root, `.changeset/${filename}`, 'This is not release frontmatter.\n')
    await note(root, 'normal-note', ['@jigging/jig'])
    const base = commit(root)
    const status = await stockStatus(root)
    const plan = await releasePlan(root)
    assert.deepEqual(
      status.changesets.map(({ id }) => id),
      ['normal-note'],
    )
    assert.deepEqual(plan.pendingChangesets, ['normal-note'])
    assert.deepEqual(
      plan.releases,
      status.releases.map(({ name, type, oldVersion, newVersion }) => ({
        name,
        type,
        oldVersion,
        newVersion,
      })),
    )
    const marker = await versionRelease(root)
    assert.deepEqual(marker.releases, plan.releases)
    assert.deepEqual(
      marker.changesets.map(({ id }) => id),
      ['normal-note'],
    )
    const head = commit(root)
    assert.equal((await releaseState(root, head)).eligible, true)
    assert.equal((await checkRelease(root, base)).mode, 'versioned')
    assert.deepEqual((await releasePlan(root)).pendingChangesets, [])
    for (const filename of ignored)
      assert.ok(await readFile(join(root, `.changeset/${filename}`), 'utf8'))
  }
})
