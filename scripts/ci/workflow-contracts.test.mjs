import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { parse } from 'yaml'
import { CI_QUALIFICATION_JOBS } from './release-readiness.mjs'

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
  const tokenIndex = writer.steps.findIndex((step) =>
    step.uses?.startsWith('actions/create-github-app-token@'),
  )
  const versionIndex = writer.steps.findIndex((step) =>
    step.uses?.startsWith('changesets/action/version@'),
  )
  assert.ok(currentIndex >= 0 && downloadIndex > currentIndex)
  assert.ok(
    validateIndex > downloadIndex && tokenIndex > validateIndex && versionIndex > tokenIndex,
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
  for (const index of [downloadIndex, validateIndex, tokenIndex, versionIndex])
    assert.match(writer.steps[index].if, /steps\.current\.outputs\.current == 'true'/)
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
