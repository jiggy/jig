import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  PACKAGE_LAYOUT,
  RELEASE_PACKAGE_LAYOUT,
  writeCandidateReceipt,
} from './candidate-provenance.mjs'

const root = resolve(import.meta.dirname, '../..')

test('Mac qualifier stages and revalidates frozen candidate archives without repacking', {
  timeout: 30_000,
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mac-frozen-candidate-'))
  const repository = join(directory, 'source')
  const canonical = join(directory, 'canonical')
  const scratchRoot = join(directory, 'scratch')
  const copiesLog = join(directory, 'copies.jsonl')
  const consumer = join(directory, 'check-copies.mjs')
  const execute = (command, args) => {
    const result = spawnSync(command, args, {
      cwd: repository,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, LC_ALL: 'C' },
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    return result.stdout.trim()
  }
  try {
    await mkdir(join(repository, 'scripts/ci'), { recursive: true })
    await mkdir(join(repository, 'scripts/release'))
    await mkdir(canonical)
    await mkdir(scratchRoot)
    for (const name of ['qualify-macos-host.sh', 'candidate-provenance.mjs'])
      await copyFile(join(root, 'scripts/ci', name), join(repository, 'scripts/ci', name))
    await copyFile(
      join(root, 'scripts/release/catalog.mjs'),
      join(repository, 'scripts/release/catalog.mjs'),
    )
    const source = await readFile(join(repository, 'scripts/ci/qualify-macos-host.sh'), 'utf8')
    const section = (start, end) => {
      const first = source.indexOf(start)
      const last = source.indexOf(end)
      assert.ok(first >= 0 && last > first, `Missing or reordered archive section: ${start}`)
      assert.equal(
        source.indexOf(start, first + start.length),
        -1,
        'Archive section start must be unique',
      )
      assert.equal(source.indexOf(end, last + end.length), -1, 'Archive section end must be unique')
      return source.slice(first, last)
    }
    // Execute only the archive boundary. Native admission, probes and residue
    // checks remain mandatory in the complete host workflow.
    const verification = section(
      'source_revision=$(git rev-parse HEAD)\n',
      'if [[ "$mode" == preflight ]]; then exit 0; fi\n',
    )
    const finishChecks = section(
      '  if [[ -f "$scratch/SHA256SUMS" ]]',
      '  snapshot > "$scratch/after"\n',
    )
    const finishCleanup = section('  if [[ "$status" == 0 ]]; then\n', '}\ntrap finish EXIT\n')
    const staging = section(
      '# Hosted qualification receives the canonical publication bytes.',
      'export JIG_MACOS_PROCESS_TEST=1\n',
    )
    const program = `set -euo pipefail
${verification}
scratch="$ARCHIVE_SCRATCH"
finish() {
  status=$?
${finishChecks}
${finishCleanup}
}
trap finish EXIT
${staging}
"$JIG_AUTHORING_NODE_PATH" "$ARCHIVE_CONSUMER"
`
    await writeFile(
      consumer,
      `
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
const copies = []
for (const [kind, variable] of Object.entries(${JSON.stringify({ 'flow-sdk': 'FLOW_SDK_PACKAGE_ARCHIVE', reporting: 'REPORTING_PACKAGE_ARCHIVE', 'agent-method': 'AGENT_METHOD_PACKAGE_ARCHIVE', 'agent-acp': 'AGENT_ACP_PACKAGE_ARCHIVE', 'display-model': 'DISPLAY_MODEL_PACKAGE_ARCHIVE', 'display-web': 'DISPLAY_WEB_PACKAGE_ARCHIVE', 'display-tui': 'DISPLAY_TUI_PACKAGE_ARCHIVE', jig: 'JIG_PACKAGE_ARCHIVE' })})) {
  const copied = process.env[variable]
  const original = join(process.env.JIG_CI_CANDIDATE_DIRECTORY, kind, kind + '.tgz')
  assert.ok(copied && isAbsolute(copied))
  assert.ok(relative(process.env.ARCHIVE_SCRATCH, copied).startsWith(kind + '/'))
  assert.ok(readFileSync(copied).equals(readFileSync(original)))
  const held = statSync(copied), supplied = statSync(original)
  assert.ok(held.dev !== supplied.dev || held.ino !== supplied.ino)
  copies.push(kind)
}
appendFileSync(process.env.ARCHIVE_COPIES_LOG, JSON.stringify(copies) + '\\n')
if (process.env.ARCHIVE_MUTATION === 'copy') appendFileSync(process.env.JIG_PACKAGE_ARCHIVE, 'changed')
if (process.env.ARCHIVE_MUTATION === 'canonical') appendFileSync(join(process.env.JIG_CI_CANDIDATE_DIRECTORY, 'jig/jig.tgz'), 'changed')
`,
    )
    execute('git', ['init', '-q'])
    execute('git', ['add', 'scripts'])
    execute('git', [
      '-c',
      'user.name=Candidate fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'candidate fixture',
    ])
    const revision = execute('git', ['rev-parse', 'HEAD'])
    for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
      const contents = join(directory, 'contents', kind)
      await mkdir(join(contents, 'package'), { recursive: true })
      await mkdir(join(canonical, kind))
      await writeFile(
        join(contents, 'package/package.json'),
        JSON.stringify({ name, version: '0.1.0-alpha.1' }),
      )
      const archive = join(canonical, kind, `${kind}.tgz`)
      execute('tar', ['-czf', archive, '-C', contents, 'package'])
      const bytes = await readFile(archive)
      await writeFile(
        `${archive}.sha256`,
        `${createHash('sha256').update(bytes).digest('hex')}  ${kind}.tgz\n`,
      )
      await writeFile(
        `${archive}.files`,
        `${execute('tar', ['-tzf', archive]).split('\n').sort().join('\n')}\n`,
      )
    }
    await mkdir(join(canonical, 'resolution'))
    await writeFile(join(canonical, 'resolution/bun.lock'), 'fixture dependency resolution')
    await writeCandidateReceipt({
      root: canonical,
      sourceRevision: revision,
      release: {
        schemaVersion: 1,
        sourceRevision: revision,
        eligible: false,
        reason: 'feature-source',
        packages: Object.entries(RELEASE_PACKAGE_LAYOUT).map(([kind, name]) => ({
          kind,
          name,
          version: '0.1.0-alpha.1',
        })),
        pendingPackages: [],
      },
      producer: {
        repository: 'local/local',
        workflowPath: '.github/workflows/ci.yml',
        runId: 0,
        runAttempt: 0,
        event: 'local',
        headSha: revision,
        headBranch: 'local',
        headRepository: 'local/local',
      },
      buildProfile: {
        version: '1.3.3',
        revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
        platform: 'linux',
        architecture: 'x64',
        nodeVersion: process.versions.node,
        npmVersion: '11.6.2',
        justVersion: 'just 1.43.1',
      },
      resolutionFiles: ['resolution/bun.lock'],
    })
    let attempt = 0
    const run = async (mutation = '') => {
      const scratch = join(scratchRoot, String(attempt++))
      await mkdir(scratch)
      return spawnSync('/bin/bash', ['-x', '-c', program], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          LC_ALL: 'C',
          JIG_AUTHORING_NODE_PATH: process.execPath,
          JIG_CI_CANDIDATE_DIRECTORY: canonical,
          ARCHIVE_SCRATCH: scratch,
          ARCHIVE_CONSUMER: consumer,
          ARCHIVE_COPIES_LOG: copiesLog,
          ARCHIVE_MUTATION: mutation,
        },
      })
    }
    const records = async () =>
      (await readFile(copiesLog, 'utf8')).trim().split('\n').map(JSON.parse)
    const staged = await run()
    assert.equal(staged.status, 0, staged.stderr)
    assert.deepEqual(await records(), [Object.keys(PACKAGE_LAYOUT)])
    assert.deepEqual(await readdir(scratchRoot), [])
    const extraArchive = join(canonical, 'jig/extra.tgz')
    await copyFile(join(canonical, 'jig/jig.tgz'), extraArchive)
    const ambiguous = await run()
    assert.equal(ambiguous.status, 1, ambiguous.stderr)
    assert.match(ambiguous.stderr, /Expected one canonical jig archive/)
    assert.equal((await records()).length, 1)
    await rm(extraArchive)
    const changedCopy = await run('copy')
    assert.equal(changedCopy.status, 1, changedCopy.stderr)
    assert.match(changedCopy.stdout, /jig\.tgz: FAILED/)
    const changedCanonical = await run('canonical')
    assert.equal(changedCanonical.status, 1, changedCanonical.stderr)
    assert.match(changedCanonical.stderr, /The canonical candidate changed/)
    for (const result of [staged, ambiguous, changedCopy, changedCanonical]) {
      assert.doesNotMatch(result.stderr, /pm pack|scripts\/pack\.ts|npm pack/)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
