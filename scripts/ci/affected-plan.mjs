#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isRepositoryTestFile, owningSuites, reconcileSuiteInventory } from './suite-inventory.mjs'

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
  witnesses: false,
  sourceTargets: ['source-portable', 'source-protocol', 'source-applications', 'source-python'],
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
  const tests = manifest.pilots?.portableTests
  if (
    TEST_FILE.test(path) &&
    (tests?.roots?.some((root) => path.startsWith(root)) || tests?.files?.includes(path))
  )
    return 'portable-tests'
  const presentation = manifest.pilots?.presentation
  if (
    presentation?.roots?.some((root) => path.startsWith(root)) &&
    presentation.extensions?.includes(extname(path))
  )
    return 'presentation'
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
  const discoveredTests = files
    .filter((file) => isRepositoryTestFile(file.path))
    .map((file) => file.path)
  const externalInventory = discoveredTests.filter((path) =>
    (manifest.externalTestRoots ?? []).some((root) => path.startsWith(root)),
  )
  const suiteInventory = reconcileSuiteInventory(files, manifest)
  const inventory = suiteInventory.tests
  coverageErrors.push(...suiteInventory.errors)
  const entrypoints = [
    ...new Set([
      ...manifest.targets.flatMap((target) => target.entrypoints),
      ...files.filter((file) => INSTALLED_ENTRYPOINT.test(file.path)).map((file) => file.path),
    ]),
  ]
    .filter((path) => files.some((file) => file.path === path))
    .sort()
  for (const path of entrypoints) {
    if (
      INSTALLED_ENTRYPOINT.test(path) &&
      !manifest.targets.some((target) => target.entrypoints.includes(path))
    )
      coverageErrors.push(`Unowned installed entrypoint: ${path}`)
  }
  const toolingRecipe = files.some((file) => file.path === 'justfile')
    ? git(cwd, ['show', `${sha}:justfile`])
    : ''
  const toolingCommands = toolingRecipe
    .split('\n')
    .filter((line) => /^\s+(?:bun\s+test|node\s+--test)\s+/.test(line))
    .join('\n')
  for (const path of inventory) {
    const owners = ownersForPath(path)
    const suite = owningSuites(path, manifest)[0]
    const sourceOwned = suite && suite.id !== 'tooling'
    for (const profile of suite?.profiles ?? []) {
      if ((manifest.externalProfiles ?? []).includes(profile)) continue
      const requiredProfile = profile === 'portable' ? 'portable-linux' : profile
      if (
        !manifest.targets.some(
          (target) =>
            target.suiteIds.includes(suite.id) && target.inventoryProfile === requiredProfile,
        )
      )
        coverageErrors.push(`Missing complete execution owner for ${requiredProfile}: ${path}`)
    }
    const toolingOwned =
      /^scripts\/ci\/[^/]+\.test\.mjs$/.test(path) ||
      (path.startsWith('scripts/') && toolingCommands.includes(path))
    if (owners.length === 0 || (!sourceOwned && !toolingOwned))
      coverageErrors.push(`Unowned discovered test: ${path}`)
  }
  return {
    files,
    inventory,
    externalInventory,
    entrypoints,
    suiteOwnership: suiteInventory.ownership,
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
function selectedForTarget(target, decisions) {
  if (target.selection === 'mandatory') return true
  if (target.selection === 'sites') return decisions.sites
  if (target.selection === 'source') return decisions.sourceTargets.includes(target.id)
  if (target.selection === 'python') return decisions.python
  if (target.selection === 'candidates') return decisions.candidates
  if (target.selection === 'full-linux') return decisions.linux
  if (target.selection === 'full-macos') return decisions.macos
  if (target.selection === 'witness') return decisions.witnesses
  throw new Error(`Unknown target selection policy: ${target.id}`)
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
  if (
    classes.has('presentation') &&
    closure(
      normalizedChanges
        .filter((change) =>
          [change.path, change.oldPath]
            .filter(Boolean)
            .some((path) => classifyPath(path, manifest) === 'presentation'),
        )
        .flatMap((change) => change.owners),
      [previous?.graph, current.graph],
    ).some(
      (owner) =>
        ![
          'packages/display-model',
          'packages/display-web',
          'packages/display-tui',
          'packages/jig',
        ].includes(owner),
    )
  )
    fallbackReasons.push(
      'Presentation input has a consumer outside its reviewed display/Jig boundary',
    )
  const uniqueFallbacks = [...new Set(fallbackReasons)].sort()
  const classification = uniqueFallbacks.length
    ? 'full'
    : classes.size === 1
      ? [...classes][0]
      : [...classes].sort().join('-and-')
  const sourceTargets = [
    ...(classes.has('portable-tests') || classes.has('presentation') ? ['source-portable'] : []),
    ...(classes.has('python') ? ['source-protocol', 'source-python'] : []),
  ]
  const proposedDecisions =
    classification === 'full'
      ? { ...FULL_DECISIONS }
      : {
          quick: true,
          sites: classes.has('public-site'),
          source: sourceTargets.length > 0,
          sourceTargets,
          python: classes.has('python'),
          candidates: classes.has('presentation'),
          npmPackages: classes.has('presentation') ? ['jig'] : [],
          linux: false,
          macos: false,
          witnesses: classes.has('presentation'),
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
    const testInventory = current.inventory.filter((path) => {
      const suite = manifest.testSuites.find((item) => item.id === current.suiteOwnership[path])
      return (
        suite &&
        (target.suiteIds.includes(suite.id) || target.inventoryInclude?.includes(path)) &&
        (!target.inventoryProfile || suite.profiles.includes(target.inventoryProfile))
      )
    })
    const inventory = [
      ...new Set([
        ...testInventory,
        ...current.entrypoints.filter((path) => target.entrypoints.includes(path)),
      ]),
    ].sort()
    const proposedSelected = selectedForTarget(target, proposedDecisions)
    return {
      id: target.id,
      scope: target.scope,
      kind: target.kind,
      runtimeProfiles:
        target.selection === 'candidates' && decisions.candidates
          ? decisions.npmPackages
          : target.profiles,
      suiteIds: target.suiteIds,
      inventoryProfile: target.inventoryProfile ?? null,
      testInventory,
      inventory,
      inventoryDigest: digest(inventory),
      selected: selectedForTarget(target, decisions),
      proposedSelected,
      reasons: target.mandatory
        ? ['Mandatory policy and tooling verification']
        : target.selection === 'witness' &&
            !selectedForTarget(target, decisions) &&
            (decisions.linux || decisions.macos)
          ? ['Complete same-profile qualification already executes this installed witness']
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
      requiresArtifacts:
        target.requiresArtifacts === true ||
        [
          'native-and-installed',
          'installed-consumer',
          'candidate-and-consumer',
          'candidate-build',
        ].includes(target.kind),
      requiresResidue: target.requiresResidue === true || target.kind === 'native-and-installed',
      omissionReason: selectedForTarget(target, decisions)
        ? null
        : target.selection === 'witness' && (decisions.linux || decisions.macos)
          ? `Policy ${manifest.policyVersion} includes this witness in complete same-profile qualification`
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
      embeddedFixtures: current.files
        .filter((file) => TEST_FILE.test(file.path))
        .map((file) => file.path)
        .filter((path) => (manifest.fixtureTestRoots ?? []).some((root) => path.startsWith(root))),
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
    ...Object.fromEntries(
      plan.targets.map((target) => [target.id.replaceAll('-', '_'), String(target.selected)]),
    ),
    source_targets: JSON.stringify(plan.decisions.sourceTargets),
    witnesses: String(plan.decisions.witnesses),
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
