import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'
import { NATIVE_PREREQUISITE_TESTS } from './macos-host-test-shards.mjs'
import { MACOS_PR_SELECTOR_RUNNER, NOOP_STEP_NAMES } from './macos-pr-race.mjs'
import { MAC_PYTHON_MAJOR, MAC_PYTHON_SHARD, pythonInstalledProfiles } from './python-ci-profiles.mjs'
import {
  CI_QUALIFICATION_JOBS,
  LINUX_QUALIFICATION_JOBS,
  MACOS_QUALIFICATION_JOBS,
} from './release-readiness.mjs'

const workflows = new URL('../../.github/workflows/', import.meta.url)
const rootKeys = new Set([
  'name',
  'run-name',
  'on',
  'permissions',
  'env',
  'defaults',
  'concurrency',
  'jobs',
])

async function macScopePlan(workflow, event) {
  const step = workflow.jobs.prepare.steps.find((step) => step.id === 'plan')
  assert.ok(step)
  assert.equal(step.if, "steps.scope.outputs.required == 'true'")
  assert.equal(workflow.jobs.prepare.outputs.workers, '${{ steps.plan.outputs.workers }}')
  assert.equal(workflow.jobs.prepare.outputs.shard_count, '${{ steps.plan.outputs.shard_count }}')
  const directory = await mkdtemp(join(tmpdir(), 'jig-mac-scope-plan-'))
  try {
    const output = join(directory, 'outputs')
    const child = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: join(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        RUNNER_TEMP: directory,
        GITHUB_EVENT_NAME: event,
        GITHUB_OUTPUT: output,
      },
      encoding: 'utf8',
      timeout: 5_000,
    })
    assert.ifError(child.error)
    assert.equal(child.status, 0, child.stderr)
    const outputs = Object.fromEntries(
      (await readFile(output, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => {
          const equals = line.indexOf('=')
          assert.ok(equals > 0)
          return [line.slice(0, equals), line.slice(equals + 1)]
        }),
    )
    const plan = JSON.parse(await readFile(join(directory, 'PLAN.json'), 'utf8'))
    return { outputs, plan }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function runWriterStep(step, env) {
  const directory = await mkdtemp(join(tmpdir(), 'jig-release-summary-'))
  const summary = join(directory, 'summary.md')
  try {
    const result = spawnSync(
      '/bin/bash',
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'jiggy/release-fixture',
          GITHUB_STEP_SUMMARY: summary,
          ...env,
        },
        encoding: 'utf8',
        timeout: 5_000,
      },
    )
    assert.ifError(result.error)
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      summary: await readFile(summary, 'utf8'),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('release readiness requires the current CI job names and matrix', async () => {
  const workflow = parse(await readFile(new URL('ci.yml', workflows), 'utf8'))
  const names = []
  for (const [id, job] of Object.entries(workflow.jobs)) {
    const template = job.name ?? id
    const matrix = job.strategy?.matrix
    const rows = id === 'python-installed'
      ? pythonInstalledProfiles.map((profile) => {
          const [os, python] = profile.split('/python-')
          return { os, python }
        })
      : matrix?.package?.map((name) => ({ package: name })) ?? [{}]
    for (const row of rows)
      names.push(template.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => row[key]))
  }
  for (const required of CI_QUALIFICATION_JOBS)
    assert.ok(names.includes(required), `Missing required CI job: ${required}`)
})

test('installed Python jobs exactly cover the declared evidence profiles', async () => {
  const workflow = parse(await readFile(new URL('ci.yml', workflows), 'utf8'))
  const builder = workflow.jobs['python-build']
  const installed = workflow.jobs['python-installed']
  assert.equal(installed.strategy.matrix, '${{ fromJSON(needs.python-build.outputs.installed-matrix) }}')
  assert.equal(builder.outputs['installed-matrix'], '${{ steps.installed-profiles.outputs.matrix }}')
  assert.equal(
    builder.steps.find(({ id }) => id === 'installed-profiles').run,
    'node scripts/ci/python-ci-profiles.mjs',
  )
})

test('Mac workflow runs only generated useful ARM shards with full native baselines', async () => {
  const workflow = parse(await readFile(new URL('macos-hosted-candidates.yml', workflows), 'utf8'))
  const native = workflow.jobs.prerequisites
  assert.equal(native.strategy['max-parallel'], '${{ fromJSON(needs.prepare.outputs.max_parallel) }}')
  assert.equal(native.strategy['fail-fast'], false)
  assert.equal(native.needs, 'prepare')
  assert.equal(native['runs-on'], '${{ matrix.runner }}')
  assert.equal(
    native['timeout-minutes'],
    '${{ inputs.include_startup_profile && matrix.installed && 65 || 25 }}',
  )
  assert.equal(workflow.jobs.selectors['runs-on'], MACOS_PR_SELECTOR_RUNNER)
  assert.equal(workflow.jobs.selectors['runs-on'], 'ubuntu-24.04')
  assert.ok(workflow.jobs.selectors['timeout-minutes'] > 15)
  assert.equal(native.strategy.matrix, '${{ fromJSON(needs.prepare.outputs.workers) }}')
  assert.equal(native.environment, undefined)
  assert.equal(native['continue-on-error'], "${{ github.event_name == 'pull_request' }}")
  assert.equal(native.env.JIG_MACOS_TEST_PLAN_FILE, undefined)
  assert.ok(native.steps.some((step) => step.run?.includes('JIG_MACOS_TEST_PLAN_FILE=%s')))
  for (const job of Object.values(workflow.jobs))
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /\$\{\{\s*runner\./)
  const baseline = native.steps.find((step) =>
    step.run?.includes('bun test packages/jig/test/macos/'),
  )
  assert.ok(baseline)
  assert.equal(
    baseline.if,
    "${{ github.event_name != 'pull_request' || steps.selection.outputs.winner == 'true' }}",
  )
  const command = /bun test (.+?) --bail=1/.exec(baseline.run)
  assert.ok(command, 'Native baseline must execute one complete unfiltered command')
  assert.deepEqual(command[1].split(/\s+/), NATIVE_PREREQUISITE_TESTS)
  assert.match(baseline.run, /before-native/)
  assert.match(baseline.run, /after-native/)
  assert.match(baseline.run, /diff -u/)
  assert.doesNotMatch(JSON.stringify(workflow), /cohort|allocator|spare|pr-time-budget/)
  const strict = (await macScopePlan(workflow, 'push')).plan
  for (const event of ['pull_request', 'push', 'workflow_dispatch', 'schedule']) {
    const { outputs: output, plan } = await macScopePlan(workflow, event)
    const pr = event === 'pull_request'
    const rows = JSON.parse(output.workers).include
    const count = Number(output.shard_count)
    assert.equal(plan.policy.maxShards, pr ? 5 : 3)
    assert.equal(Number(output.max_parallel), pr ? 10 : 3)
    assert.equal(plan.policy.targetSeconds, pr ? 800 : strict.policy.targetSeconds)
    assert.ok(count <= plan.policy.maxShards)
    if (!pr) assert.equal(count, strict.shards.length)
    assert.equal(plan.inventoryDigest, strict.inventoryDigest)
    const shards = plan.shards.map(({ index }) => index)
    assert.deepEqual(JSON.parse(output.selectors).include, shards.map((shard) => ({ shard })))
    assert.deepEqual([...new Set(rows.map((row) => row.major))], [15, 26])
    if (pr) {
      assert.deepEqual(rows.slice(0, count).map(({ shard }) => shard), shards)
      assert.deepEqual(rows.slice(count).map(({ shard }) => shard), shards.filter((shard) => shard !== MAC_PYTHON_SHARD))
      assert.deepEqual(rows.filter(({ pythonInstalled }) => pythonInstalled).map(({ shard, major }) => [shard, major]), [[MAC_PYTHON_SHARD, MAC_PYTHON_MAJOR]])
      for (const [index, row] of rows.slice(0, count).entries()) {
        assert.equal(row.major, index % 2 === 0 ? 15 : 26)
        if (row.shard !== MAC_PYTHON_SHARD)
          assert.notEqual(row.major, rows.slice(count).find(({ shard }) => shard === row.shard).major)
      }
    } else {
      assert.ok(rows.every(({ pythonInstalled }) => pythonInstalled === false))
    }
    for (const major of new Set(rows.map((row) => row.major))) {
      const selected = rows.filter((row) => row.major === major)
      const required = shards.filter((shard) => !pr || major === MAC_PYTHON_MAJOR || shard !== MAC_PYTHON_SHARD)
      assert.deepEqual(
        selected.map((row) => row.shard).sort((a, b) => a - b),
        required,
      )
      assert.ok(selected.every((row) => row.arch === 'arm64' && row.runner === `macos-${major}`))
      assert.equal(selected.filter((row) => row.installed).length, 1)
    }
  }
  const decide = native.steps.findIndex((step) => step.id === 'race')
  const offer = native.steps.findIndex((step) => step.id === 'offer')
  const resolve = native.steps.findIndex((step) => step.id === 'selection')
  assert.ok(decide >= 0 && offer > decide && resolve > offer)
  assert.equal(native.steps[offer].with.overwrite, false)
  assert.equal(native.steps[offer]['continue-on-error'], undefined)
  assert.match(native.steps[resolve].run, /macos-pr-race.mjs resolve/)
  const python = native.steps.find(({ name }) => name === 'Test installed Python reporting on macOS 15')
  assert.match(python.if, /matrix\.pythonInstalled/)
  assert.match(python.run, /test-installed-python-reporting\.sh/)
  for (const name of NOOP_STEP_NAMES) {
    const step = native.steps.find((step) => step.name === name)
    assert.ok(step, `Missing observable noop step ${name}`)
    assert.equal(step['continue-on-error'], undefined)
  }
  for (const step of native.steps.slice(resolve + 1))
    assert.match(step.if, /steps.selection.outputs.winner == 'true'/)
  const files = await readdir(workflows)
  assert.ok(!files.includes('macos-intel-nightly.yml'))
  assert.ok(!files.includes('macos-host-conformance.yml'))
})

test('release readiness requires every canonical Linux shard including example e2e', async () => {
  const workflow = parse(await readFile(new URL('linux-host-conformance.yml', workflows), 'utf8'))
  const shards = workflow.jobs['host-suite'].strategy.matrix.suite
  assert.ok(shards.includes('examples'))
  assert.deepEqual(LINUX_QUALIFICATION_JOBS, [
    workflow.jobs['affected-linux'].name,
    ...shards.map((suite) => `Linux host — ${suite}`),
  ])
})

test('Linux memory rejection diagnostics cross acquisition into existing retained evidence', async () => {
  const workflow = parse(await readFile(new URL('linux-host-conformance.yml', workflows), 'utf8'))
  const steps = workflow.jobs['host-suite'].steps
  const selected = steps.filter((step) => step.env?.JIG_CI_LINUX_EVIDENCE_DIRECTORY)
  assert.equal(selected.length, 1)
  const hostile = selected[0]
  assert.equal(hostile.if, "matrix.suite == 'installed-evidence'")
  assert.equal(hostile['continue-on-error'], undefined)
  assert.equal(
    hostile.env.JIG_CI_LINUX_EVIDENCE_DIRECTORY,
    '${{ runner.temp }}/linux-command-evidence',
  )
  assert.match(
    hostile.run,
    /run-acquisition-host env "JIG_CI_LINUX_EVIDENCE_DIRECTORY=\$JIG_CI_LINUX_EVIDENCE_DIRECTORY"/,
  )
  assert.match(hostile.run, /scripts\/test-installed-hostile-baseline\.ts/)
  assert.match(hostile.run, /set -euo pipefail/)
  const evidence = steps.find((step) => step.with?.name?.startsWith('linux-shard-'))
  assert.ok(evidence?.uses?.startsWith('actions/upload-artifact@'))
  assert.equal(evidence.if, 'always()')
  assert.equal(evidence.with['retention-days'], 7)
  assert.deepEqual(evidence.with.path.trim().split('\n'), [
    '${{ runner.temp }}/linux-command-evidence',
    '${{ runner.temp }}/linux-shard.complete',
    '${{ runner.temp }}/CANDIDATE.json',
    '${{ runner.temp }}/ARTIFACT.json',
  ])
})

test('Mac acquisition, collection and final gate retain source identity and complete proof', async () => {
  const workflow = parse(await readFile(new URL('macos-hosted-candidates.yml', workflows), 'utf8'))
  const inputs = workflow.jobs.prepare
  assert.equal(inputs['runs-on'], 'ubuntu-24.04')
  assert.equal(inputs.needs, undefined)
  assert.equal(workflow.jobs.scope, undefined)
  assert.equal(workflow.jobs['host-artifacts'], undefined)
  const acquire = inputs.steps.find((step) => step.run?.includes('candidate-transfer.mjs acquire'))
  assert.match(acquire.run, /--source "\$GITHUB_SHA" --producer-timeout-seconds 1800 "\$@"/)
  const scopeIndex = inputs.steps.findIndex((step) => step.id === 'scope')
  assert.equal(inputs.steps[scopeIndex].if, undefined)
  assert.deepEqual(
    inputs.steps.slice(scopeIndex + 1).map((step) => step.if),
    Array(4).fill("steps.scope.outputs.required == 'true'"),
  )
  assert.match(acquire.run, /cp "\$RUNNER_TEMP\/PLAN\.json"/)
  assert.equal(
    inputs.steps.some((step) => step.uses?.startsWith('actions/download-artifact@')),
    false,
  )
  const download = workflow.jobs.prerequisites.steps.find(
    (step) => step.with?.['artifact-ids'] === '${{ needs.prepare.outputs.artifact_id }}',
  )
  assert.equal(download.with['artifact-ids'], '${{ needs.prepare.outputs.artifact_id }}')
  const gate = workflow.jobs['affected-macos']
  assert.deepEqual(MACOS_QUALIFICATION_JOBS, [gate.name])
  assert.equal(gate.needs, 'prepare')
  assert.equal(gate.if, 'always()')
  assert.equal(
    gate['timeout-minutes'],
    "${{ github.event_name == 'pull_request' && 70 || inputs.include_startup_profile && 180 || 90 }}",
  )
  const collect = gate.steps.findIndex((step) =>
    step.run?.includes('macos-host-collect.mjs collect'),
  )
  const qualify = gate.steps.findIndex((step) => step.id === 'qualification')
  const scope = gate.steps.findIndex((step) =>
    step.run?.includes('host-scope.mjs --scope macos --results'),
  )
  const reconcile = gate.steps.findIndex((step) =>
    step.run?.includes('job-evidence.mjs --directory'),
  )
  const publish = gate.steps.findIndex((step) =>
    step.with?.name?.startsWith('macos-qualification-arm64-'),
  )
  assert.ok(
    collect >= 0 &&
      collect < qualify &&
      qualify < scope &&
      scope < reconcile &&
      reconcile < publish,
  )
  assert.match(gate.steps[qualify].run, /candidate-provenance\.mjs qualification/)
  assert.match(gate.steps[qualify].run, /--artifacts --residue/)
  assert.equal(gate.steps[collect].if, gate.steps[qualify].if)
  assert.match(gate.steps[collect].if, /needs\.prepare\.outputs\.required == 'true'/)
  assert.match(gate.steps[collect].if, /needs\.prepare\.result == 'success'/)
  const qualificationOutcome = '${{ toJSON(steps.qualification.outcome) }}'
  assert.ok(
    gate.steps[scope].env.JOB_RESULTS.includes('"prepare": ${{ toJSON(needs.prepare.result) }}'),
  )
  assert.ok(gate.steps[scope].env.JOB_RESULTS.includes(qualificationOutcome))
  assert.ok(gate.steps[reconcile].env.JOB_RESULTS.includes(qualificationOutcome))
  assert.equal(gate.steps[publish].if, "${{ needs.prepare.outputs.required == 'true' }}")
  assert.equal(
    gate.steps.some((step) => step.uses?.startsWith('actions/download-artifact@')),
    false,
  )
  const selector = workflow.jobs.selectors
  assert.equal(selector.needs, 'prepare')
  assert.match(selector.if, /github.event_name == 'pull_request'/)
  assert.equal(selector['timeout-minutes'], 70)
  const diagnostic = gate.steps.findIndex(
    (step) => step.run === 'node scripts/ci/host-job-diagnostics.mjs',
  )
  assert.ok(diagnostic > publish)
  assert.equal(gate.steps[diagnostic].if, 'always()')
  assert.equal(
    gate.steps[diagnostic].env.MACOS_QUALIFICATION_COMPLETE,
    "${{ job.status == 'success' && steps.qualification.outcome == 'success' }}",
  )
  assert.equal(gate.steps[diagnostic]['continue-on-error'], true)
  assert.equal(gate.steps[diagnostic]['timeout-minutes'], 1)
  assert.equal(gate.permissions.checks, 'read')
  for (const [id, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.permissions?.contents ?? workflow.permissions.contents, 'read', id)
    if (id !== 'affected-macos') assert.equal(job.permissions?.checks, undefined, id)
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/)
      if (step.uses?.startsWith('actions/checkout@'))
        assert.equal(step.with['persist-credentials'], false)
    }
  }
  const ci = parse(await readFile(new URL('ci.yml', workflows), 'utf8'))
  assert.equal(ci.on.schedule.length, 1)
  assert.equal(workflow.on.schedule.length, 1)
})

test('every workflow declares GitHub triggers using YAML 1.2 keys', async () => {
  for (const file of await readdir(workflows)) {
    if (!/\.ya?ml$/.test(file)) continue
    const workflow = parse(await readFile(new URL(file, workflows), 'utf8'))
    assert.ok(workflow && typeof workflow === 'object', file)
    for (const key of Object.keys(workflow))
      assert.ok(rootKeys.has(key), `${file}: unknown workflow key ${key}`)
    assert.ok(workflow.on, `${file}: missing GitHub on trigger`)
    assert.ok(workflow.jobs && Object.keys(workflow.jobs).length, `${file}: missing jobs`)
  }
})

test('publication workflows use the configured protected registry environments', async () => {
  for (const [file, environment] of [
    ['npm-publish.yml', 'npm'],
    ['pypi-publish.yml', 'pypi'],
  ]) {
    if (!(await readdir(workflows)).includes(file)) continue
    const workflow = parse(await readFile(new URL(file, workflows), 'utf8'))
    assert.ok(
      workflow.on.workflow_run.workflows.includes('CI'),
      `${file}: missing CI completion trigger`,
    )
    const jobs = Object.values(workflow.jobs).filter((job) => job.environment)
    assert.ok(jobs.length, `${file}: missing protected publication job`)
    for (const job of jobs)
      assert.equal(
        typeof job.environment === 'string' ? job.environment : job.environment.name,
        environment,
        file,
      )
  }
})

test('release intent is an unconditional part of the required CI aggregate', async () => {
  const workflow = parse(await readFile(new URL('ci.yml', workflows), 'utf8'))
  assert.ok(Object.hasOwn(workflow.on, 'pull_request'))
  assert.equal(workflow.on.pull_request?.paths, undefined)
  assert.equal(workflow.on.push.paths, undefined)
  const quick = workflow.jobs['quick-checks']
  assert.equal(quick.if, undefined)
  const checkout = quick.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with['fetch-depth'], 0)
  const checkIndex = quick.steps.findIndex((step) =>
    step.run?.includes('scripts/release/cli.mjs check'),
  )
  assert.notEqual(checkIndex, -1)
  const check = quick.steps[checkIndex]
  assert.equal(check.if, undefined)
  assert.equal(check['continue-on-error'], undefined)
  assert.equal(check.env?.RELEASE_BASE_REVISION, undefined)
  assert.match(check.run, /release_base="\$\(node scripts\/ci\/release-base\.mjs\)"/)
  assert.doesNotMatch(check.run, /HEAD\^|pull_request\.base\.sha/)
  assert.match(check.run, /check --base "\$release_base"/)
  const evidenceIndex = quick.steps.findIndex((step) =>
    step.run?.includes('scripts/ci/job-evidence.mjs'),
  )
  assert.ok(evidenceIndex > checkIndex)
  assert.equal(workflow.jobs.test['runs-on'], 'ubuntu-slim')
  assert.ok(workflow.jobs.test.needs.includes('quick-checks'))
})

test('release generation is serialized, scoped to main, and has no registry authority', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch'])
  assert.deepEqual(workflow.on.push.branches, ['main'])
  assert.equal(workflow.on.push.paths, undefined)
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  const { generate, version: writer } = workflow.jobs
  assert.equal(generate.if, "github.ref == 'refs/heads/main'")
  assert.equal(writer.needs, 'generate')
  assert.match(writer.if, /github\.ref == 'refs\/heads\/main'/)
  assert.match(writer.if, /needs\.generate\.outputs\.pending == 'true'/)
  const version = writer.steps.find((step) => step.uses?.startsWith('changesets/action/version@'))
  assert.ok(version)
  assert.match(version.if, /steps\.current\.outputs\.current == 'true'/)
  assert.equal(version.with['pr-base-branch'], 'main')
  // Use the pinned action's credential-scoped git push rather than GraphQL
  // createCommitOnBranch, which has returned opaque GitHub server errors.
  assert.equal(version.with['push-with-git-cli'], true)
  assert.match(version.uses, /^changesets\/action\/version@[a-f0-9]{40}$/)
  assert.equal(writer.permissions.contents, 'write')
  assert.equal(writer.permissions['pull-requests'], 'write')
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.environment, undefined)
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    assert.equal(checkout.with.ref, `\${{ github.sha }}`)
    assert.equal(checkout.with['fetch-depth'], 0)
    assert.equal(checkout.with['persist-credentials'], false)
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/)
      assert.doesNotMatch(step.run ?? '', /\b(?:npm|bun|changeset)\s+publish\b/)
      assert.doesNotMatch(step.uses ?? '', /^changesets\/action(?:\/publish)?@/)
    }
  }
})

test('release dependency execution is confined to the read-only generation runner', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const { generate, version: writer } = workflow.jobs
  assert.deepEqual(generate.permissions, { contents: 'read' })
  assert.deepEqual(writer.permissions, { contents: 'write', 'pull-requests': 'write' })
  assert.doesNotMatch(JSON.stringify(generate), /secrets\.|create-github-app-token|app-token/)
  assert.ok(generate.steps.some((step) => step.run === 'bun install --ignore-scripts'))
  assert.ok(generate.steps.some((step) => step.run?.includes('scripts/release/cli.mjs plan')))
  assert.ok(generate.steps.some((step) => step.run?.includes('just release-version')))

  const allowedWriterActions = new Set([
    'actions/checkout',
    'actions/setup-node',
    'actions/download-artifact',
    'actions/create-github-app-token',
    'changesets/action/version',
  ])
  for (const step of writer.steps) {
    if (step.uses) assert.ok(allowedWriterActions.has(step.uses.split('@')[0]), step.uses)
    assert.doesNotMatch(step.run ?? '', /\b(?:bun|npm|npx|pnpm|yarn|just)\b|node_modules|cli\.mjs/)
  }
  const version = writer.steps.find((step) => step.uses?.startsWith('changesets/action/version@'))
  assert.equal(
    version.with.script,
    `node scripts/release/prepared.mjs apply "\${{ runner.temp }}/prepared-release/release-changes.json"`,
  )
})

test('release writer consumes exact prepared data and validates it before minting the App token', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const { generate, version: writer } = workflow.jobs
  const upload = generate.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
  assert.ok(upload)
  assert.equal(upload.with.path, `\${{ runner.temp }}/release-changes.json`)
  assert.equal(
    upload.with.name,
    `release-changes-\${{ github.sha }}-r\${{ github.run_id }}-a\${{ github.run_attempt }}`,
  )
  assert.equal(upload.with.overwrite, false)
  assert.equal(upload.with['if-no-files-found'], 'error')
  assert.equal(generate.outputs['artifact-id'], `\${{ steps.${upload.id}.outputs.artifact-id }}`)
  const preparation = generate.steps.find((step) => step.run?.includes('prepared.mjs create'))
  assert.ok(preparation)
  assert.ok(preparation.run.indexOf('just release-version') >= 0)
  assert.ok(
    preparation.run.indexOf('just release-version') <
      preparation.run.indexOf('prepared.mjs create'),
  )

  const currentIndex = writer.steps.findIndex((step) => step.id === 'current')
  const downloadIndex = writer.steps.findIndex((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  )
  const validateIndex = writer.steps.findIndex((step) =>
    step.run?.includes('prepared.mjs restore-lock'),
  )
  const setupIndex = writer.steps.findIndex((step) => step.id === 'release-setup')
  const tokenIndex = writer.steps.findIndex((step) =>
    step.uses?.startsWith('actions/create-github-app-token@'),
  )
  const versionIndex = writer.steps.findIndex((step) =>
    step.uses?.startsWith('changesets/action/version@'),
  )
  assert.ok(currentIndex >= 0 && downloadIndex > currentIndex)
  assert.ok(
    validateIndex > downloadIndex &&
      setupIndex > validateIndex &&
      tokenIndex > setupIndex &&
      versionIndex > tokenIndex,
  )
  const current = writer.steps[currentIndex]
  assert.match(current.run, /git\/ref\/heads\/main/)
  assert.match(current.run, /"\$current_main" = "\$GITHUB_SHA"/)
  const download = writer.steps[downloadIndex]
  assert.deepEqual(download.with, {
    'artifact-ids': `\${{ needs.generate.outputs.artifact-id }}`,
    path: `\${{ runner.temp }}/prepared-release`,
    'merge-multiple': true,
  })
  assert.equal(
    writer.steps[validateIndex].run,
    'node scripts/release/prepared.mjs restore-lock "$RUNNER_TEMP/prepared-release/release-changes.json"',
  )
  for (const index of [downloadIndex, validateIndex, setupIndex, tokenIndex, versionIndex])
    assert.match(writer.steps[index].if, /steps\.current\.outputs\.current == 'true'/)
})

test('release setup reports both token modes and rejects each incomplete App configuration', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const setup = workflow.jobs.version.steps.find((step) => step.id === 'release-setup')
  assert.ok(setup)
  assert.deepEqual(setup.env, {
    HAS_RELEASE_APP_ID: `\${{ vars.RELEASE_APP_ID != '' }}`,
    HAS_RELEASE_APP_PRIVATE_KEY: `\${{ secrets.RELEASE_APP_PRIVATE_KEY != '' }}`,
  })
  assert.equal(setup.if, "steps.current.outputs.current == 'true'")
  assert.equal(setup['continue-on-error'], undefined)
  assert.doesNotMatch(setup.run, /\b(?:gh|curl|wget)\b|\$\{\{/)
  for (const [id, key, missing, settingsPath] of [
    ['false', 'false', undefined, undefined],
    ['true', 'true', undefined, undefined],
    ['true', 'false', 'secret RELEASE_APP_PRIVATE_KEY', 'secrets/actions'],
    ['false', 'true', 'variable RELEASE_APP_ID', 'variables/actions'],
  ]) {
    const result = await runWriterStep(setup, {
      HAS_RELEASE_APP_ID: id,
      HAS_RELEASE_APP_PRIVATE_KEY: key,
    })
    assert.equal(result.status, missing ? 1 : 0, result.output)
    if (missing) {
      assert.ok(
        result.output.includes(
          `::error::Incomplete release App configuration: missing ${missing}.`,
        ),
      )
      assert.ok(result.summary.includes(`${missing} is missing`))
      assert.ok(
        result.summary.includes(
          `https://github.com/jiggy/release-fixture/settings/${settingsPath}`,
        ),
      )
      assert.match(result.summary, /remove the other App setting/)
      assert.match(result.summary, /Re-run all jobs/)
      assert.match(result.summary, /dispatch \*\*Release versions\*\* on current \*\*main\*\*/)
      assert.match(result.summary, /Do not choose \*\*Re-run failed jobs\*\*/)
    } else if (id === 'true') {
      assert.match(result.summary, /Using the configured release GitHub App/)
      assert.match(result.summary, /installed on this repository/)
      assert.match(result.summary, /Contents: write/)
      assert.match(result.summary, /Pull requests: write/)
      assert.doesNotMatch(result.output, /::error::/)
    } else {
      assert.match(result.summary, /Using \*\*GITHUB_TOKEN\*\*/)
      assert.match(result.summary, /No App secrets are required/)
      assert.match(result.summary, /Settings → Actions → General/)
      assert.ok(
        result.summary
          .split('\n')
          .includes(
            'Open [Settings → Actions → General](https://github.com/jiggy/release-fixture/settings/actions).',
          ),
      )
      assert.match(result.summary, /Workflow permissions/)
      assert.match(result.summary, /Allow GitHub Actions to create and approve pull requests/)
      assert.doesNotMatch(result.output, /::error::/)
    }
  }
})

test('release failure summaries preserve the outcome and report recovery without guessing a cause', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const writer = workflow.jobs.version
  const diagnosticIndex = writer.steps.findIndex((step) =>
    step.run?.includes('## Release PR automation failed'),
  )
  const diagnostic = writer.steps[diagnosticIndex]
  const versionIndex = writer.steps.findIndex((step) => step.id === 'version')
  assert.ok(diagnosticIndex > versionIndex)
  assert.equal(
    diagnostic.if,
    "failure() && (steps.app-token.outcome == 'failure' || steps.version.outcome == 'failure')",
  )
  assert.equal(diagnostic.env, undefined)
  assert.equal(writer['continue-on-error'], undefined)
  for (const step of writer.steps) assert.equal(step['continue-on-error'], undefined)
  assert.doesNotMatch(diagnostic.run, /\b(?:gh|curl|wget)\b|\$\{\{/)
  const result = await runWriterStep(diagnostic, {})
  assert.equal(result.status, 0, result.output)
  assert.match(result.summary, /Inspect the failed step for the exact error/)
  assert.match(result.summary, /Re-run all jobs/)
  assert.match(result.summary, /dispatch \*\*Release versions\*\* on current \*\*main\*\*/)
  assert.match(result.summary, /Do not choose \*\*Re-run failed jobs\*\*/)
  assert.doesNotMatch(
    result.summary,
    /GITHUB_TOKEN|RELEASE_APP|authentication|permissions|settings\//i,
  )
})

test('successful built-in release PRs link the actual approval and maintainer merge handoff', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const handoff = workflow.jobs.version.steps.find((step) =>
    step.run?.includes('Approve workflows to run'),
  )
  assert.ok(handoff)
  assert.equal(
    handoff.if,
    "steps.version.outputs.pr-number != '' && steps.app-token.outputs.token == ''",
  )
  assert.deepEqual(handoff.env, {
    RELEASE_PR_NUMBER: `\${{ steps.version.outputs.pr-number }}`,
  })
  assert.doesNotMatch(handoff.run, /\b(?:gh|curl|wget)\b|\$\{\{/)
  const result = await runWriterStep(handoff, { RELEASE_PR_NUMBER: '123' })
  assert.equal(result.status, 0, result.output)
  assert.ok(
    result.summary
      .split('\n')
      .includes('Open [release PR #123](https://github.com/jiggy/release-fixture/pull/123).'),
  )
  assert.match(result.summary, /If shown, select \*\*Approve workflows to run\*\*/)
  assert.match(result.summary, /required checks and reviews, then merge it as a maintainer/)
  assert.match(result.summary, /human merge starts the required main-push qualification/)
  assert.match(result.summary, /Do not substitute a manually dispatched check run/)
  assert.match(result.summary, /No App secrets are required/)
})

test('release App access is repository-scoped and automatic merge preserves normal policy', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const job = workflow.jobs.version
  const token = job.steps.find((step) => step.uses?.startsWith('actions/create-github-app-token@'))
  assert.ok(token)
  assert.equal(token.with.owner, `\${{ github.repository_owner }}`)
  assert.equal(token.with.repositories, `\${{ github.event.repository.name }}`)
  assert.deepEqual(
    Object.fromEntries(Object.entries(token.with).filter(([key]) => key.startsWith('permission-'))),
    { 'permission-contents': 'write', 'permission-pull-requests': 'write' },
  )
  const merge = job.steps.find((step) => step.run?.includes('gh pr merge'))
  assert.ok(merge)
  assert.match(merge.if, /steps\.app-token\.outputs\.token != ''/)
  assert.match(merge.if, /vars\.RELEASE_AUTO_MERGE == 'true'/)
  assert.equal(merge.env.GH_TOKEN, `\${{ steps.app-token.outputs.token }}`)
  assert.match(merge.run, /--auto/)
  assert.match(merge.run, /--match-head-commit/)
  assert.doesNotMatch(merge.run, /--admin/)
  assert.ok(
    job.steps.some(
      (step) =>
        step.if?.includes("steps.app-token.outputs.token == ''") &&
        step.run?.includes('merge it as a maintainer'),
    ),
  )
})

test('npm readiness ignores PRs and skipped descendants while retaining failed main qualification', async () => {
  const workflow = parse(await readFile(new URL('npm-publish.yml', workflows), 'utf8'))
  assert.deepEqual(workflow.on.workflow_run.branches, ['main'])
  const qualifies = (github, inputs = { mode: 'release' }) =>
    Function('github', 'inputs', `return (${workflow.jobs.authorize.if})`)(github, inputs)
  const event = (changes = {}) => ({
    event_name: 'workflow_run',
    ref: 'refs/heads/main',
    repository: 'jiggy/jig',
    event: {
      workflow_run: {
        head_branch: 'main',
        head_repository: { full_name: 'jiggy/jig' },
        event: 'push',
        path: '.github/workflows/ci.yml',
        conclusion: 'success',
        ...changes,
      },
    },
  })
  assert.equal(qualifies(event()), true)
  assert.equal(qualifies(event({ event: 'pull_request' })), false)
  assert.equal(qualifies(event({ head_branch: 'feature' })), false)
  assert.equal(qualifies(event({ head_repository: { full_name: 'fork/jig' } })), false)
  assert.equal(qualifies(event({ conclusion: 'failure' })), true)
  for (const nativeEvent of ['workflow_run', 'workflow_dispatch']) {
    const native = {
      event: nativeEvent,
      path: '.github/workflows/native-agent-api-qualification.yml',
    }
    assert.equal(qualifies(event({ ...native, conclusion: 'skipped' })), false)
    assert.equal(qualifies(event({ ...native, conclusion: 'failure' })), true)
    assert.equal(qualifies(event({ ...native, conclusion: 'success' })), true)
  }
  assert.equal(qualifies({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }), true)
  assert.equal(
    qualifies(
      { event_name: 'workflow_dispatch', ref: 'refs/heads/main' },
      { mode: 'authentication' },
    ),
    false,
  )
  assert.equal(qualifies({ event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }), false)
})

test('native live jobs require release scope while manual main diagnostics remain explicit', async () => {
  const workflow = parse(
    await readFile(new URL('native-agent-api-qualification.yml', workflows), 'utf8'),
  )
  const scope = workflow.jobs.scope
  const evaluate = (expression, github) => Function('github', 'return (' + expression + ')')(github)
  const event = (changes = {}) => ({
    event_name: 'workflow_run',
    ref: 'refs/heads/main',
    sha: 'b'.repeat(40),
    repository: 'jiggy/jig',
    event: {
      workflow_run: {
        head_sha: 'a'.repeat(40),
        conclusion: 'success',
        event: 'push',
        head_branch: 'main',
        head_repository: { full_name: 'jiggy/jig' },
        ...changes,
      },
    },
  })
  const contexts = [
    [event(), true, 'a'.repeat(40)],
    [
      { event_name: 'workflow_dispatch', ref: 'refs/heads/main', sha: 'c'.repeat(40) },
      true,
      'c'.repeat(40),
    ],
    [{ event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }, false],
    [{ event_name: 'pull_request' }, false],
    [{ event_name: 'pull_request_target' }, false],
    [{ event_name: 'issue_comment' }, false],
    ...[
      { conclusion: 'failure' },
      { conclusion: 'cancelled' },
      { conclusion: null },
      { event: 'pull_request' },
      { event: 'pull_request_target' },
      { event: 'workflow_dispatch' },
      { head_branch: 'feature' },
      { head_repository: { full_name: 'fork/jig' } },
      { event: 'pull_request', head_branch: 'main', head_repository: { full_name: 'fork/jig' } },
    ].map((changes) => [event(changes), false]),
  ]
  assert.equal(scope.environment, undefined)
  assert.doesNotMatch(JSON.stringify(scope), /secrets\.|OPENROUTER_API_KEY/)
  assert.equal(scope.outputs.qualify, '${{ steps.release.outputs.qualify }}')
  const checkout = scope.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with['fetch-depth'], 0)
  const job = workflow.jobs.qualification
  const nativeCheckout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  for (const [context, selected, revision] of contexts) {
    assert.equal(evaluate(scope.if, context), selected)
    for (const step of [checkout, nativeCheckout]) {
      assert.equal(
        evaluate(step.if, context),
        selected,
        'Checkout must enforce trust independently',
      )
      if (selected)
        assert.equal(
          evaluate(step.with.ref.slice(3, -2), context),
          step === checkout ? context.sha : revision,
        )
    }
  }
  assert.equal(checkout.with.ref, '${{ github.sha }}')
  assert.equal(
    nativeCheckout.with.ref,
    "${{ github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.sha }}",
  )
  for (const step of [checkout, nativeCheckout]) {
    assert.equal(step.with['persist-credentials'], false)
  }
  assert.equal(job.needs, 'scope')
  assert.equal(job.if, "needs.scope.outputs.qualify == 'true'")
  assert.deepEqual(
    job.strategy.matrix.include.map(({ client }) => client),
    ['codex', 'claude'],
  )
  assert.equal(job.strategy['fail-fast'], false)
  assert.equal(job.environment, 'native-agent-api')
  assert.ok(job.steps.find((step) => step.id === 'host-run').run.includes('acquire-linux'))
  assert.ok(job.steps.some((step) => step.run?.includes('--upstream-receipt')))
  const native = job.steps.find((step) => step.id === 'native-api').run
  assert.ok(native.includes('--timeout 420000 "${test_arguments[@]}"'))
  const selection = native.slice(native.indexOf('test_arguments=()'), native.indexOf('set +e'))
  for (const client of ['codex', 'claude']) {
    const result = spawnSync(
      '/bin/bash',
      [
        '-e',
        '-o',
        'pipefail',
        '-c',
        selection + '\nprintf "%s:%s" "${#test_arguments[@]}" "${test_arguments[*]}"',
      ],
      {
        env: {
          JIG_NATIVE_API_CLIENT: client,
          JIG_NATIVE_API_MODEL: 'selected-model',
          NATIVE_AGENT_PATH: '/native',
        },
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, client === 'codex' ? '1:--bail=1' : '0:')
  }
})

test('native provider proof selects first-party credentials only with a protected key and model', async () => {
  const workflow = parse(
    await readFile(new URL('native-agent-api-qualification.yml', workflows), 'utf8'),
  )
  const job = workflow.jobs.qualification
  const step = job.steps.find((entry) => entry.id === 'native-api')
  assert.ok(step)
  assert.equal(job.environment, 'native-agent-api')
  for (const [key, fragment] of [
    ['JIG_CODEX_FIRST_PARTY_API_KEY', 'secrets.JIG_NATIVE_CODEX_OPENAI_API_KEY'],
    ['JIG_CODEX_FIRST_PARTY_MODEL', 'vars.JIG_NATIVE_CODEX_OPENAI_MODEL'],
    ['JIG_CLAUDE_FIRST_PARTY_API_KEY', 'secrets.JIG_NATIVE_CLAUDE_ANTHROPIC_API_KEY'],
    ['JIG_CLAUDE_FIRST_PARTY_MODEL', 'vars.JIG_NATIVE_CLAUDE_ANTHROPIC_MODEL'],
  ]) {
    assert.ok(step.env[key].includes(fragment))
  }
  assert.match(step.run, /OPENROUTER_API_KEY='' JIG_CODEX_FIRST_PARTY_API_KEY='' JIG_CLAUDE_FIRST_PARTY_API_KEY=''/)
  assert.match(step.run, /provider_route" == openrouter/)
  const selection = step.run.slice(0, step.run.indexOf('test_arguments=()'))
  assert.ok(selection.includes('selected_api_key='))
  const cases = [
    {
      client: 'codex', key: '', model: '', selectedKey: 'test-router-key',
      selectedModel: 'openrouter/free', selectedRoute: 'openrouter',
      selectedBase: 'https://openrouter.ai/api/v1', status: 0,
    },
    {
      client: 'codex', key: 'test-codex-key', model: 'gpt-test-model',
      selectedKey: 'test-codex-key', selectedModel: 'gpt-test-model',
      selectedRoute: 'openai', selectedBase: 'https://api.openai.com/v1', status: 0,
    },
    {
      client: 'claude', key: '', model: '', selectedKey: 'test-router-key',
      selectedModel: 'mistralai/ministral-8b-2512', selectedRoute: 'openrouter',
      selectedBase: 'https://openrouter.ai/api', status: 0,
    },
    {
      client: 'claude', key: 'test-claude-key', model: 'claude-test-model',
      selectedKey: 'test-claude-key', selectedModel: 'claude-test-model',
      selectedRoute: 'anthropic', selectedBase: 'https://api.anthropic.com', status: 0,
    },
    { client: 'codex', key: 'test-codex-key', model: '', status: 1 },
    { client: 'claude', key: '', model: 'claude-test-model', status: 1 },
    { client: 'codex', key: 'test-codex-key', model: 'bad\nmodel', status: 1 },
  ]
  const directory = await mkdtemp(join(tmpdir(), 'jig-native-route-selection-'))
  try {
    for (const selected of cases) {
      const code = selection + `
if [[ -n "\${EXPECTED_KEY:-}" ]]; then
  test "$selected_api_key" = "$EXPECTED_KEY"
  test "$selected_model" = "$EXPECTED_MODEL"
  test "$provider_route" = "$EXPECTED_ROUTE"
  test "$selected_base_url" = "$EXPECTED_BASE"
fi
`
      const output = join(directory, 'output')
      const summary = join(directory, 'summary')
      const isCodex = selected.client === 'codex'
      const isClaude = selected.client === 'claude'
      const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', code], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          GITHUB_ENV: output,
          GITHUB_STEP_SUMMARY: summary,
          OPENROUTER_API_KEY: 'test-router-key',
          JIG_NATIVE_API_CLIENT: selected.client,
          JIG_NATIVE_API_MODEL: isCodex ? 'openrouter/free' : 'mistralai/ministral-8b-2512',
          JIG_CODEX_FIRST_PARTY_API_KEY: isCodex ? selected.key : '',
          JIG_CODEX_FIRST_PARTY_MODEL: isCodex ? selected.model : '',
          JIG_CLAUDE_FIRST_PARTY_API_KEY: isClaude ? selected.key : '',
          JIG_CLAUDE_FIRST_PARTY_MODEL: isClaude ? selected.model : '',
          EXPECTED_KEY: selected.selectedKey ?? '',
          EXPECTED_MODEL: selected.selectedModel ?? '',
          EXPECTED_ROUTE: selected.selectedRoute ?? '',
          EXPECTED_BASE: selected.selectedBase ?? '',
        },
        encoding: 'utf8',
        timeout: 5_000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, selected.status, result.stderr)
      if (selected.status === 0) {
        assert.equal(await readFile(output, 'utf8'), `NATIVE_QUALIFICATION_MODEL=${selected.selectedModel}\n`)
        assert.ok((await readFile(summary, 'utf8')).includes(selected.selectedRoute))
      }
      await rm(output, { force: true })
      await rm(summary, { force: true })
    }
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('native recovery summary preserves failures without exposing credentials', async () => {
  const workflow = parse(
    await readFile(new URL('native-agent-api-qualification.yml', workflows), 'utf8'),
  )
  const job = workflow.jobs.qualification
  const step = job.steps.find((step) => step.name === 'Explain native qualification and recovery')
  assert.equal(step.if, 'always()')
  assert.equal(step.env.QUALIFICATION_OUTCOME, '$' + '{{ job.status }}')
  assert.doesNotMatch(JSON.stringify(step), /secrets\.|OPENROUTER_API_KEY|native-api-tests\.txt/)
  for (const outcome of ['success', 'failure', 'cancelled']) {
    const result = await runWriterStep(step, {
      NATIVE_CLIENT: 'codex',
      NATIVE_QUALIFICATION_MODEL: 'openrouter/free',
      QUALIFICATION_OUTCOME: outcome,
    })
    assert.equal(result.status, 0)
    assert.ok(result.summary.includes('Native codex qualification: ' + outcome))
    if (outcome !== 'success') {
      assert.match(result.summary, /Re-run all jobs/)
      assert.match(result.summary, /does not identify the underlying provider cause/)
    }
  }
  assert.equal(job.steps.find((step) => step.id === 'native-api')['continue-on-error'], undefined)
})

test('publication summary distinguishes verified archives from superseded versions', async () => {
  const workflow = parse(await readFile(new URL('npm-publish.yml', workflows), 'utf8'))
  const step = workflow.jobs.tag_host.steps.at(-1)
  assert.equal(step.name, 'Summarize completed npm publication')
  assert.equal(step.if, undefined)
  const result = await runWriterStep(step, {
    AGENT_VERSION: '0.1.0-alpha.1',
    AGENT_STATE: 'verified',
    ACP_VERSION: '0.1.0-alpha.2',
    ACP_STATE: 'superseded',
    JIG_VERSION: '0.1.0-alpha.3',
    JIG_STATE: 'published',
  })
  assert.equal(result.status, 0)
  assert.ok(result.summary.includes('@jigging/agent-acp | 0.1.0-alpha.2 | superseded'))
  assert.ok(result.summary.includes('@jigging/jig | 0.1.0-alpha.3 | published'))
})

test('version planning explains pending and consumed changesets without claiming publication', async () => {
  const workflow = parse(await readFile(new URL('release-version.yml', workflows), 'utf8'))
  const step = workflow.jobs.generate.steps.find((step) => step.id === 'plan')
  const program = step.run.split("<<'NODE'\n")[1].split('\nNODE')[0]
  const temporary = await mkdtemp(join(tmpdir(), 'jig-version-plan-summary-'))
  try {
    for (const pendingChangesets of [[], ['fix']]) {
      await writeFile(join(temporary, 'release-plan.json'), JSON.stringify({ pendingChangesets }))
      const summary = join(temporary, 'summary-' + pendingChangesets.length + '.md')
      const output = join(temporary, 'output-' + pendingChangesets.length)
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
        env: {
          PATH: process.env.PATH,
          RUNNER_TEMP: temporary,
          GITHUB_REPOSITORY: 'jiggy/jig',
          GITHUB_STEP_SUMMARY: summary,
          GITHUB_OUTPUT: output,
        },
        encoding: 'utf8',
        timeout: 5_000,
      })
      assert.ifError(child.error)
      assert.equal(child.status, 0, child.stderr)
      const rendered = await readFile(summary, 'utf8')
      assert.ok(rendered.includes('https://github.com/jiggy/jig/actions/workflows/npm-publish.yml'))
      assert.match(
        rendered,
        pendingChangesets.length ? /Pending changesets/ : /No pending changesets/,
      )
      assert.ok(
        (await readFile(output, 'utf8')).includes('pending=' + (pendingChangesets.length > 0)),
      )
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
