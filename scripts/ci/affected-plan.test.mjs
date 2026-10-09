import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, test } from 'node:test'
import { reconcileAffectedEvidence } from './affected-gate.mjs'
import { affectedManifest, createAffectedPlan, digest, githubOutputs } from './affected-plan.mjs'
import { authorizeExpectedSkips } from './expected-skips.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function write(root, path, contents) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), contents)
}
function commit(root, { sampled = false } = {}) {
  git(root, 'add', '--all')
  git(root, 'commit', '--quiet', '-m', 'fixture change')
  // Ordinary narrow-selection fixtures explicitly use an unsampled genuine Git
  // commit. Only audit fixtures opt in; no production policy override exists.
  for (let nonce = 0; nonce < 100; nonce++) {
    const head = git(root, 'rev-parse', 'HEAD')
    const bucket =
      BigInt(`0x${createHash('sha256').update(`jig-ci-full-pr-audit-v1\0${head}`).digest('hex')}`) %
      5n
    if ((bucket === 0n) === sampled) return head
    git(root, 'commit', '--amend', '--quiet', '-m', `fixture change audit seed ${nonce}`)
  }
  assert.fail('Could not construct the requested genuine Git audit fixture')
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jig-affected-tests-'))
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
    'site/justfile': 'build: \n',
    'site/jig/public/logo.svg': '<svg>old</svg>',
    'site/theme/style.css': 'body { color: black }',
  }
  for (const [path, content] of Object.entries(files)) write(root, path, content)
  return { root, base: commit(root) }
}
function plan(f, options = {}) {
  return createAffectedPlan({ cwd: f.root, base: f.base, head: 'HEAD', mode: 'active', ...options })
}
function evidenceFor(p, scope = 'ci') {
  return {
    schemaVersion: 1,
    source: p.identity.head,
    planDigest: p.planDigest,
    results: p.targets
      .filter((target) => scope === 'all' || target.scope === scope)
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
              unexpectedSkips: 0,
              observedSkipped: 0,
              profiles: target.runtimeProfiles,
              artifactsVerified: true,
              residueVerified: true,
            }
          : { id: target.id, status: 'skipped', omissionReason: target.omissionReason },
      ),
  }
}

test('default shadow retains every obligation while reporting bounded site-only omissions', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  const p = plan(f, { mode: 'shadow' })
  assert.equal(p.policy.classification, 'public-site')
  assert.ok(p.targets.every((target) => target.selected))
  assert.equal(p.proposedDecisions.source, false)
  assert.equal(p.proposedDecisions.macos, false)
  assert.deepEqual(p.proposedDecisions.npmPackages, [])
  const defaultPlan = createAffectedPlan({ cwd: f.root, base: f.base })
  assert.equal(defaultPlan.mode, 'shadow')
})

test('a sampled active PR runs every owning scope while retaining the narrow comparison', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>sampled change</svg>')
  const prHead = commit(f.root, { sampled: true })
  const p = plan(f, { prHead })
  assert.equal(p.policy.classification, 'public-site')
  assert.equal(p.audit.selected, true)
  assert.equal(p.audit.eligible, true)
  assert.equal(p.audit.algorithm, 'sha256-modulo-v1')
  assert.equal(p.audit.domain, 'jig-ci-full-pr-audit-v1')
  assert.equal(p.audit.seedKind, 'verified-pr-head')
  assert.equal(p.audit.seed, prHead)
  assert.equal(p.audit.sampleDivisor, 5)
  assert.equal(p.audit.bucket, 0)
  assert.equal(p.proposedDecisions.source, false)
  assert.equal(p.proposedDecisions.candidates, false)
  assert.equal(p.proposedDecisions.linux, false)
  assert.equal(p.proposedDecisions.macos, false)
  assert.ok(p.targets.every((target) => target.selected))
  assert.ok(
    p.targets
      .filter((target) => !target.proposedSelected)
      .every((target) => target.reasons.some((reason) => reason.includes('full PR audit'))),
  )
  assert.deepEqual(plan(f, { prHead }), p)
  for (const scope of ['ci', 'linux', 'macos'])
    assert.equal(
      reconcileAffectedEvidence(p, evidenceFor(p, scope), { cwd: f.root, scope }).qualified,
      true,
    )
  assert.match(githubOutputs(p), /audit_selected=true\n/)
})

test('an unsampled active PR retains proven narrow selection without disabling the sampler', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>unsampled change</svg>')
  const prHead = commit(f.root)
  const p = plan(f)
  assert.equal(p.audit.selected, false)
  assert.equal(p.audit.eligible, true)
  assert.equal(p.audit.seed, prHead)
  assert.notEqual(p.audit.bucket, 0)
  assert.equal(p.audit.sampleDivisor, 5)
  assert.deepEqual(p.decisions, p.proposedDecisions)
  assert.equal(p.decisions.linux, false)
  assert.equal(p.decisions.macos, false)
})

test('PR audits use the unchanged verified proposal across different tested merges and base advances', () => {
  const f = fixture()
  git(f.root, 'checkout', '--quiet', '-b', 'proposal')
  write(f.root, 'site/jig/public/logo.svg', '<svg>same proposal</svg>')
  const prHead = commit(f.root, { sampled: true })
  git(f.root, 'checkout', '--quiet', f.base)
  git(f.root, 'merge', '--no-ff', '--quiet', '-m', 'first tested merge', 'proposal')
  const firstHead = git(f.root, 'rev-parse', 'HEAD')
  const first = plan(f, { head: firstHead, prHead })
  git(f.root, 'checkout', '--quiet', f.base)
  write(f.root, 'README.md', 'independent advanced base\n')
  const advancedBase = commit(f.root)
  git(f.root, 'merge', '--no-ff', '--quiet', '-m', 'second tested merge', 'proposal')
  const secondHead = git(f.root, 'rev-parse', 'HEAD')
  const second = plan({ ...f, base: advancedBase }, { head: secondHead })
  assert.notEqual(first.identity.head, second.identity.head)
  assert.notEqual(first.identity.base, second.identity.base)
  assert.equal(first.identity.prHead, second.identity.prHead)
  assert.deepEqual(first.audit, second.audit)
  assert.equal(second.audit.selected, true)
  assert.equal(second.policy.classification, 'public-site')
})

test('an audit cannot be suppressed by a self-consistent forged decision and digest', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>sampled change</svg>')
  commit(f.root, { sampled: true })
  const p = plan(f)
  p.audit.selected = false
  p.decisions = structuredClone(p.proposedDecisions)
  for (const target of p.targets) target.selected = target.proposedSelected
  const { planDigest: oldDigest, ...body } = p
  p.planDigest = digest(body)
  const result = reconcileAffectedEvidence(p, evidenceFor(p), { cwd: f.root })
  assert.equal(result.qualified, false)
  assert.ok(result.errors.some((error) => error.includes('independently reconstructed')))
})

test('a freshly reconstructed plan cannot use an unsampled merge ancestor to authorize omissions', () => {
  const f = fixture()
  git(f.root, 'checkout', '--quiet', '-b', 'proposal')
  write(f.root, 'site/jig/public/logo.svg', '<svg>sampled proposal</svg>')
  const prHead = commit(f.root, { sampled: true })
  git(f.root, 'checkout', '--quiet', f.base)
  git(f.root, 'merge', '--no-ff', '--quiet', '-m', 'tested sampled merge', 'proposal')
  const head = git(f.root, 'rev-parse', 'HEAD')
  const legitimate = plan(f, { head, prHead })
  assert.equal(legitimate.audit.selected, true)
  const ancestor = plan(f, { head: f.base, prHead: f.base })
  assert.notEqual(ancestor.audit.bucket, 0)

  // Re-run the real constructor with the forged requestedPrHead: every plan
  // field and its digest is fresh and self-consistent, rather than changing a
  // selected flag. The alternate ancestor still cannot authorize exclusions.
  for (const requestedPrHead of [f.base, head]) {
    const forged = plan(f, { head, prHead: requestedPrHead })
    assert.equal(forged.requestedPrHead, requestedPrHead)
    const { planDigest, ...body } = forged
    assert.equal(planDigest, digest(body))
    assert.equal(forged.policy.classification, 'full')
    assert.equal(forged.identity.prHead, null)
    assert.equal(forged.audit.seed, null)
    assert.ok(forged.targets.every((target) => target.selected))
    const evidence = evidenceFor(forged, 'all')
    for (const result of evidence.results) {
      if (!legitimate.targets.find((target) => target.id === result.id).proposedSelected) {
        result.status = 'skipped'
        result.omissionReason = 'Attempted omission using another PR audit seed'
      }
    }
    const report = reconcileAffectedEvidence(forged, evidence, { cwd: f.root, scope: 'all' })
    assert.equal(report.qualified, false)
    assert.ok(report.errors.some((error) => error.includes('Selected target missing')))
  }
  assert.equal(
    reconcileAffectedEvidence(legitimate, evidenceFor(legitimate, 'all'), {
      cwd: f.root,
      scope: 'all',
    }).qualified,
    true,
  )
})

test('an unmerged tested PR revision requires its own exact head as an explicit audit seed', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>sampled direct proposal</svg>')
  const head = commit(f.root, { sampled: true })
  const legitimate = plan(f, { head, prHead: head })
  assert.equal(legitimate.audit.selected, true)
  assert.equal(legitimate.identity.prHead, head)
  const forged = plan(f, { head, prHead: f.base })
  assert.equal(forged.policy.classification, 'full')
  assert.equal(forged.identity.prHead, null)
  assert.ok(forged.targets.every((target) => target.selected))
})

test('shadow, non-PR and explicit full overrides retain their full-execution precedence', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>sampled change</svg>')
  commit(f.root, { sampled: true })
  const shadow = plan(f, { mode: 'shadow' })
  assert.equal(shadow.audit.selected, false)
  assert.equal(shadow.audit.eligible, false)
  assert.equal(shadow.audit.bucket, 0)
  assert.equal(shadow.proposedDecisions.source, false)
  assert.ok(shadow.targets.every((target) => target.selected))
  for (const options of [{ event: 'push' }, { event: 'workflow_dispatch' }, { forceFull: true }]) {
    const p = plan(f, options)
    assert.equal(p.audit.selected, false)
    assert.equal(p.audit.eligible, false)
    assert.ok(p.targets.every((target) => target.selected))
  }
})

test('missing or unreviewed audit configuration and unresolved PR seeds select full work', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>ordinary change</svg>')
  commit(f.root)
  for (const audits of [
    undefined,
    null,
    {},
    { sampleDivisor: 0 },
    { sampleDivisor: 1 },
    { sampleDivisor: 10 },
    { sampleDivisor: '5' },
    { sampleDivisor: 5, disabled: true },
  ]) {
    const p = plan(f, { manifest: { ...structuredClone(affectedManifest), audits } })
    assert.equal(p.policy.classification, 'full')
    assert.equal(p.audit.selected, false)
    assert.equal(p.audit.eligible, false)
    assert.ok(p.targets.every((target) => target.selected))
  }
  const p = plan(f, { prHead: 'missing-pr-head' })
  assert.equal(p.policy.classification, 'full')
  assert.equal(p.audit.seed, null)
  assert.equal(p.audit.selected, false)
  assert.ok(p.targets.every((target) => target.selected))
})

test('active site additions, deletions and same-boundary renames omit unrelated jobs', () => {
  const f = fixture()
  renameSync(join(f.root, 'site/jig/public/logo.svg'), join(f.root, 'site/jig/public/mark.svg'))
  write(f.root, 'site/jig/public/new.css', 'a {}')
  rmSync(join(f.root, 'site/theme/style.css'))
  commit(f.root)
  const p = plan(f)
  assert.equal(p.policy.classification, 'public-site')
  assert.equal(p.decisions.sites, true)
  assert.equal(p.decisions.quick, true)
  assert.equal(p.decisions.source, false)
  assert.ok(
    p.changes.some(
      (change) =>
        change.oldPath === 'site/jig/public/logo.svg' && change.path === 'site/jig/public/mark.svg',
    ),
  )
  assert.ok(p.changes.some((change) => change.status === 'D'))
})

test('isolated Python source and added/deleted tests retain complete source and installed matrix', () => {
  const f = fixture()
  write(f.root, 'packages/jiggy-flow/src/jiggy/flow/runtime.py', 'RUNTIME = 2\n')
  write(f.root, 'packages/jiggy-flow/tests/test_new.py', 'def test_new(): pass\n')
  rmSync(join(f.root, 'packages/jiggy-flow/tests/test_runtime.py'))
  commit(f.root)
  const p = plan(f)
  assert.equal(p.policy.classification, 'python')
  assert.equal(p.decisions.source, true)
  assert.equal(p.decisions.python, true)
  assert.equal(p.decisions.sites, false)
  assert.equal(p.decisions.linux, false)
  assert.equal(p.decisions.candidates, false)
  assert.ok(p.inventory.added.includes('packages/jiggy-flow/tests/test_new.py'))
  assert.ok(p.inventory.removed.includes('packages/jiggy-flow/tests/test_runtime.py'))
  assert.ok(p.graph.affectedOwners.includes('conformance/run-0'))
  assert.ok(p.graph.affectedOwners.includes('packages/jiggy-user-updates'))
  const source = p.targets.find((target) => target.id === 'source-tests')
  assert.ok(source.inventory.includes('packages/jiggy-flow/tests/test_new.py'))
  assert.ok(!source.inventory.includes('packages/jiggy-flow/tests/test_runtime.py'))
  assert.equal(
    p.targets.find((target) => target.id === 'python-installed').runtimeProfiles.length,
    6,
  )
})

test('old and new graph union preserves removed transitive dependency consumers', () => {
  const f = fixture()
  write(
    f.root,
    'packages/agent-method/package.json',
    '{"name":"@jigging/agent-method","dependencies":{}}',
  )
  write(f.root, 'packages/flow-sdk/src/new.ts', 'export const newApi = true')
  commit(f.root)
  const p = plan(f)
  assert.equal(p.policy.classification, 'full')
  assert.ok(p.graph.affectedOwners.includes('packages/jig'))
  assert.ok(
    p.graph.old.edges.some(
      (edge) =>
        edge.consumer === 'packages/agent-method' && edge.dependency === 'packages/flow-sdk',
    ),
  )
  assert.ok(
    !p.graph.current.edges.some(
      (edge) =>
        edge.consumer === 'packages/agent-method' && edge.dependency === 'packages/flow-sdk',
    ),
  )
})

test('independent site and Python changes compose without dropping either obligation', () => {
  const f = fixture()
  write(f.root, 'site/theme/style.css', 'body { color: blue }')
  write(f.root, 'packages/jiggy-flow/src/jiggy/flow/runtime.py', 'RUNTIME = 2\n')
  commit(f.root)
  const p = plan(f)
  assert.equal(p.policy.classification, 'site-and-python')
  assert.equal(p.decisions.sites, true)
  assert.equal(p.decisions.source, true)
  assert.equal(p.decisions.python, true)
  assert.equal(p.decisions.linux, false)
})

test('standalone installed smoke entrypoints enter the source and host inventories', () => {
  const f = fixture()
  write(f.root, 'packages/jig/test/package-smoke.ts', 'await testOrdinaryConsumer()')
  commit(f.root)
  const p = plan(f)
  assert.ok(p.inventory.entrypoints.includes('packages/jig/test/package-smoke.ts'))
  for (const id of ['source-tests', 'linux', 'macos-x64', 'macos-arm64'])
    assert.ok(
      p.targets
        .find((target) => target.id === id)
        .inventory.includes('packages/jig/test/package-smoke.ts'),
    )
})

test('Linux host inventory distinguishes hostile coverage and rejects an unassigned native case', () => {
  const f = fixture()
  write(f.root, 'packages/jig/test/portable.test.ts', 'test("portable", () => {})')
  const base = commit(f.root)
  write(f.root, 'site/theme/style.css', 'body { color: blue }')
  commit(f.root)
  const p = plan({ ...f, base })
  assert.equal(p.policy.classification, 'public-site')
  assert.ok(
    !p.targets
      .find((target) => target.id === 'linux')
      .inventory.includes('packages/jig/test/portable.test.ts'),
  )
  assert.ok(
    p.targets
      .find((target) => target.id === 'macos-x64')
      .inventory.includes('packages/jig/test/portable.test.ts'),
  )
  write(
    f.root,
    'packages/jig/test/new-host.test.ts',
    'if (process.env.JIG_LINUX_ROOTLESS_HOSTILE) test("owned", () => {})',
  )
  commit(f.root)
  assert.ok(
    plan(f).policy.fallbackReasons.some((reason) => reason.includes('absent from owning workflow')),
  )
})

test('a Python consumer outside conformance invalidates the isolation policy', () => {
  const f = fixture()
  write(
    f.root,
    'packages/jig/package.json',
    '{"name":"@jigging/jig","dependencies":{"jiggy-flow":"1.0"}}',
  )
  const base = commit(f.root)
  write(f.root, 'packages/jiggy-flow/src/jiggy/flow/runtime.py', 'RUNTIME = 2\n')
  commit(f.root)
  const p = plan({ ...f, base })
  assert.equal(p.policy.classification, 'full')
  assert.ok(p.policy.fallbackReasons.some((reason) => reason.includes('outside the proven')))
  assert.equal(p.decisions.macos, true)
})

test('a cross-boundary rename considers the deleted source endpoint', () => {
  const f = fixture()
  write(f.root, 'packages/jig/src/template.html', '<h1>hello</h1>')
  const base = commit(f.root)
  renameSync(
    join(f.root, 'packages/jig/src/template.html'),
    join(f.root, 'site/jig/public/template.html'),
  )
  commit(f.root)
  const p = plan({ ...f, base })
  assert.equal(p.policy.classification, 'full')
  assert.equal(p.decisions.source, true)
  assert.equal(p.decisions.linux, true)
})

test('docs, copied contracts, embedded web, tooling and package resolution metadata force broad execution', () => {
  const paths = [
    'docs/flow/guide/platforms.md',
    'docs/jig/spec/contracts/agent-run/contract.json',
    'LICENSE.md',
    'PRICING.md',
    'packages/jig/src/web/app.css',
    'packages/jig/src/web/index.html',
    'packages/jig/patches/a.patch',
    'scripts/ci/affected-manifest.json',
    '.github/workflows/ci.yml',
    'packages/jiggy-flow/pyproject.toml',
    'site/package.json',
    'package.json',
  ]
  for (const path of paths) {
    const f = fixture()
    write(
      f.root,
      path,
      path.endsWith('package.json')
        ? '{"name":"changed","devDependencies":{"external":"2.0"}}'
        : path.endsWith('pyproject.toml')
          ? '[project]\nname = "jiggy-flow"\ndependencies = ["external>=2"]\n'
          : 'changed input\n',
    )
    commit(f.root)
    const p = plan(f)
    assert.equal(p.policy.classification, 'full', path)
    assert.ok(
      p.targets.every((target) => target.selected),
      path,
    )
  }
})

test('unknown inputs and previously unknown discovered tests fail closed', () => {
  const f = fixture()
  write(f.root, 'unknown/metadata.dat', 'unknown')
  commit(f.root)
  assert.equal(plan(f).policy.classification, 'full')
  write(f.root, 'new-domain/test_proof.py', 'def test_proof(): pass\n')
  const base = commit(f.root)
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  const p = plan({ ...f, base })
  assert.equal(p.policy.classification, 'full')
  assert.ok(p.policy.fallbackReasons.some((reason) => reason.includes('Unowned discovered test')))
  assert.equal(reconcileAffectedEvidence(p, evidenceFor(p), { cwd: f.root }).qualified, false)
})

test('an entirely new package cannot inherit test execution from the existing source script', () => {
  const f = fixture()
  write(f.root, 'packages/new-package/package.json', '{"name":"@jigging/new-package"}')
  write(f.root, 'packages/new-package/test/new.test.ts', 'test("new", () => {})')
  commit(f.root)
  const p = plan(f)
  assert.equal(p.policy.classification, 'full')
  assert.ok(p.inventory.coverageErrors.some((error) => error.includes('new-package')))
  assert.equal(reconcileAffectedEvidence(p, evidenceFor(p), { cwd: f.root }).qualified, false)
})

test('a tooling recipe comment cannot assign execution to an unwired test', () => {
  const f = fixture()
  write(f.root, 'scripts/not-wired.test.ts', 'test("new", () => {})')
  write(
    f.root,
    'justfile',
    '# Consider running scripts/not-wired.test.ts\ntest-tooling:\n    node --test scripts/ci/*.test.mjs\n',
  )
  commit(f.root)
  const p = plan(f)
  assert.ok(p.inventory.coverageErrors.some((error) => error.includes('scripts/not-wired.test.ts')))
  assert.equal(reconcileAffectedEvidence(p, evidenceFor(p), { cwd: f.root }).qualified, false)
})

test('symlinks cannot inherit site or Python isolation', () => {
  const f = fixture()
  symlinkSync('../../../../packages/jig/src/core.ts', join(f.root, 'site/jig/public/borrowed.css'))
  commit(f.root)
  const p = plan(f)
  assert.equal(p.policy.classification, 'full')
  assert.ok(p.policy.fallbackReasons.some((reason) => reason.includes('Symlink')))
})

test('missing history, empty delta, force-full, push and combined merge events execute everything', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  for (const options of [
    { base: 'missing-commit' },
    { base: 'HEAD' },
    { forceFull: true },
    { event: 'push' },
    { event: 'merge_group' },
    { event: 'workflow_dispatch' },
  ]) {
    const p = plan(f, options)
    assert.equal(p.policy.classification, 'full')
    assert.ok(p.targets.every((target) => target.selected))
  }
})

test('a changed base outside the tested state is not accepted as an isolation baseline', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>head</svg>')
  const head = commit(f.root)
  git(f.root, 'checkout', '--quiet', f.base)
  write(f.root, 'packages/jig/src/core.ts', 'export const lifecycle = false')
  const base = commit(f.root)
  const p = plan(f, { base, head })
  assert.equal(p.policy.classification, 'full')
  assert.ok(p.policy.fallbackReasons.some((reason) => reason.includes('non-ancestor')))
})

test('the proposed merge, PR head and advanced base retain distinct identities', () => {
  const f = fixture()
  git(f.root, 'checkout', '--quiet', '-b', 'proposal')
  write(f.root, 'site/theme/style.css', 'body { color: blue }')
  const prHead = commit(f.root)
  git(f.root, 'checkout', '--quiet', f.base)
  write(f.root, 'README.md', 'qualified newer base\n')
  const base = commit(f.root)
  git(f.root, 'merge', '--no-ff', '--quiet', '-m', 'proposed merge', 'proposal')
  const head = git(f.root, 'rev-parse', 'HEAD')
  const p = plan({ ...f, base }, { head })
  assert.equal(p.policy.classification, 'public-site')
  assert.equal(p.identity.head, head)
  assert.equal(p.identity.prHead, prHead)
  assert.equal(p.identity.base, base)
  assert.notEqual(p.identity.headTree, p.identity.baseTree)
  assert.equal(reconcileAffectedEvidence(p, evidenceFor(p), { cwd: f.root }).qualified, true)
  assert.equal(
    plan({ ...f, base }, { head, prHead: 'missing-pr-head' }).policy.classification,
    'full',
  )
})

test('malformed package and Python dependency syntax refuses narrow exclusions', () => {
  for (const path of ['packages/jig/package.json', 'packages/jiggy-flow/pyproject.toml']) {
    const f = fixture()
    write(f.root, path, 'this is invalid metadata')
    const base = commit(f.root)
    write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
    commit(f.root)
    const p = plan({ ...f, base })
    assert.equal(p.policy.classification, 'full')
    assert.ok(p.policy.fallbackReasons.some((reason) => reason.includes('Cannot infer')))
  }
})

test('reconciliation accepts genuine selected obligations and explicit source-derived omissions', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  const p = plan(f)
  const evidence = evidenceFor(p, 'all')
  assert.equal(
    reconcileAffectedEvidence(p, evidence, { cwd: f.root, scope: 'all' }).qualified,
    true,
  )
})

test('a self-consistent forged plan cannot omit independently required work', () => {
  const f = fixture()
  write(f.root, 'packages/jig/src/core.ts', 'export const lifecycle = false')
  commit(f.root)
  const p = plan(f)
  p.targets.find((target) => target.id === 'source-tests').selected = false
  p.targets.find((target) => target.id === 'source-tests').omissionReason = 'invented reason'
  p.decisions.source = false
  const { planDigest: oldDigest, ...body } = p
  p.planDigest = digest(body)
  const report = reconcileAffectedEvidence(p, evidenceFor(p), { cwd: f.root })
  assert.equal(report.qualified, false)
  assert.ok(report.errors.some((error) => error.includes('independently reconstructed')))
})

test('missing, cancelled, failed, skipped, empty, stale and wrong-profile selected evidence fails', () => {
  const f = fixture()
  write(f.root, 'packages/jig/src/core.ts', 'export const lifecycle = false')
  commit(f.root)
  const p = plan(f)
  const mutations = [
    (e) => {
      e.results = e.results.filter((r) => r.id !== 'source-tests')
    },
    ...['failure', 'cancelled', 'skipped'].map((status) => (e) => {
      e.results.find((r) => r.id === 'source-tests').status = status
    }),
    (e) => {
      e.results.find((r) => r.id === 'source-tests').executedCount = 0
    },
    (e) => {
      e.results.find((r) => r.id === 'source-tests').unexpectedSkips = 1
    },
    (e) => {
      e.results.find((r) => r.id === 'python-installed').profiles.pop()
    },
    (e) => {
      e.results.find((r) => r.id === 'source-tests').inventoryDigest = 'wrong'
    },
    (e) => {
      e.results.find((r) => r.id === 'npm-candidate').artifactsVerified = false
    },
    (e) => {
      e.source = f.base
    },
    (e) => {
      e.planDigest = 'stale-plan'
    },
    (e) => {
      e.results.push(structuredClone(e.results[0]))
    },
  ]
  for (const mutate of mutations) {
    const evidence = structuredClone(evidenceFor(p))
    mutate(evidence)
    assert.equal(reconcileAffectedEvidence(p, evidence, { cwd: f.root }).qualified, false)
  }
})

test('native scope cannot qualify with source-only success, missing residue or another architecture', () => {
  const f = fixture()
  write(f.root, 'packages/jig/src/core.ts', 'export const lifecycle = false')
  commit(f.root)
  const p = plan(f)
  const evidence = evidenceFor(p, 'macos')
  assert.equal(
    reconcileAffectedEvidence(p, evidence, { cwd: f.root, scope: 'macos' }).qualified,
    true,
  )
  evidence.results[0].residueVerified = false
  assert.equal(
    reconcileAffectedEvidence(p, evidence, { cwd: f.root, scope: 'macos' }).qualified,
    false,
  )
  assert.equal(
    reconcileAffectedEvidence(p, evidenceFor(p, 'ci'), { cwd: f.root, scope: 'macos' }).qualified,
    false,
  )
})

test('omission requires a policy-derived reason and cannot conceal selected skips', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  const p = plan(f)
  const evidence = evidenceFor(p)
  evidence.results.find((result) => result.id === 'source-tests').omissionReason = 'trust me'
  assert.equal(reconcileAffectedEvidence(p, evidence, { cwd: f.root }).qualified, false)
})

test('the independent gate repeats source-bound skip authorization and checks observed totals', () => {
  const f = fixture()
  const file = 'packages/jig/test/file-input.test.ts'
  write(f.root, file, readFileSync(resolve(import.meta.dirname, '../..', file)))
  commit(f.root)
  const p = plan(f)
  const e = evidenceFor(p)
  const row = e.results.find((item) => item.id === 'source-tests')
  const skipPolicy = p.targets.find((item) => item.id === row.id).skipPolicy
  Object.assign(
    row,
    authorizeExpectedSkips({
      repository: f.root,
      source: p.identity.head,
      targetId: row.id,
      profile: row.profiles[0],
      skipPolicy,
      skippedCases: [
        { file, classname: '', name: 'Mac capture refuses case variants of private Jig state' },
      ],
    }),
    { skipPolicy },
  )
  assert.equal(reconcileAffectedEvidence(p, e, { cwd: f.root }).qualified, true)
  for (const edit of [
    (item) => {
      item.skippedCaseDigest = 'forged'
    },
    (item) => {
      item.observedSkipped++
    },
    (item) => {
      item.skippedCases[0].name =
        'captures selected binary and empty files into sealed anonymous input'
    },
    (item) => {
      delete item.skipPolicy
    },
    (item) => {
      delete item.skippedCases
    },
  ]) {
    const changed = structuredClone(e)
    edit(changed.results.find((item) => item.id === row.id))
    assert.equal(reconcileAffectedEvidence(p, changed, { cwd: f.root }).qualified, false)
  }
  const changed = structuredClone(e)
  delete changed.results.find((item) => item.id === 'quick-checks').observedSkipped
  assert.equal(reconcileAffectedEvidence(p, changed, { cwd: f.root }).qualified, false)
})

test('CLI emits stable JSON and literal GitHub outputs without treating refs as shell code', () => {
  const f = fixture()
  write(f.root, 'site/jig/public/logo.svg', '<svg>new</svg>')
  commit(f.root)
  const output = join(f.root, 'plan-output.json')
  const githubOutput = join(f.root, 'github-output.txt')
  const script = resolve(import.meta.dirname, 'affected-plan.mjs')
  const run = spawnSync(
    process.execPath,
    [
      script,
      '--root',
      f.root,
      '--base',
      f.base,
      '--head',
      'HEAD',
      '--output',
      output,
      '--github-output',
      githubOutput,
    ],
    { encoding: 'utf8' },
  )
  assert.equal(run.status, 0, run.stderr)
  const p = JSON.parse(run.stdout)
  assert.equal(p.mode, 'shadow')
  assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), p)
  assert.equal(readFileSync(githubOutput, 'utf8'), githubOutputs(p))
  const malicious = spawnSync(
    process.execPath,
    [script, '--root', f.root, '--base', '$(touch should-not-exist)', '--head', 'HEAD'],
    { encoding: 'utf8' },
  )
  assert.equal(malicious.status, 0)
  assert.equal(JSON.parse(malicious.stdout).policy.classification, 'full')
  assert.throws(() => readFileSync(join(f.root, 'should-not-exist')))
  assert.throws(() => plan(f, { mode: 'implicit-active' }))
})
