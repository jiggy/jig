#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const affectedManifest = JSON.parse(
  readFileSync(new URL('./affected-manifest.json', import.meta.url), 'utf8'),
)
const TEST_FILE = /(?:\.(?:test|spec)|_(?:test|spec))\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$/
const INSTALLED_ENTRYPOINT = /^packages\/[^/]+\/(?:test|tests)\/package[-_]smoke\.(?:ts|py)$/
const PACKAGE_MANIFEST = /(?:^|\/)package\.json$/
const WORKSPACE_MANIFEST =
  /^(?:packages\/[^/]+\/package\.json|examples\/[^/]+\/(?:package\.json|(?:flows|methods)\/[^/]+\/package\.json)|conformance\/run-0\/package\.json)$/
const FULL_DECISIONS = Object.freeze({
  quick: true,
  sites: true,
  source: true,
  python: true,
  candidates: true,
  npmPackages: ['flow', 'agent', 'acp', 'jig'],
  linux: true,
  macos: true,
})
const AUDIT_ALGORITHM = 'sha256-modulo-v1'
const AUDIT_DOMAIN = 'jig-ci-full-pr-audit-v1'

// Stable identities deliberately exclude wall-clock time, ambient variables and
// cache history. This planner never transfers a passing result between runs.
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}
function git(cwd, args, acceptableStatuses = [0]) {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  if (result.error || !acceptableStatuses.includes(result.status))
    throw new Error('Git source information is unavailable')
  return result.stdout
}
function revision(cwd, ref) {
  if (typeof ref !== 'string' || !ref || ref.includes('\0')) throw new Error('Missing Git revision')
  const result = git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim()
  if (!/^[0-9a-f]{40,64}$/.test(result)) throw new Error('Invalid Git revision')
  return result
}
export function ownersForPath(path) {
  if (path.startsWith('packages/')) return [path.split('/').slice(0, 2).join('/')]
  if (path.startsWith('examples/')) return [path.split('/').slice(0, 2).join('/')]
  if (path.startsWith('conformance/run-0/')) return ['conformance/run-0']
  if (path.startsWith('docs/flow/guide/')) return ['docs/flow/guide']
  if (path.startsWith('docs/flow/spec/')) return ['docs/flow/spec']
  if (path.startsWith('docs/jig/spec/')) return ['docs/jig/spec']
  if (path.startsWith('docs/flow/')) return ['docs/flow']
  if (path.startsWith('docs/jig/')) return ['docs/jig']
  if (path.startsWith('site/')) return ['sites']
  if (/^(?:scripts\/|\.github\/|\.agents\/|\.codex\/)/.test(path)) return ['automation']
  if (/^(?:LICENSES\/|LICENSE(?:S)?\.md$|PRICING\.md$)/.test(path)) return ['packages/jig', 'sites']
  if (
    /^[^/]+\.(?:md|json|nix)$/.test(path) ||
    ['justfile', '.gitignore', '.gitattributes', '.envrc'].includes(path)
  )
    return ['repository']
  return []
}
function classifyPath(path, manifest) {
  if (
    manifest.publicSiteRoots.some((root) => path.startsWith(root)) &&
    manifest.publicSiteExtensions.includes(extname(path))
  )
    return 'public-site'
  for (const root of manifest.pythonPackages) {
    if (
      (path.startsWith(`${root}/src/`) || path.startsWith(`${root}/tests/`)) &&
      (path.endsWith('.py') || path.endsWith('/py.typed'))
    )
      return 'python'
  }
  return 'full'
}
function snapshot(cwd, sha, manifest) {
  const files = git(cwd, ['ls-tree', '-rz', '--full-tree', sha])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+) (\S+) ([0-9a-f]+)\t([\s\S]+)$/.exec(entry)
      if (match?.[2] !== 'blob') throw new Error('Unsupported source inventory entry')
      return { path: match[4], mode: match[1], oid: match[3] }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  const nodes = new Map()
  const names = new Map()
  const errors = []
  const coverageErrors = []
  for (const file of files.filter(
    (file) => PACKAGE_MANIFEST.test(file.path) && WORKSPACE_MANIFEST.test(file.path),
  )) {
    const owner = file.path.slice(0, -'/package.json'.length)
    try {
      const declaration = JSON.parse(git(cwd, ['show', `${sha}:${file.path}`]))
      const dependencies = []
      for (const section of [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]) {
        if (
          declaration[section] !== undefined &&
          (!declaration[section] ||
            typeof declaration[section] !== 'object' ||
            Array.isArray(declaration[section]))
        )
          throw new Error('Unsupported dependencies')
        for (const [name, value] of Object.entries(declaration[section] ?? {})) {
          if (typeof value !== 'string') throw new Error('Unsupported dependency declaration')
          dependencies.push(name)
        }
      }
      if (typeof declaration.name === 'string') {
        if (names.has(declaration.name)) throw new Error('Repeated workspace package name')
        names.set(declaration.name, owner)
      }
      nodes.set(owner, {
        owner,
        packageName: declaration.name ?? null,
        dependencies: dependencies.sort(),
      })
    } catch {
      errors.push(`Cannot infer package dependencies: ${file.path}`)
    }
  }
  for (const root of manifest.pythonPackages) {
    const path = `${root}/pyproject.toml`
    if (!files.some((file) => file.path === path)) continue
    try {
      const toml = git(cwd, ['show', `${sha}:${path}`])
      const project = /^\[project\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m.exec(toml)?.[1]
      const packageName = /^name\s*=\s*["']([^"']+)["']\s*$/m.exec(project ?? '')?.[1]
      if (!project || !packageName || names.has(packageName))
        throw new Error('Unsupported Python declaration')
      const declaration = /^dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(project)?.[1]
      const dependencies = []
      if (declaration !== undefined) {
        const strings = [...declaration.matchAll(/["']([^"']+)["']/g)]
        if (declaration.replace(/["'][^"']+["']/g, '').replace(/[,\s]/g, '') !== '')
          throw new Error('Unsupported Python dependency syntax')
        for (const match of strings) {
          const name = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(match[1])?.[0]
          if (!name) throw new Error('Unsupported Python requirement')
          dependencies.push(name)
        }
      }
      names.set(packageName, root)
      nodes.set(root, { owner: root, packageName, dependencies: dependencies.sort() })
    } catch {
      errors.push(`Cannot infer Python dependencies: ${path}`)
    }
  }
  const edges = manifest.declaredEdges.map(([consumer, dependency]) => ({
    consumer,
    dependency,
    reason: 'declared non-import input',
  }))
  for (const node of nodes.values()) {
    for (const dependency of node.dependencies) {
      if (names.has(dependency))
        edges.push({
          consumer: node.owner,
          dependency: names.get(dependency),
          reason: 'package manifest dependency',
        })
    }
    const packageOwner = ownersForPath(`${node.owner}/package.json`)[0]
    if (packageOwner && packageOwner !== node.owner)
      edges.push({
        consumer: packageOwner,
        dependency: node.owner,
        reason: 'workspace discovery membership',
      })
  }
  edges.sort((a, b) => stableJson(a).localeCompare(stableJson(b)))
  const discoveredTests = files.filter((file) => TEST_FILE.test(file.path)).map((file) => file.path)
  const externalInventory = discoveredTests.filter((path) =>
    (manifest.externalTestRoots ?? []).some((root) => path.startsWith(root)),
  )
  const inventory = discoveredTests.filter((path) => !externalInventory.includes(path))
  const entrypoints = [
    ...new Set([
      ...manifest.targets.flatMap((target) => target.entrypoints),
      ...files.filter((file) => INSTALLED_ENTRYPOINT.test(file.path)).map((file) => file.path),
    ]),
  ]
    .filter((path) => files.some((file) => file.path === path))
    .sort()
  const toolingRecipe = files.some((file) => file.path === 'justfile')
    ? git(cwd, ['show', `${sha}:justfile`])
    : ''
  const toolingCommands = toolingRecipe
    .split('\n')
    .filter((line) => /^\s+(?:bun\s+test|node\s+--test)\s+/.test(line))
    .join('\n')
  for (const path of inventory) {
    const owners = ownersForPath(path)
    const sourceOwned =
      manifest.sourceTestRoots.some((root) => path.startsWith(root)) ||
      path === 'scripts/test_pypi_release.py'
    const toolingOwned =
      /^scripts\/ci\/[^/]+\.test\.mjs$/.test(path) ||
      (path.startsWith('scripts/') && toolingCommands.includes(path))
    if (owners.length === 0 || (!sourceOwned && !toolingOwned))
      coverageErrors.push(`Unowned discovered test: ${path}`)
  }
  let linuxHostInventory = []
  const linuxWorkflow = '.github/workflows/linux-host-conformance.yml'
  if (files.some((file) => file.path === linuxWorkflow)) {
    const workflow = git(cwd, ['show', `${sha}:${linuxWorkflow}`])
    linuxHostInventory = [
      ...new Set(
        workflow.match(/packages\/jig\/test\/[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?/g) ?? [],
      ),
    ].sort()
    const marked = git(
      cwd,
      [
        'grep',
        '-lz',
        '--full-name',
        '-e',
        'JIG_LINUX_ROOTLESS_HOSTILE',
        sha,
        '--',
        'packages/jig/test/',
      ],
      [0, 1],
    )
      .split('\0')
      .filter(Boolean)
      .map((path) => path.slice(sha.length + 1))
      .filter((path) => TEST_FILE.test(path))
    for (const path of marked)
      if (!linuxHostInventory.includes(path))
        coverageErrors.push(`Discovered Linux hostile test absent from owning workflow: ${path}`)
    for (const path of linuxHostInventory)
      if (!inventory.includes(path))
        coverageErrors.push(`Linux host inventory references absent test: ${path}`)
  } else coverageErrors.push('Missing Linux host ownership workflow')
  return {
    files,
    inventory,
    externalInventory,
    entrypoints,
    linuxHostInventory,
    coverageErrors,
    graph: { nodes: [...nodes.values()], edges },
    errors: [...errors, ...coverageErrors],
  }
}
function changesBetween(cwd, base, head) {
  const pieces = git(cwd, ['diff', '--name-status', '-z', '--find-renames', base, head, '--'])
    .split('\0')
    .filter(Boolean)
  const changes = []
  for (let index = 0; index < pieces.length; ) {
    const status = pieces[index++]
    const first = pieces[index++]
    if (!first || !/^[ACDMRTUXB]\d*$/.test(status))
      throw new Error('Unsupported Git change inventory')
    const renamed = /^[RC]/.test(status)
    const path = renamed ? pieces[index++] : first
    if (!path) throw new Error('Incomplete rename inventory')
    changes.push({ status, path, oldPath: renamed || status === 'D' ? first : null })
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
function closure(owners, graphs) {
  const affected = new Set(owners)
  const edges = graphs.flatMap((graph) => graph?.edges ?? [])
  let changed = true
  while (changed) {
    changed = false
    for (const { consumer, dependency } of edges) {
      if (affected.has(dependency) && !affected.has(consumer)) {
        affected.add(consumer)
        changed = true
      }
    }
  }
  return [...affected].sort()
}
function selectedForTarget(id, decisions) {
  if (id === 'quick-checks') return decisions.quick
  if (id === 'sites') return decisions.sites
  if (id === 'source-tests') return decisions.source
  if (id.startsWith('python-')) return decisions.python
  if (id === 'npm-candidate') return decisions.candidates
  if (id === 'linux') return decisions.linux
  if (id.startsWith('macos-')) return decisions.macos
  throw new Error(`Unknown target: ${id}`)
}

export function createAffectedPlan({
  cwd = process.cwd(),
  base = null,
  head = 'HEAD',
  prHead = null,
  event = 'pull_request',
  mode = 'shadow',
  forceFull = false,
  manifest = affectedManifest,
} = {}) {
  if (!['shadow', 'active'].includes(mode))
    throw new Error('Selection mode must be shadow or active')
  if (typeof event !== 'string' || !/^[a-z_]+$/.test(event))
    throw new Error('Invalid workflow event')
  const headSha = revision(cwd, head)
  const current = snapshot(cwd, headSha, manifest)
  const fallbackReasons = [...current.errors]
  const auditConfigurationValid =
    manifest.audits &&
    !Array.isArray(manifest.audits) &&
    Object.keys(manifest.audits).length === 1 &&
    manifest.audits.sampleDivisor === 5
  if (!auditConfigurationValid)
    fallbackReasons.push('Missing or unreviewed deterministic PR audit configuration')
  const parents = git(cwd, ['rev-list', '--parents', '-n', '1', headSha]).trim().split(' ').slice(1)
  // A requested ancestor cannot choose another audit seed. The tested
  // two-parent PR merge identifies the exact proposal through its second
  // parent; an unmerged tested revision identifies itself as the proposal.
  const testedPrHead =
    event === 'pull_request' && parents.length <= 2
      ? parents.length === 2
        ? parents[1]
        : headSha
      : null
  let prHeadSha = testedPrHead
  if (event === 'pull_request' && !testedPrHead)
    fallbackReasons.push('Tested merge does not identify one exact PR source head')
  if (prHead !== null) {
    try {
      const requestedPrHead = revision(cwd, prHead)
      if (requestedPrHead !== testedPrHead)
        throw new Error('Supplied PR head does not match the tested proposal')
      prHeadSha = requestedPrHead
    } catch {
      prHeadSha = null
      fallbackReasons.push('PR head is unavailable or does not exactly match the tested proposal')
    }
  }
  let baseSha = null
  let previous = null
  let changes = []
  try {
    baseSha = revision(cwd, base)
    previous = snapshot(cwd, baseSha, manifest)
    changes = changesBetween(cwd, baseSha, headSha)
    fallbackReasons.push(...previous.errors)
    // A diverged base is not a verified comparison for this proposed merge.
    git(cwd, ['merge-base', '--is-ancestor', baseSha, headSha])
  } catch {
    fallbackReasons.push('Missing, unavailable or non-ancestor verified baseline')
  }
  if (forceFull) fallbackReasons.push('Full execution explicitly requested')
  if (event !== 'pull_request')
    fallbackReasons.push('Main, manual and merge-group qualification executes complete fresh work')
  if (changes.length === 0) fallbackReasons.push('No complete nonempty input delta established')
  const oldModes = new Map(previous?.files.map((file) => [file.path, file.mode]) ?? [])
  const newModes = new Map(current.files.map((file) => [file.path, file.mode]))
  const classes = new Set()
  const normalizedChanges = changes.map((change) => {
    const paths = [...new Set([change.path, change.oldPath].filter(Boolean))]
    const owners = [...new Set(paths.flatMap(ownersForPath))].sort()
    const reasons = paths.map((path) => {
      const classification = classifyPath(path, manifest)
      classes.add(classification)
      if (ownersForPath(path).length === 0) fallbackReasons.push(`Unknown changed input: ${path}`)
      if (oldModes.get(path) === '120000' || newModes.get(path) === '120000')
        fallbackReasons.push(`Symlink input cannot establish isolation: ${path}`)
      return `${classification} ownership: ${path}`
    })
    return { ...change, owners, reasons }
  })
  if (classes.has('full'))
    fallbackReasons.push('Shared, host, build, harness, runtime or unproven input changed')
  const affectedOwners = closure(
    normalizedChanges.flatMap((change) => change.owners),
    [previous?.graph, current.graph],
  )
  const pythonOwners = normalizedChanges
    .filter((change) =>
      [change.path, change.oldPath]
        .filter(Boolean)
        .some((path) => classifyPath(path, manifest) === 'python'),
    )
    .flatMap((change) => change.owners)
  if (
    classes.has('python') &&
    closure(pythonOwners, [previous?.graph, current.graph]).some(
      (owner) => !manifest.pythonPackages.includes(owner) && owner !== 'conformance/run-0',
    )
  )
    fallbackReasons.push(
      'Python package has a consumer outside the proven source/conformance boundary',
    )
  const uniqueFallbacks = [...new Set(fallbackReasons)].sort()
  const classification = uniqueFallbacks.length
    ? 'full'
    : classes.size === 1
      ? [...classes][0]
      : 'site-and-python'
  const proposedDecisions =
    classification === 'full'
      ? { ...FULL_DECISIONS }
      : {
          quick: true,
          sites: classes.has('public-site'),
          source: classes.has('python'),
          python: classes.has('python'),
          candidates: false,
          npmPackages: [],
          linux: false,
          macos: false,
        }
  // Seed the policy audit from the verified PR head, not a workflow run, clock,
  // runner or merge commit that can differ after an unrelated base advance.
  // All workflows and reruns therefore choose the same full-audit obligation.
  const auditSeed = event === 'pull_request' ? prHeadSha : null
  const selectionHash =
    auditConfigurationValid && auditSeed
      ? createHash('sha256').update(`${AUDIT_DOMAIN}\0${auditSeed}`).digest('hex')
      : null
  const audit = {
    selected: false,
    eligible: mode === 'active' && event === 'pull_request' && !forceFull && Boolean(selectionHash),
    algorithm: AUDIT_ALGORITHM,
    domain: AUDIT_DOMAIN,
    seedKind: 'verified-pr-head',
    seed: auditSeed,
    selectionHash,
    sampleDivisor: auditConfigurationValid ? manifest.audits.sampleDivisor : null,
    bucket: selectionHash ? Number(BigInt(`0x${selectionHash}`) % 5n) : null,
  }
  audit.selected = audit.eligible && audit.bucket === 0
  const decisions = mode === 'shadow' || audit.selected ? { ...FULL_DECISIONS } : proposedDecisions
  const targets = manifest.targets.map((target) => {
    const testInventory =
      target.inventoryPolicy === 'linux-host'
        ? current.linuxHostInventory
        : current.inventory.filter(
            (path) =>
              (target.inventoryRoots.some((root) => path.startsWith(root)) ||
                target.inventoryInclude?.includes(path)) &&
              !target.inventoryExclude?.includes(path),
          )
    const inventory = [
      ...new Set([
        ...testInventory,
        ...current.entrypoints.filter(
          (path) =>
            target.inventoryRoots.some((root) => path.startsWith(root)) ||
            target.entrypoints.includes(path),
        ),
      ]),
    ].sort()
    const proposedSelected = selectedForTarget(target.id, proposedDecisions)
    return {
      id: target.id,
      scope: target.scope,
      kind: target.kind,
      runtimeProfiles: target.profiles,
      skipPolicy: target.skipPolicy ?? null,
      inventory,
      inventoryDigest: digest(inventory),
      selected: selectedForTarget(target.id, decisions),
      proposedSelected,
      reasons: target.mandatory
        ? ['Mandatory policy and tooling verification']
        : proposedSelected
          ? [`Required by ${classification} input policy`]
          : audit.selected
            ? [
                'Deterministic full PR audit requires fresh execution despite proposed component independence',
              ]
            : mode === 'shadow'
              ? [
                  'Shadow mode requires full execution while recording the proposed component omission',
                ]
              : ['Input delta is confined to proven independent component ownership'],
      omissionReason: proposedSelected
        ? null
        : `Policy ${manifest.policyVersion} excludes unrelated ${target.kind} work for ${classification} inputs`,
    }
  })
  const plan = {
    schemaVersion: 1,
    policyVersion: manifest.policyVersion,
    manifestDigest: digest(manifest),
    mode,
    event,
    requestedBase: base,
    requestedPrHead: prHead,
    forceFull: Boolean(forceFull),
    audit,
    identity: {
      base: baseSha,
      head: headSha,
      prHead: prHeadSha,
      baseTree: baseSha ? git(cwd, ['rev-parse', `${baseSha}^{tree}`]).trim() : null,
      headTree: git(cwd, ['rev-parse', `${headSha}^{tree}`]).trim(),
    },
    changes: normalizedChanges,
    policy: { classification, fallbackReasons: uniqueFallbacks },
    inventory: {
      old: previous?.inventory ?? [],
      current: current.inventory,
      entrypoints: current.entrypoints,
      coverageErrors: current.coverageErrors,
      external: current.externalInventory,
      externalReason:
        'Imported skill toolchains are outside repository CI obligations; their source changes still force full execution',
      added: current.inventory.filter((path) => !(previous?.inventory ?? []).includes(path)),
      removed: (previous?.inventory ?? []).filter((path) => !current.inventory.includes(path)),
      digest: digest({
        old: previous?.inventory ?? [],
        current: current.inventory,
        entrypoints: current.entrypoints,
        external: current.externalInventory,
      }),
    },
    graph: {
      old: previous?.graph ?? null,
      current: current.graph,
      affectedOwners,
      digest: digest({ old: previous?.graph ?? null, current: current.graph }),
    },
    decisions,
    proposedDecisions,
    targets,
  }
  return { ...plan, planDigest: digest(plan) }
}

export function githubOutputs(plan) {
  return `${Object.entries({
    ...Object.fromEntries(
      ['quick', 'sites', 'source', 'python', 'candidates', 'linux', 'macos'].map((key) => [
        key,
        String(plan.decisions[key]),
      ]),
    ),
    npm_matrix: JSON.stringify({
      include: plan.decisions.npmPackages.map((packageName) => ({ package: packageName })),
    }),
    classification: plan.policy.classification,
    mode: plan.mode,
    audit_selected: String(plan.audit.selected),
    plan_digest: plan.planDigest,
  })
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`
}
export function parseArguments(args, valued, flags = []) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (flags.includes(key)) {
      options[key] = true
      continue
    }
    if (!valued.includes(key) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`Unknown or incomplete option: ${key}`)
    if (options[key] !== undefined) throw new Error(`Repeated option: ${key}`)
    options[key] = args[++index]
  }
  return options
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArguments(
      process.argv.slice(2),
      [
        '--base',
        '--head',
        '--pr-head',
        '--event',
        '--mode',
        '--root',
        '--output',
        '--github-output',
      ],
      ['--force-full'],
    )
    const plan = createAffectedPlan({
      cwd: options['--root'],
      base: options['--base'] ?? null,
      head: options['--head'] ?? 'HEAD',
      prHead: options['--pr-head'] ?? null,
      event: options['--event'] ?? process.env.GITHUB_EVENT_NAME ?? 'pull_request',
      mode: options['--mode'] ?? 'shadow',
      forceFull: options['--force-full'],
    })
    if (options['--output'])
      writeFileSync(options['--output'], `${JSON.stringify(plan, null, 2)}\n`)
    if (options['--github-output']) appendFileSync(options['--github-output'], githubOutputs(plan))
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Affected planning refused: ${error.message}\n`)
    process.exitCode = 1
  }
}
