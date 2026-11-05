// Version and build the reviewed source in a disposable checkout, then use real npm.
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildCandidates } from '../ci/build-candidates.mjs'
import { verifyCandidateBundle } from '../ci/candidate-provenance.mjs'
import { versionRelease } from './cli.mjs'
import { command, npmEnvironment, startRegistry } from './registry.mjs'
import { git, sha256 } from './state.mjs'

const repository = resolve(import.meta.dirname, '../..')
const root = await mkdtemp(join(tmpdir(), 'jig-release-rehearsal-'))
let registry
try {
  if (process.argv.length !== 2) throw Error('Use node scripts/release/rehearse.mjs')
  const sourceRevision = git(repository, ['rev-parse', 'HEAD']).trim()
  if (git(repository, ['status', '--porcelain', '--untracked-files=no']).trim())
    throw Error('Commit the source before its full release rehearsal')
  const source = join(root, 'source')
  git(repository, ['clone', '--quiet', '--shared', '--no-checkout', repository, source])
  git(source, ['checkout', '--quiet', '--detach', sourceRevision])
  git(source, ['config', 'core.hooksPath', '/dev/null'])
  git(source, ['config', 'commit.gpgsign', 'false'])
  git(source, ['config', 'user.name', 'Release Rehearsal'])
  git(source, ['config', 'user.email', 'release-rehearsal@localhost'])
  await copyFile(join(repository, 'bun.lock'), join(source, 'bun.lock'))
  // Ensure even a source without pending intent exercises actual version generation.
  await writeFile(
    join(source, '.changeset/registry-rehearsal.md'),
    '---\n"@jigging/agent-method": patch\n"@jigging/agent-acp": patch\n"@jigging/jig": patch\n---\n\nExercise the release path in a disposable registry.\n',
    { flag: 'wx' },
  )
  git(source, ['add', '.changeset/registry-rehearsal.md'])
  git(source, ['commit', '--quiet', '-m', 'Local rehearsal intent'])
  await versionRelease(source, { cli: join(repository, 'node_modules/@changesets/cli/bin.js') })
  git(source, ['add', '--all'])
  git(source, ['commit', '--quiet', '-m', 'Local generated release'])
  const generatedRevision = git(source, ['rev-parse', 'HEAD']).trim()
  const bundle = join(root, 'candidates')
  await buildCandidates(bundle, { repository: source })
  const receipt = await verifyCandidateBundle(bundle, { sourceRevision: generatedRevision })
  if (!receipt.release.eligible) throw Error('Rehearsal did not generate an eligible release')
  registry = await startRegistry(join(root, 'registry'), { externalDependencies: true })
  await writeFile(join(root, 'empty-npmrc'), '')
  const env = npmEnvironment(root, registry.userconfig)
  const npm = async (...args) => {
    const result = await command('npm', [...args, '--registry', registry.registry], {
      cwd: root,
      env,
    })
    if (result.status !== 0) throw Error(result.stdout + result.stderr)
    return result
  }
  // Seed qualification dependencies into this registry only. No production selector changes.
  for (const pkg of receipt.packages.filter(
    ({ kind }) => !['agent-method', 'agent-acp', 'jig'].includes(kind),
  ))
    await npm(
      'publish',
      join(bundle, pkg.archive),
      '--access',
      'public',
      '--tag',
      'alpha',
      '--ignore-scripts',
      '--provenance=false',
    )
  const output = join(root, 'output')
  await writeFile(output, '')
  const publishEnv = {
    ...env,
    RUNNER_TEMP: root,
    SOURCE_REVISION: generatedRevision,
    EXPECTED_RECEIPT_SHA256: sha256(await readFile(join(bundle, 'CANDIDATE.json'))),
    RELEASE_GROUP: 'host',
    GITHUB_OUTPUT: output,
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await command(
      'sh',
      [join(repository, 'scripts/release/publish.sh'), '--rehearsal', registry.registry],
      { cwd: root, env: publishEnv },
    )
    if (result.status !== 0) throw Error(result.stdout + result.stderr)
  }
  const consumer = join(root, 'consumer')
  await mkdir(consumer)
  await writeFile(join(consumer, 'package.json'), '{"private":true}\n')
  const jig = receipt.packages.find(({ kind }) => kind === 'jig')
  await npm(
    'install',
    '--prefix',
    consumer,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `${jig.name}@${jig.version}`,
  )
  const installed = await command(join(consumer, 'node_modules/.bin/jig'), ['--version'], {
    cwd: consumer,
    env,
  })
  if (installed.status !== 0 || !installed.stdout.includes(jig.version))
    throw Error('The ordinary installed CLI did not report its candidate version')
  const summary =
    `## Release rehearsal passed\n\nReviewed source: ${sourceRevision}\n\n` +
    `Disposable generated source: ${generatedRevision}\n\n` +
    'Real version generation, candidate construction, npm publication, exact-byte retry and ordinary CLI installation completed.\n\n' +
    'The registry was local. This result grants no host, provider, npm identity or publication qualification.\n'
  process.stdout.write(summary)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
} finally {
  await registry?.close()
  await rm(root, { recursive: true, force: true })
}
