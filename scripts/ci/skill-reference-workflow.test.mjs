import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from 'yaml'

const workflow = parse(
  await readFile(
    new URL('../../.github/workflows/sync-skill-references.yml', import.meta.url),
    'utf8',
  ),
)
const writer = parse(
  await readFile(
    new URL('../../.github/workflows/write-skill-references.yml', import.meta.url),
    'utf8',
  ),
)
const { generate } = workflow.jobs
const { synchronize } = writer.jobs

test('only same-repository open PRs into the default branch enter automatic synchronization', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request'])
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'reopened', 'synchronize'])
  const allowed = Function('github', `return (${generate.if})`)
  const context = {
    repository: 'jiggy/jig',
    event: {
      repository: { default_branch: 'main' },
      pull_request: {
        state: 'open',
        head: { repo: { full_name: 'jiggy/jig' }, ref: 'feature' },
        base: { ref: 'main' },
      },
    },
  }
  assert.equal(allowed(context), true)
  for (const change of [
    (pr) => {
      pr.state = 'closed'
    },
    (pr) => {
      pr.head.repo.full_name = 'contributor/jig'
    },
    (pr) => {
      pr.head.ref = 'main'
    },
    (pr) => {
      pr.base.ref = 'release'
    },
  ]) {
    const rejected = structuredClone(context)
    change(rejected.event.pull_request)
    assert.equal(allowed(rejected), false)
  }
})

test('PR content is inert input to trusted tooling without credential or dependency execution', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' })
  assert.deepEqual(generate.permissions, { contents: 'read' })
  const checkouts = generate.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 2)
  assert.deepEqual(
    checkouts.map((step) => [step.with.path, step.with.ref, step.with['persist-credentials']]),
    [
      ['trusted', '${{ github.event.pull_request.base.sha }}', false],
      ['incoming', '${{ github.event.pull_request.head.sha }}', false],
    ],
  )
  const commands = generate.steps.map((step) => step.run ?? '').join('\n')
  assert.match(commands, /bun install --cwd trusted --ignore-scripts/)
  assert.match(
    commands,
    /node trusted\/scripts\/sync-skills\.mjs --root "\$GITHUB_WORKSPACE\/incoming"/,
  )
  assert.doesNotMatch(commands, /node incoming\/|bun install --cwd incoming|gh |git push/)
  assert.deepEqual(Object.keys(workflow.jobs), ['generate'])
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|create-github-app-token|git push/)
  const upload = generate.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
  assert.match(upload.with.name, /github\.run_id/)
  assert.match(upload.with.name, /github\.run_attempt/)
  assert.equal(upload.with.overwrite, false)
})

test('the fresh writer validates data before a contents-only App token and preserves genuine PR checks', () => {
  assert.deepEqual(Object.keys(writer.on), ['workflow_run'])
  assert.deepEqual(writer.on.workflow_run, {
    workflows: [workflow.name],
    types: ['completed'],
  })
  assert.deepEqual(writer.permissions, {
    contents: 'read',
    actions: 'read',
    'pull-requests': 'read',
  })
  assert.equal(synchronize.permissions, undefined)
  assert.equal(synchronize.needs, undefined)
  const checkouts = synchronize.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 1)
  assert.equal(checkouts[0].with.ref, '${{ github.sha }}')
  assert.equal(checkouts[0].with['persist-credentials'], false)
  const selection = synchronize.steps.findIndex((step) => step.id === 'source')
  assert.match(synchronize.steps[selection].run, /node scripts\/ci\/skill-reference-run\.mjs/)
  assert.equal(synchronize.steps[selection].env.GH_TOKEN, '${{ github.token }}')
  const token = synchronize.steps.findIndex((step) =>
    step.uses?.startsWith('actions/create-github-app-token@'),
  )
  const validation = synchronize.steps.findIndex((step) =>
    step.run?.includes('skill-reference-changes.mjs validate'),
  )
  assert.ok(selection >= 0 && validation > selection && validation < token)
  for (const step of synchronize.steps.filter((step) => step.env?.SKILL_REFERENCE_RUN_ID)) {
    assert.equal(step.env.SKILL_REFERENCE_RUN_ID, '${{ steps.source.outputs.source-run-id }}')
    assert.equal(
      step.env.SKILL_REFERENCE_RUN_ATTEMPT,
      '${{ steps.source.outputs.source-run-attempt }}',
    )
  }
  assert.equal(synchronize.steps[token].with['app-id'], '${{ vars.RELEASE_APP_ID }}')
  assert.equal(
    synchronize.steps[token].with['private-key'],
    '${{ secrets.RELEASE_APP_PRIVATE_KEY }}',
  )
  assert.equal(synchronize.steps[token].with.repositories, '${{ github.event.repository.name }}')
  assert.equal(synchronize.steps[token].with['permission-contents'], 'write')
  assert.deepEqual(
    Object.keys(synchronize.steps[token].with).filter((key) => key.startsWith('permission-')),
    ['permission-contents'],
  )
  const commands = synchronize.steps.map((step) => step.run ?? '').join('\n')
  assert.doesNotMatch(
    commands,
    /(?:bun|npm) (?:install|ci)|gh workflow|workflow_dispatch|git checkout/,
  )
  assert.match(commands, /commit-tree "\$tree" -p "\$PR_HEAD_SHA"/)
  assert.match(commands, /git push --force-with-lease="refs\/heads\/\$PR_BRANCH:\$PR_HEAD_SHA"/)
  const push = synchronize.steps.find((step) => step.run?.includes('git push'))
  assert.equal(push.env.GH_TOKEN, '${{ steps.app-token.outputs.token }}')
  for (const step of synchronize.steps.slice(selection + 1))
    assert.equal(step.if, "steps.source.outputs.ready == 'true'")
})

test('only successful same-repository PR producers enter the trusted writer', () => {
  const allowed = Function('github', `return (${synchronize.if})`)
  const context = {
    repository: 'jiggy/jig',
    event: {
      repository: { default_branch: 'main' },
      workflow_run: {
        event: 'pull_request',
        conclusion: 'success',
        path: '.github/workflows/sync-skill-references.yml',
        head_repository: { full_name: 'jiggy/jig' },
        head_branch: 'feature',
      },
    },
  }
  assert.equal(allowed(context), true)
  for (const change of [
    { event: 'pull_request_target' },
    { event: 'workflow_dispatch' },
    { event: 'push' },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'contributor/jig' } },
    { head_branch: 'main' },
  ]) {
    const rejected = structuredClone(context)
    Object.assign(rejected.event.workflow_run, change)
    assert.equal(allowed(rejected), false)
  }
})

test('foreign producers cannot cancel a writer for the same branch name', () => {
  const group = (run) =>
    writer.concurrency.group.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) =>
      String(Function('github', `return (${expression})`)({ event: { workflow_run: run } })),
    )
  const producer = {
    workflow_id: 6,
    head_repository: { id: 42 },
    head_branch: 'feature',
    head_sha: 'a'.repeat(40),
    id: 17,
    run_attempt: 1,
  }
  assert.equal(writer.concurrency['cancel-in-progress'], true)
  assert.notEqual(group(producer), group({ ...producer, head_repository: { id: 43 } }))
  assert.notEqual(group(producer), group({ ...producer, workflow_id: 7 }))
  assert.notEqual(group(producer), group({ ...producer, head_branch: 'another-feature' }))
  assert.equal(group(producer), group({ ...producer, head_sha: 'b'.repeat(40), id: 18 }))
  assert.equal(group(producer), group({ ...producer, run_attempt: 2 }))
})

test('missing App configuration leaves an actionable failure without acquiring write authority', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jig-skill-workflow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const setup = synchronize.steps.find((step) => step.env?.HAS_RELEASE_APP_ID)
  for (const [id, key] of [
    ['false', 'false'],
    ['true', 'false'],
    ['false', 'true'],
    ['true', 'true'],
  ]) {
    const summary = join(root, `${id}-${key}.md`)
    const run = () =>
      execFileSync('bash', ['-e', '-c', setup.run], {
        env: {
          ...process.env,
          HAS_RELEASE_APP_ID: id,
          HAS_RELEASE_APP_PRIVATE_KEY: key,
          GITHUB_STEP_SUMMARY: summary,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    if (id === 'true' && key === 'true') run()
    else {
      assert.throws(run)
      const message = await readFile(summary, 'utf8')
      assert.match(message, /just sync-skills/)
      assert.match(message, /leaves the branch unchanged/)
      assert.match(message, /re-run the Sync skill references workflow/)
    }
  }
})

test('ordinary and fork CI check reference freshness through the existing required quick job', async () => {
  const ci = parse(
    await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  )
  const quick = ci.jobs['quick-checks']
  const check = quick.steps.find((step) => step.run === 'just check-skills')
  assert.ok(check)
  assert.equal(check.if, undefined)
  assert.equal(quick.if, undefined)
  assert.ok(ci.jobs.test.needs.includes('quick-checks'))
  assert.equal(quick.permissions.contents, 'read')
})

test('new or edited generation tooling receives a local synchronization handoff', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jig-skill-generator-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runGit = (path, ...args) =>
    execFileSync('git', ['-C', path, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  for (const name of ['trusted', 'incoming']) {
    const path = join(root, name)
    await mkdir(join(path, 'scripts'), { recursive: true })
    await mkdir(join(path, 'scripts/ci'), { recursive: true })
    runGit(path, 'init', '-q')
    runGit(path, 'config', 'user.name', 'Test Author')
    runGit(path, 'config', 'user.email', 'test@example.invalid')
    await writeFile(join(path, 'scripts/sync-skills.mjs'), 'export const version = 1\n')
    await writeFile(
      join(path, 'scripts/ci/skill-reference-changes.mjs'),
      'export const version = 1\n',
    )
    runGit(path, 'add', '--all')
    runGit(path, 'commit', '-qm', 'base')
  }
  const guard = generate.steps.find((step) => step.id === 'generator')
  assert.ok(guard)
  const run = async (name) => {
    const output = join(root, `${name}.output`)
    const summary = join(root, `${name}.summary`)
    execFileSync('bash', ['-e', '-c', guard.run], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { output: await readFile(output, 'utf8'), summary }
  }
  assert.equal((await run('same')).output, 'unchanged=true\n')
  await writeFile(join(root, 'incoming/scripts/sync-skills.mjs'), 'export const version = 2\n')
  runGit(join(root, 'incoming'), 'add', '--all')
  runGit(join(root, 'incoming'), 'commit', '-qm', 'new generator')
  const changed = await run('changed')
  assert.equal(changed.output, 'unchanged=false\n')
  assert.match(await readFile(changed.summary, 'utf8'), /just sync-skills/)
  runGit(join(root, 'trusted'), 'rm', 'scripts/sync-skills.mjs')
  runGit(join(root, 'trusted'), 'commit', '-qm', 'base before skill tooling')
  const absent = await run('missing')
  assert.equal(absent.output, 'unchanged=false\n')
  assert.match(await readFile(absent.summary, 'utf8'), /introduces or changes generation tooling/)
  for (const step of generate.steps.filter(
    (step) => step.run?.includes('bun install') || step.run?.includes('node trusted/'),
  ))
    assert.equal(step.if, "steps.generator.outputs.unchanged == 'true'")
})
