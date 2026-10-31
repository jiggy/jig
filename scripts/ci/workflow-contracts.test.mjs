import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'
import { CI_QUALIFICATION_JOBS, LINUX_QUALIFICATION_JOBS } from './release-readiness.mjs'

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
          PATH: '/usr/bin:/bin',
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
    const rows = matrix?.include ?? matrix?.package?.map((name) => ({ package: name })) ?? [{}]
    for (const row of rows)
      names.push(template.replace(/\$\{\{\s*matrix\.(\w+)\s*\}\}/g, (_, key) => row[key]))
  }
  for (const required of CI_QUALIFICATION_JOBS)
    assert.ok(names.includes(required), `Missing required CI job: ${required}`)
})

test('installed Python jobs exactly cover the declared evidence profiles', async () => {
  const workflow = parse(await readFile(new URL('ci.yml', workflows), 'utf8'))
  const catalog = JSON.parse(await readFile(new URL('./test-suites.json', import.meta.url), 'utf8'))
  const profiles = workflow.jobs['python-installed'].strategy.matrix.include.map(
    ({ os, python }) => `${os}/python-${python}`,
  )
  assert.deepEqual(
    profiles.sort(),
    [...catalog.targets.find(({ id }) => id === 'python-installed').profiles].sort(),
  )
})

test('required Mac checks allocate complete ARM only and keep Intel on nightly/manual coverage', async () => {
  const mac = parse(await readFile(new URL('macos-hosted-candidates.yml', workflows), 'utf8'))
  const intel = parse(await readFile(new URL('macos-intel-nightly.yml', workflows), 'utf8'))
  const { MAC_HOST_SHARDS } = await import('./macos-host-test-shards.mjs')
  assert.deepEqual(mac.jobs.prerequisites.strategy.matrix.include,
    Array.from({ length: MAC_HOST_SHARDS.arm64 }, (_, shard) => ({
      arch: 'arm64', shard, installed: shard === MAC_HOST_SHARDS.arm64 - 1,
    })),
  )
  assert.deepEqual(mac.jobs['qualified-architecture'].strategy.matrix.include, [
    { arch: 'arm64', count: MAC_HOST_SHARDS.arm64 },
  ])
  assert.doesNotMatch(JSON.stringify(mac.jobs['affected-macos']), /macos-x64/)
  assert.deepEqual(Object.keys(intel.on).sort(), ['schedule', 'workflow_dispatch'])
  assert.equal(intel.on.schedule[0].cron, '23 2 * * *')
  assert.equal(intel.jobs.select.if, "github.ref == 'refs/heads/main'")
  assert.equal(intel.permissions.contents, 'read')
  assert.equal(intel.permissions.actions, 'read')
  assert.equal(intel.jobs.prerequisites['runs-on'], 'macos-15-intel')
  assert.equal(intel.jobs.prerequisites.strategy['max-parallel'], 2)
  assert.equal(intel.jobs.prerequisites.strategy['fail-fast'], false)
  assert.match(intel.jobs.prerequisites.strategy.matrix, /outputs\.shards/)
  const health = intel.jobs.health
  assert.match(health.if, /always\(\)/)
  assert.ok(health.needs.includes('qualified-architecture'))
  assert.equal(health.steps.at(-1).if, 'always()')
  for (const job of Object.values(intel.jobs)) {
    assert.equal(job['continue-on-error'], undefined)
    assert.equal(job.environment, undefined)
    for (const step of job.steps) {
      if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/)
      assert.doesNotMatch(JSON.stringify(step), /secrets\./)
    }
  }
  // Both architectures execute the same complete native and installed commands.
  for (const name of [
    'Test native containment and recovery',
    'Qualify the complete rootless host and installed consumer',
  ]) {
    const required = mac.jobs.prerequisites.steps.find((step) => step.name === name)
    const nightly = intel.jobs.prerequisites.steps.find((step) => step.name === name)
    assert.equal(nightly.run, required.run)
    assert.equal(nightly.if, required.if)
    assert.equal(nightly['continue-on-error'], undefined)
  }
  const manual = parse(await readFile(new URL('macos-host-conformance.yml', workflows), 'utf8'))
  assert.deepEqual(Object.keys(manual.on), ['workflow_dispatch'])
  assert.equal(manual.jobs.qualify.environment, 'macos-host-conformance')
})

test('release readiness requires every canonical Linux shard including example e2e', async () => {
  const workflow = parse(await readFile(new URL('linux-host-conformance.yml', workflows), 'utf8'))
  const shards = workflow.jobs['host-suite'].strategy.matrix.suite
  assert.ok(shards.includes('examples'))
  assert.deepEqual(LINUX_QUALIFICATION_JOBS, [
    'rootless-linux',
    ...shards.map((suite) => `Linux host — ${suite}`),
  ])
})

test('main Mac qualification admits independent runs through two bounded native queues', async () => {
  const mac = parse(await readFile(new URL('macos-hosted-candidates.yml', workflows), 'utf8'))
  assert.equal(mac.concurrency.group,
    "macos-hosted-${{ github.ref != 'refs/heads/main' && github.ref || github.run_id }}")
  assert.equal(mac.concurrency['cancel-in-progress'], "${{ github.ref != 'refs/heads/main' }}")
  assert.equal(mac.jobs.scope.outputs.native_lane, '${{ steps.native-lane.outputs.lane }}')
  const native = mac.jobs.prerequisites
  assert.deepEqual(native.concurrency, {
    group: "macos-hosted-native-${{ github.ref == 'refs/heads/main' && format('main-{0}', needs.scope.outputs.native_lane) || github.run_id }}",
    queue: 'max',
    'cancel-in-progress': false,
  })
  const evaluate = (template, ref, run, lane) => template.replace(/\$\{\{([\s\S]*?)\}\}/g,
    (_, expression) => String(runInNewContext(expression, {
      github: { ref, run_id: run },
      needs: { scope: { outputs: { native_lane: lane } } },
      format: (pattern, value) => pattern.replace('{0}', value),
    })),
  )
  assert.notEqual(
    evaluate(mac.concurrency.group, 'refs/heads/main', '100', '0'),
    evaluate(mac.concurrency.group, 'refs/heads/main', '101', '1'),
  )
  assert.equal(
    evaluate(mac.concurrency.group, 'refs/pull/1/merge', '100', ''),
    evaluate(mac.concurrency.group, 'refs/pull/1/merge', '101', ''),
  )
  assert.notEqual(
    evaluate(mac.concurrency.group, 'refs/pull/1/merge', '100', ''),
    evaluate(mac.concurrency.group, 'refs/pull/2/merge', '101', ''),
  )
  const nativeGroups = [0, 1, 2, 3].map((run) =>
    evaluate(native.concurrency.group, 'refs/heads/main', String(run), String(run % 2)),
  )
  assert.deepEqual([...new Set(nativeGroups)].sort(), [
    'macos-hosted-native-main-0', 'macos-hosted-native-main-1',
  ])
  assert.notEqual(
    evaluate(native.concurrency.group, 'refs/pull/1/merge', '100', ''),
    evaluate(native.concurrency.group, 'refs/pull/2/merge', '101', ''),
  )
  // Each run owns one complete ARM worker. Two groups therefore bound main
  // native execution without changing its qualification inventory or evidence.
  assert.deepEqual(native.strategy.matrix.include, [{ arch: 'arm64', shard: 0, installed: true }])
  assert.ok(native.needs.includes('scope'))
  assert.ok(native.needs.includes('host-artifacts'))
  for (const id of ['scope', 'host-artifacts', 'qualified-architecture', 'affected-macos'])
    assert.equal(mac.jobs[id].concurrency, undefined, id)
  const select = mac.jobs.scope.steps.find((step) => step.id === 'native-lane')
  assert.equal(select.if, "github.ref == 'refs/heads/main'")
  const directory = await mkdtemp(join(tmpdir(), 'jig-mac-native-lane-'))
  try {
    const lanes = new Set()
    for (const [number, expected] of [['1', '1'], ['2', '0'], ['101', '1'], ['9007199254740993', '1']]) {
      const output = join(directory, number)
      const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', select.run], {
        env: { PATH: process.env.PATH, GITHUB_RUN_NUMBER: number, GITHUB_OUTPUT: output },
        encoding: 'utf8', timeout: 5_000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(await readFile(output, 'utf8'), `lane=${expected}\n`)
      lanes.add(expected)
    }
    assert.deepEqual([...lanes].sort(), ['0', '1'])
    for (const number of ['', '0', '-1', '1.5', '1\nlane=unbounded']) {
      const output = join(directory, 'invalid')
      const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', select.run], {
        env: { PATH: process.env.PATH, GITHUB_RUN_NUMBER: number, GITHUB_OUTPUT: output },
        encoding: 'utf8', timeout: 5_000,
      })
      assert.ifError(result.error)
      assert.notEqual(result.status, 0)
      await assert.rejects(readFile(output), { code: 'ENOENT' })
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
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
  assert.equal(version.with['push-with-git-cli'], false)
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
  const qualifies = (github) => Function('github', 'return (' + workflow.jobs.authorize.if + ')')(github)
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
    const native = { event: nativeEvent, path: '.github/workflows/native-agent-api-qualification.yml' }
    assert.equal(qualifies(event({ ...native, conclusion: 'skipped' })), false)
    assert.equal(qualifies(event({ ...native, conclusion: 'failure' })), true)
    assert.equal(qualifies(event({ ...native, conclusion: 'success' })), true)
  }
  assert.equal(qualifies({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }), true)
  assert.equal(qualifies({ event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }), false)
})

test('native live jobs require release scope while manual main diagnostics remain explicit', async () => {
  const workflow = parse(
    await readFile(new URL('native-agent-api-qualification.yml', workflows), 'utf8'),
  )
  const scope = workflow.jobs.scope
  const selects = (github) => Function('github', 'return (' + scope.if + ')')(github)
  const event = (changes = {}) => ({
    event_name: 'workflow_run',
    repository: 'jiggy/jig',
    event: {
      workflow_run: {
        conclusion: 'success',
        event: 'push',
        head_branch: 'main',
        head_repository: { full_name: 'jiggy/jig' },
        ...changes,
      },
    },
  })
  assert.equal(selects(event()), true)
  for (const changes of [
    { conclusion: 'failure' },
    { event: 'pull_request' },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'fork/jig' } },
  ])
    assert.equal(selects(event(changes)), false)
  assert.equal(selects({ event_name: 'workflow_dispatch', ref: 'refs/heads/main' }), true)
  assert.equal(selects({ event_name: 'workflow_dispatch', ref: 'refs/heads/feature' }), false)
  assert.equal(scope.environment, undefined)
  assert.doesNotMatch(JSON.stringify(scope), /secrets\.|OPENROUTER_API_KEY/)
  assert.equal(scope.outputs.qualify, '${{ steps.release.outputs.qualify }}')
  const checkout = scope.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, '${{ env.SOURCE_REVISION }}')
  assert.equal(checkout.with['fetch-depth'], 0)
  assert.equal(checkout.with['persist-credentials'], false)
  const job = workflow.jobs.qualification
  assert.equal(job.needs, 'scope')
  assert.equal(job.if, "needs.scope.outputs.qualify == 'true'")
  assert.deepEqual(
    job.strategy.matrix.include.map(({ client }) => client),
    ['codex', 'claude', 'pi'],
  )
  assert.equal(job.strategy['fail-fast'], false)
  assert.equal(job.environment, 'native-agent-api')
  assert.ok(job.steps.find((step) => step.id === 'host-run').run.includes('acquire-linux'))
  assert.ok(job.steps.some((step) => step.run?.includes('--upstream-receipt')))
  const native = job.steps.find((step) => step.id === 'native-api').run
  assert.ok(native.includes('--timeout 420000 "${test_arguments[@]}"'))
  const selection = native.slice(native.indexOf('test_arguments=()'), native.indexOf('set +e'))
  for (const client of ['codex', 'claude', 'pi']) {
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

test('native recovery summary preserves failures without exposing credentials', async () => {
  const workflow = parse(await readFile(new URL('native-agent-api-qualification.yml', workflows), 'utf8'))
  const job = workflow.jobs.qualification
  const step = job.steps.find((step) => step.name === 'Explain native qualification and recovery')
  assert.equal(step.if, 'always()')
  assert.equal(step.env.QUALIFICATION_OUTCOME, '$' + '{{ job.status }}')
  assert.doesNotMatch(JSON.stringify(step), /secrets\.|OPENROUTER_API_KEY|native-api-tests\.txt/)
  for (const outcome of ['success', 'failure', 'cancelled']) {
    const result = await runWriterStep(step, {
      NATIVE_CLIENT: 'codex',
      NATIVE_MODEL: 'openrouter/free',
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
      assert.match(rendered, pendingChangesets.length ? /Pending changesets/ : /No pending changesets/)
      assert.ok((await readFile(output, 'utf8')).includes('pending=' + (pendingChangesets.length > 0)))
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
