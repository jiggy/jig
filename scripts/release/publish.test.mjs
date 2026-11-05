import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { PACKAGES } from './catalog.mjs'
import { versionRelease } from './cli.mjs'
import { command, npmEnvironment, startRegistry } from './registry.mjs'
import { git, releaseState } from './state.mjs'

const repository = resolve(import.meta.dirname, '../..')
const kinds = ['agent-method', 'agent-acp', 'semantic-router', 'jig']
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (value) => JSON.stringify(value, null, 2) + '\n'
async function put(root, path, value) {
  const file = join(root, path)
  await mkdir(resolve(file, '..'), { recursive: true })
  await writeFile(file, typeof value === 'string' ? value : json(value))
}
async function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result
}
async function fixture(_t, scenario, { largeArchive = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'jig-publish-real-'))
  let registry
  try {
    registry = await startRegistry(join(root, 'registry'))
    const env = npmEnvironment(root, registry.userconfig)
    await writeFile(join(root, 'empty-npmrc'), '')
    const source = join(root, 'source')
    await mkdir(source)
    git(source, ['init', '--quiet', '--initial-branch=main'])
    git(source, ['config', 'user.name', 'Release Rehearsal'])
    git(source, ['config', 'user.email', 'release@localhost'])
    git(source, ['config', 'commit.gpgsign', 'false'])
    git(source, ['config', 'core.hooksPath', '/dev/null'])
    await put(source, '.gitignore', 'bun.lock\nnode_modules/\n')
    await put(source, 'bun.lock', '') // Changesets' workspace marker, not dependency resolution.
    await put(source, 'package.json', {
      name: 'release-rehearsal',
      private: true,
      workspaces: ['packages/*'],
    })
    await mkdir(join(source, '.changeset'))
    await copyFile(
      join(repository, '.changeset/config.json'),
      join(source, '.changeset/config.json'),
    )
    await put(source, '.changeset/pre.json', { mode: 'pre', tag: 'alpha' })
    for (const { name, kind } of PACKAGES) {
      await put(source, `packages/${kind}/package.json`, {
        name,
        version: '0.1.0-alpha.0',
        type: 'module',
        exports: './index.js',
        publishConfig: { access: 'public' },
        scripts: { prepublishOnly: 'exit 97', postinstall: 'exit 98' },
      })
      await put(
        source,
        `packages/${kind}/index.js`,
        `export const packageName = ${JSON.stringify(name)}\n`,
      )
    }
    await put(
      source,
      '.changeset/rehearsal.md',
      '---\n"@jigging/agent-method": patch\n---\n\nVerify publication through the real registry.\n',
    )
    git(source, ['add', '.'])
    git(source, ['commit', '--quiet', '-m', 'Reviewed change'])
    await versionRelease(source, { cli: join(repository, 'node_modules/@changesets/cli/bin.js') })
    git(source, ['add', '.'])
    git(source, ['commit', '--quiet', '-m', 'Generated release'])
    const revision = git(source, ['rev-parse', 'HEAD']).trim()
    const release = await releaseState(source, revision)
    assert.equal(release.eligible, true)
    const receipt = { schemaVersion: 2, sourceRevision: revision, release, packages: [] }
    const candidates = join(root, 'candidates')
    const archives = {}
    if (largeArchive)
      await writeFile(join(source, 'packages/jig/payload.bin'), randomBytes(9 * 1024 * 1024))
    for (const kind of kinds) {
      const directory = join(candidates, kind)
      await mkdir(directory, { recursive: true })
      const result = await success(
        await command(
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
          { cwd: join(source, 'packages', kind), env },
        ),
      )
      const [packed] = JSON.parse(result.stdout)
      const archive = join(directory, packed.filename)
      const sha256 = digest(await readFile(archive))
      const manifest = JSON.parse(
        await readFile(join(source, 'packages', kind, 'package.json'), 'utf8'),
      )
      await writeFile(`${archive}.sha256`, `${sha256}  ${basename(archive)}\n`)
      await put(directory, 'SUCCESS.json', { archive: basename(archive), sha256, commit: revision })
      receipt.packages.push({
        kind,
        name: manifest.name,
        version: manifest.version,
        archive: relative(candidates, archive),
        sha256,
      })
      archives[kind] = archive
    }
    await put(candidates, 'CANDIDATE.json', receipt)
    const expected = digest(await readFile(join(candidates, 'CANDIDATE.json')))
    const npm = (...args) =>
      command('npm', [...args, '--registry', registry.registry], { cwd: root, env })
    const publish = async (kind, tag = 'alpha') =>
      success(
        await npm(
          'publish',
          archives[kind],
          '--tag',
          tag,
          '--access',
          'public',
          '--ignore-scripts',
          '--provenance=false',
        ),
      )
    const run = async (extra = {}, args = ['--rehearsal', registry.registry]) => {
      const output = join(root, 'outputs')
      await writeFile(output, '')
      const result = await command(
        'sh',
        [join(repository, 'scripts/release/publish.sh'), ...args],
        {
          cwd: root,
          env: {
            ...env,
            RUNNER_TEMP: root,
            SOURCE_REVISION: revision,
            EXPECTED_RECEIPT_SHA256: expected,
            RELEASE_GROUP: 'host',
            GITHUB_OUTPUT: output,
            ...extra,
          },
        },
      )
      return { ...result, output: await readFile(output, 'utf8') }
    }
    await scenario({ root, source, env, registry, receipt, archives, npm, publish, run })
  } finally {
    await registry?.close()
    await rm(root, { recursive: true, force: true })
  }
}

test(
  'real version generation, packing, publication, exact retry and ordinary installation',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ root, receipt, npm, run }) => {
      const first = await success(await run())
      assert.equal(first.output.match(/_state=published/g)?.length, 4)
      const retry = await success(await run())
      assert.equal(retry.output.match(/_state=verified/g)?.length, 4)
      await put(root, 'consumer/package.json', { private: true, type: 'module' })
      await success(
        await npm(
          'install',
          '--prefix',
          join(root, 'consumer'),
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          ...receipt.packages.map(({ name, version }) => `${name}@${version}`),
        ),
      )
      await put(
        root,
        'consumer/check.mjs',
        receipt.packages
          .map(
            ({ name }, i) =>
              `import {packageName as n${i}} from '${name}'; if(n${i}!==${JSON.stringify(name)})throw Error('Wrong installed package')`,
          )
          .join('\n'),
      )
      await success(await command(process.execPath, [join(root, 'consumer/check.mjs')]))
    }),
)

test(
  'partial publication converges in dependency order after existing-byte verification',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ registry, publish, run }) => {
      await publish('agent-method')
      registry.traffic.length = 0
      const result = await success(await run())
      assert.match(result.output, /agent_state=verified/)
      assert.equal(result.output.match(/_state=published/g)?.length, 3)
      assert.deepEqual(
        registry.traffic
          .filter(({ method }) => method === 'PUT')
          .map(({ path }) => decodeURIComponent(path)),
        ['/@jigging/agent-acp', '/@jigging/semantic-router', '/@jigging/jig'],
      )
    }),
)

test(
  'a conflicting existing archive blocks the entire group before mutation',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ root, source, env, npm, registry, run }) => {
      await put(source, 'packages/jig/index.js', 'export const changed = true\n')
      const destination = join(root, 'collision')
      await mkdir(destination)
      const result = await success(
        await command(
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
          { cwd: join(source, 'packages/jig'), env },
        ),
      )
      const archive = join(destination, JSON.parse(result.stdout)[0].filename)
      await success(
        await npm('publish', archive, '--tag', 'alpha', '--ignore-scripts', '--provenance=false'),
      )
      registry.traffic.length = 0
      const failed = await run()
      assert.notEqual(failed.status, 0)
      assert.match(failed.stderr, /registry bytes differ/)
      assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 0)
    }),
)

test(
  'transport loss after committed publication and delayed reads still converge without another publish',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ registry, run }) => {
      let committed = false,
        hidden = 0
      registry.setFault((request) => {
        if (request.method === 'PUT' && !committed) {
          committed = true
          return { loseResponse: true }
        }
        if (committed && request.method === 'GET' && hidden++ < 2) return { status: 404 }
      })
      const result = await success(await run())
      assert.equal(result.output.match(/_state=published/g)?.length, 4)
      assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 4)
    }),
)

test('authentication refusal cannot become publication success', { timeout: 120_000 }, (t) =>
  fixture(t, async ({ registry, run }) => {
    registry.setFault(({ method }) => (method === 'PUT' ? { status: 403 } : null))
    const result = await run()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /visibility deadline/)
    assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 1)
  }),
)

test(
  'registry read failures block mutation instead of being interpreted as absence',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ registry, run }) => {
      registry.setFault(() => ({ status: 503 }))
      const result = await run()
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /could not determine/)
      assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 0)
    }),
)

test(
  'newer channel versions prevent late publication and preserve exact retries',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ source, root, env, npm, registry, run, publish }) => {
      // Publish genuine newer archives through npm, then reconcile the older group.
      for (const kind of kinds) {
        const path = join(source, 'packages', kind, 'package.json')
        const manifest = JSON.parse(await readFile(path, 'utf8'))
        manifest.version = '0.1.0-alpha.999'
        await writeFile(path, json(manifest))
        const destination = join(root, 'newer', kind)
        await mkdir(destination, { recursive: true })
        const packed = await success(
          await command(
            'npm',
            ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
            { cwd: join(source, 'packages', kind), env },
          ),
        )
        await success(
          await npm(
            'publish',
            join(destination, JSON.parse(packed.stdout)[0].filename),
            '--tag',
            'alpha',
            '--ignore-scripts',
            '--provenance=false',
          ),
        )
      }
      registry.traffic.length = 0
      const older = await success(await run())
      assert.equal(older.output.match(/_state=superseded/g)?.length, 4)
      assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 0)
      // Existing older bytes remain verifiable even with missing or older tags.
      for (const kind of kinds) await publish(kind, 'next')
      registry.traffic.length = 0
      const retry = await success(await run())
      assert.equal(retry.output.match(/_state=verified/g)?.length, 4)
      assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 0)
      for (const { name } of PACKAGES.filter(({ kind }) => kinds.includes(kind))) {
        const tag = await success(await npm('view', name, 'dist-tags.alpha', '--json'))
        assert.equal(JSON.parse(tag.stdout), '0.1.0-alpha.999')
      }
    }),
)

test(
  'tampered evidence and unsafe rehearsal destinations refuse before registry access',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ archives, registry, run }) => {
      for (const extra of [
        { EXPECTED_RECEIPT_SHA256: '0'.repeat(64) },
        { RELEASE_GROUP: 'flow' },
        { OPENROUTER_API_KEY: 'must-not-leave-process' },
      ]) {
        registry.traffic.length = 0
        assert.notEqual((await run(extra)).status, 0)
        assert.equal(registry.traffic.length, 0)
      }
      for (const url of [
        'https://registry.npmjs.org',
        'http://localhost:4873',
        'http://127.0.0.1:80/foreign',
      ])
        assert.notEqual((await run({}, ['--rehearsal', url])).status, 0)
      await writeFile(`${archives['agent-method']}.sha256`, 'tampered\n')
      registry.traffic.length = 0
      const result = await run()
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /digest sidecar does not match/)
      assert.equal(registry.traffic.length, 0)
    }),
)

test(
  'existing bytes with missing or older channel tags finish without channel mutation',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ root, source, env, npm, registry, publish, run }) => {
      for (const kind of kinds) await publish(kind, 'next')
      const path = join(source, 'packages/jig/package.json')
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      manifest.version = '0.1.0-alpha.0'
      await writeFile(path, json(manifest))
      const directory = join(root, 'older')
      await mkdir(directory)
      const packed = await success(
        await command(
          'npm',
          ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
          { cwd: join(source, 'packages/jig'), env },
        ),
      )
      await success(
        await npm(
          'publish',
          join(directory, JSON.parse(packed.stdout)[0].filename),
          '--tag',
          'alpha',
          '--ignore-scripts',
          '--provenance=false',
        ),
      )
      registry.traffic.length = 0
      const result = await success(await run())
      assert.equal(result.output.match(/_state=verified/g)?.length, 4)
      assert.match(result.stderr, /the missing alpha tag cannot be changed/)
      assert.match(result.stderr, /the older alpha tag cannot be changed/)
      assert.equal(registry.traffic.filter(({ method }) => method === 'PUT').length, 0)
    }),
)

test(
  'malformed release plans refuse before external reads even with their supplied receipt digest',
  { timeout: 120_000 },
  (t) =>
    fixture(t, async ({ root, receipt, registry, run }) => {
      for (const change of [
        { eligible: false },
        { pendingPackages: ['@jigging/jig'] },
        { releasePlanSha256: 'invalid' },
        { packages: receipt.release.packages.filter(({ kind }) => kind !== 'semantic-router') },
      ]) {
        const altered = structuredClone(receipt)
        Object.assign(altered.release, change)
        const bytes = json(altered)
        await writeFile(join(root, 'candidates/CANDIDATE.json'), bytes)
        registry.traffic.length = 0
        const result = await run({ EXPECTED_RECEIPT_SHA256: digest(bytes) })
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /candidate does not carry an applied release plan/)
        assert.equal(registry.traffic.length, 0)
      }
    }),
)

test(
  'real publication accepts an archive whose encoded request exceeds Verdaccio defaults',
  { timeout: 120_000 },
  (t) =>
    fixture(
      t,
      async ({ archives, run }) => {
        assert.ok((await readFile(archives.jig)).length > 9 * 1024 * 1024)
        const result = await success(await run())
        assert.equal(result.output.match(/_state=published/g)?.length, 4)
      },
      { largeArchive: true },
    ),
)
