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
const { generate, synchronize } = workflow.jobs

test('only same-repository open PRs into the default branch enter automatic synchronization', () => {
  assert.deepEqual(Object.keys(workflow.on), ['pull_request_target'])
  assert.deepEqual(workflow.on.pull_request_target.types, ['opened', 'reopened', 'synchronize'])
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
      ['trusted', '${{ github.sha }}', false],
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
  assert.ok(generate.steps.every((step) => !JSON.stringify(step).includes('secrets.')))
  const upload = generate.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
  assert.match(upload.with.name, /github\.run_id/)
  assert.match(upload.with.name, /github\.run_attempt/)
  assert.equal(upload.with.overwrite, false)
})

test('the fresh writer validates data before a contents-only App token and preserves genuine PR checks', () => {
  assert.deepEqual(synchronize.permissions, { contents: 'read' })
  assert.equal(synchronize.needs, 'generate')
  assert.equal(synchronize.if, "needs.generate.outputs.changed == 'true'")
  const checkouts = synchronize.steps.filter((step) => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkouts.length, 1)
  assert.equal(checkouts[0].with.ref, '${{ github.sha }}')
  assert.equal(checkouts[0].with['persist-credentials'], false)
  const download = synchronize.steps.find((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  )
  assert.equal(download.with['artifact-ids'], '${{ needs.generate.outputs.artifact-id }}')
  const token = synchronize.steps.findIndex((step) =>
    step.uses?.startsWith('actions/create-github-app-token@'),
  )
  const validation = synchronize.steps.findIndex((step) =>
    step.run?.includes('skill-reference-changes.mjs validate'),
  )
  assert.ok(validation >= 0 && validation < token)
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
  assert.doesNotMatch(commands, /(?:bun|npm) (?:install|ci)|gh workflow|workflow_dispatch/)
  assert.match(commands, /commit-tree "\$tree" -p "\$PR_HEAD_SHA"/)
  assert.match(commands, /git push --force-with-lease="refs\/heads\/\$PR_BRANCH:\$PR_HEAD_SHA"/)
  const push = synchronize.steps.find((step) => step.run?.includes('git push'))
  assert.equal(push.env.GH_TOKEN, '${{ steps.app-token.outputs.token }}')
})

test('missing App configuration leaves an actionable failure instead of a non-triggering token push', async (t) => {
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
      assert.match(message, /Re-run all jobs/)
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

test('generator edits receive a local handoff instead of older generated output', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'jig-skill-generator-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runGit = (path, ...args) =>
    execFileSync('git', ['-C', path, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  for (const name of ['trusted', 'incoming']) {
    const path = join(root, name)
    await mkdir(join(path, 'scripts'), { recursive: true })
    runGit(path, 'init', '-q')
    runGit(path, 'config', 'user.name', 'Test Author')
    runGit(path, 'config', 'user.email', 'test@example.invalid')
    await writeFile(join(path, 'scripts/sync-skills.mjs'), 'export const version = 1\n')
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
  for (const step of generate.steps.filter(
    (step) => step.run?.includes('bun install') || step.run?.includes('node trusted/'),
  ))
    assert.equal(step.if, "steps.generator.outputs.unchanged == 'true'")
})
