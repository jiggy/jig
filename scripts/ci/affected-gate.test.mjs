import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, test } from 'node:test'
import { reconcileAffectedEvidence, trustedWorkflowContext } from './affected-gate.mjs'
import { createAffectedPlan } from './affected-plan.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function write(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), value)
}
function commit(root) {
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'fixture change')
  for (let nonce = 0; nonce < 100; nonce++) {
    const head = git(root, 'rev-parse', 'HEAD')
    const hash = createHash('sha256').update(`jig-ci-full-pr-audit-v1\0${head}`).digest('hex')
    if (BigInt(`0x${hash}`) % 5n !== 0n) return head
    git(root, 'commit', '--amend', '--quiet', '-m', `fixture change ${nonce}`)
  }
  assert.fail('Cannot create an unsampled genuine proposal')
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jig-gate-context-'))
  roots.push(root)
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.name', 'CI fixture')
  git(root, 'config', 'user.email', 'ci-fixture@example.invalid')
  const files = {
    'package.json': '{"name":"workspace","private":true}',
    'packages/flow-sdk/package.json': '{"name":"@jigging/flow"}',
    'packages/agent-method/package.json':
      '{"name":"@jigging/agent-method","dependencies":{"@jigging/flow":"workspace:*"}}',
    'packages/jig/package.json':
      '{"name":"@jigging/jig","dependencies":{"@jigging/agent-method":"workspace:*"}}',
    'packages/jig/test/lifecycle.test.ts': 'test("cleanup", () => {})',
    'packages/jig/src/core.ts': 'export const lifecycle = true',
    'packages/jiggy-flow/pyproject.toml': '[project]\nname = "jiggy-flow"\ndependencies = []\n',
    'packages/jiggy-flow/src/jiggy/flow/runtime.py': 'RUNTIME = 1\n',
    'packages/jiggy-flow/tests/test_runtime.py': 'def test_runtime(): pass\n',
    'packages/jiggy-user-updates/pyproject.toml':
      '[project]\nname = "jiggy-user-updates"\ndependencies = ["jiggy-flow==1.0"]\n',
    'packages/jiggy-user-updates/src/jiggy/user_updates/publisher.py': 'PUBLISHER = 1\n',
    'packages/jiggy-user-updates/src/jiggy/user_updates/user-updates.json': '{}',
    'conformance/run-0/python-peer/test_wire.py': 'def test_wire(): pass\n',
    'scripts/ci/tooling.test.mjs': 'test("tooling", () => {})',
    '.github/workflows/linux-host-conformance.yml':
      'jobs:\n  proof:\n    steps:\n      - run: bun test packages/jig/test/lifecycle.test.ts\n',
    'scripts/build-site.sh': '# build both sites\n',
    'scripts/test-release.sh': '# ordinary source gate\n',
    'site/justfile': 'build:\n',
    'site/jig/public/logo.svg': '<svg>old</svg>',
  }
  for (const [path, value] of Object.entries(files)) write(root, path, value)
  return { root, base: commit(root) }
}
function plan(f, options = {}) {
  return createAffectedPlan({
    cwd: f.root,
    head: 'HEAD',
    base: f.base,
    prHead: git(f.root, 'rev-parse', 'HEAD'),
    event: 'pull_request',
    mode: 'active',
    ...options,
  })
}
function evidence(p, scope = 'ci') {
  return {
    schemaVersion: 1,
    source: p.identity.head,
    planDigest: p.planDigest,
    results: p.targets
      .filter((target) => target.scope === scope)
      .map((target) =>
        target.selected
          ? {
              id: target.id,
              status: 'success',
              inventoryDigest: target.inventoryDigest,
              executedCount: 3,
              basis:
                target.kind === 'site-build'
                  ? 'built-pages'
                  : target.kind === 'candidate-build'
                    ? 'qualified-artifacts'
                    : 'test-cases',
              profiles: target.runtimeProfiles,
              unexpectedSkips: 0,
              observedSkipped: 0,
              artifactsVerified: true,
              residueVerified: true,
            }
          : { id: target.id, status: 'skipped', omissionReason: target.omissionReason },
      ),
  }
}
function context(f, options = {}) {
  const head = git(f.root, 'rev-parse', 'HEAD')
  return {
    head,
    base: f.base,
    prHead: head,
    event: 'pull_request',
    mode: 'active',
    forceFull: false,
    ...options,
  }
}

test('trusted GitHub context accepts the exact proposal and keeps source identity separate from payload authority', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  const head = commit(f.root)
  const expectedContext = trustedWorkflowContext({
    cwd: f.root,
    env: {
      GITHUB_SHA: head,
      GITHUB_EVENT_NAME: 'pull_request',
      MODE: 'active',
      FORCE: 'false',
    },
    event: { pull_request: { base: { sha: f.base }, head: { sha: head } } },
  })
  assert.deepEqual(expectedContext, context(f))
  const p = plan(f)
  for (const scope of ['ci', 'linux', 'macos'])
    assert.equal(
      reconcileAffectedEvidence(p, evidence(p, scope), { cwd: f.root, scope, expectedContext })
        .qualified,
      true,
    )
  assert.throws(
    () =>
      trustedWorkflowContext({
        cwd: f.root,
        env: { GITHUB_SHA: f.base, GITHUB_EVENT_NAME: 'pull_request' },
      }),
    /differs/,
  )
})

test('a reconstructed later-ancestor baseline cannot hide earlier runtime changes from trusted PR context', () => {
  const f = fixture()
  write(f.root, 'packages/jig/src/core.ts', 'export const lifecycle = false')
  const hiddenRuntimeBase = commit(f.root)
  write(f.root, 'site/jig/public/logo.svg', '<svg>last change</svg>')
  commit(f.root)
  assert.equal(plan(f).policy.classification, 'full')
  const forged = plan(f, { base: hiddenRuntimeBase })
  assert.equal(forged.policy.classification, 'public-site')
  assert.equal(forged.decisions.source, false)
  const report = reconcileAffectedEvidence(forged, evidence(forged), {
    cwd: f.root,
    expectedContext: context(f),
  })
  assert.equal(report.qualified, false)
  assert.ok(report.errors.some((message) => message.includes('independently reconstructed')))
})

test('forged active rollout, PR event or disabled full override cannot authorize narrow evidence', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>last change</svg>')
  commit(f.root)
  const forged = plan(f)
  assert.equal(forged.decisions.source, false)
  for (const expectedContext of [
    context(f, { mode: 'shadow' }),
    context(f, { event: 'schedule', base: null, prHead: null }),
    context(f, { forceFull: true }),
  ])
    assert.equal(
      reconcileAffectedEvidence(forged, evidence(forged), { cwd: f.root, expectedContext })
        .qualified,
      false,
    )
})

test('historical source proof cannot qualify a different trusted tested checkout', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  const historical = plan(f)
  write(f.root, 'packages/jig/src/core.ts', 'export const lifecycle = false')
  commit(f.root)
  assert.equal(
    reconcileAffectedEvidence(historical, evidence(historical), {
      cwd: f.root,
      expectedContext: context(f),
    }).qualified,
    false,
  )
})

test('missing GitHub payload identity and malformed policy controls fail closed while scheduled baselines remain null', () => {
  const f = fixture()
  const head = git(f.root, 'rev-parse', 'HEAD')
  const env = {
    GITHUB_SHA: head,
    GITHUB_EVENT_NAME: 'pull_request',
    MODE: 'active',
    FORCE: 'false',
  }
  assert.throws(() => trustedWorkflowContext({ cwd: f.root, env }), /payload/)
  assert.throws(() => trustedWorkflowContext({ cwd: f.root, env, event: {} }), /comparison/)
  assert.throws(
    () => trustedWorkflowContext({ cwd: f.root, env: { ...env, MODE: 'unchecked' }, event: {} }),
    /selection mode/,
  )
  assert.throws(
    () => trustedWorkflowContext({ cwd: f.root, env: { ...env, FORCE: 'unchecked' }, event: {} }),
    /override/,
  )
  const scheduled = trustedWorkflowContext({
    cwd: f.root,
    env: { ...env, GITHUB_EVENT_NAME: 'schedule', MODE: 'shadow' },
    event: {},
  })
  assert.equal(scheduled.base, null)
  assert.equal(scheduled.prHead, null)
  assert.equal(scheduled.mode, 'shadow')
})

test('standalone gate CLI rejects another checkout and honors runner context over artifact declarations', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  const head = commit(f.root)
  const forged = plan(f)
  write(f.root, 'plan.json', JSON.stringify(forged))
  write(f.root, 'evidence.json', JSON.stringify(evidence(forged)))
  write(
    f.root,
    'event.json',
    JSON.stringify({ pull_request: { base: { sha: f.base }, head: { sha: head } } }),
  )
  const result = spawnSync(
    process.execPath,
    [
      new URL('./affected-gate.mjs', import.meta.url).pathname,
      '--root',
      f.root,
      '--plan',
      join(f.root, 'plan.json'),
      '--evidence',
      join(f.root, 'evidence.json'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: head,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: join(f.root, 'event.json'),
        MODE: 'shadow',
        FORCE: 'false',
      },
    },
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stdout, /independently reconstructed/)
})
