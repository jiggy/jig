import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import {
  macHostShardCount,
  NAMED_TEST_GROUPS,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'

const manifest = JSON.parse(
  readFileSync(new URL('./affected-manifest.json', import.meta.url), 'utf8'),
)
export const expectedSkipInventory = manifest.expectedSkips
const rules = new Map(expectedSkipInventory.rules.map((rule) => [rule.file, rule]))
const linuxFilters = new Map([
  [
    'packages/jig/test/package-provider-host.test.ts',
    ['^packed project dependencies ', '^(?!packed project dependencies )'],
  ],
])
const policyProfiles = new Map(
  manifest.targets.filter((target) => target.skipPolicy).map((target) => [target.id, target]),
)
const TEST_FILE = /(?:\.test|_test|\.spec|_spec)\.(?:[cm]?[jt]sx?)$/
const installedScripts = new Set([
  'packages/jig/test/package-smoke.ts',
  'scripts/test-operational-baseline.ts',
  'scripts/test-installed-hostile-baseline.ts',
])

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function skippedCaseDigest(cases) {
  return createHash('sha256').update(stableJson(cases)).digest('hex')
}
function git(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error || result.status !== 0)
    throw new Error('Expected-skip source information is unavailable')
  return result.stdout
}
function repositoryPath(file) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\0') ||
    file.includes('\\') ||
    isAbsolute(file)
  )
    throw new Error('Skipped case requires a repository-relative file identity')
  const result = file.replace(/^\.\//, '')
  if (normalize(result) !== result || result.startsWith('../'))
    throw new Error('Skipped case file identity escapes the repository')
  return result
}
// Bun JUnit classnames list nested suites from inner to outer. Its transcript
// lists them from outer to inner; normalize both to Bun's name-filter spelling.
export function bunCaseFullName({ classname = '', name }) {
  if (typeof classname !== 'string' || typeof name !== 'string' || !name.trim())
    throw new Error('Skipped case is missing its name identity')
  return [...classname.split(' > ').filter(Boolean).reverse(), name].join(' ')
}
function approvedFilter(targetId, file, pattern) {
  const allowed =
    targetId === 'linux'
      ? linuxFilters.get(file)
      : targetId.startsWith('macos-')
        ? NAMED_TEST_GROUPS.get(file)?.map((group) => group.pattern)
        : []
  return typeof pattern === 'string' && allowed?.includes(pattern)
}

// The payload remains in evidence so the independent gate repeats this check.
// A policy label alone never authorizes a skipped test. Frozen blobs prevent a
// new/modified skip condition from inheriting an earlier file's permission.
export function authorizeExpectedSkips({
  repository = process.cwd(),
  source,
  targetId,
  profile,
  skipPolicy,
  skippedCases,
}) {
  if (!Array.isArray(skippedCases)) throw new Error('Missing skipped case identities')
  const target = policyProfiles.get(targetId)
  if (!target || skipPolicy !== target.skipPolicy || !target.profiles.includes(profile))
    throw new Error('Unknown expected-skip policy or runtime profile')
  if (!/^[0-9a-f]{40,64}$/.test(source ?? ''))
    throw new Error('Expected-skip proof requires an exact source revision')
  git(repository, ['rev-parse', '--verify', '--end-of-options', `${source}^{commit}`])
  const blobs = new Map()
  const seen = new Set()
  const normalizedCases = skippedCases.map((item) => {
    const file = repositoryPath(item?.file)
    const classname = item.classname ?? ''
    const name = item.name
    const fullName = bunCaseFullName({ classname, name })
    const commandKind = item.commandKind ?? 'ordinary'
    if (commandKind !== 'ordinary')
      throw new Error('Native prerequisite and installed-startup proof must execute without skips')
    const rule = rules.get(file)
    if (!rule) throw new Error(`Unreviewed skipped case file: ${file}`)
    if (!blobs.has(file)) {
      const entry = git(repository, ['ls-tree', source, '--', file]).trim()
      const match = /^100(?:644|755) blob ([0-9a-f]{40,64})\t/.exec(entry)
      if (!match || match[1] !== rule.blob)
        throw new Error(`Changed or unavailable expected-skip source: ${file}`)
      blobs.set(file, match[1])
    }
    let filter
    let filteredOut = false
    if (item.filter !== undefined) {
      if (
        !item.filter ||
        repositoryPath(item.filter.file) !== file ||
        !approvedFilter(targetId, file, item.filter.pattern)
      )
        throw new Error('Skipped case filter does not match its owning command')
      filter = { file, pattern: item.filter.pattern }
      filteredOut = !new RegExp(filter.pattern).test(fullName)
    }
    const patterns =
      targetId === 'source-tests'
        ? rule.sourcePatterns
        : targetId === 'linux'
          ? rule.linuxPatterns
          : rule.macosPatterns
    if (!filteredOut && !patterns.some((pattern) => new RegExp(pattern).test(fullName)))
      throw new Error(`Unexpected skipped case: ${file}: ${fullName}`)
    const result = { file, classname, name, profile, commandKind, ...(filter ? { filter } : {}) }
    if (item.profile !== undefined && item.profile !== profile)
      throw new Error('Skipped case has a different runtime profile')
    const identity = stableJson(result)
    if (seen.has(identity)) throw new Error('Repeated skipped case identity in one owning command')
    seen.add(identity)
    return result
  })
  return {
    observedSkipped: normalizedCases.length,
    unexpectedSkips: 0,
    skippedCaseDigest: skippedCaseDigest(normalizedCases),
    skippedCases: normalizedCases,
  }
}

export function parseBunTranscript(text, { files, filter, commandKind = 'ordinary' } = {}) {
  if (typeof text !== 'string' || !Array.isArray(files))
    throw new Error('Bun transcript requires its owning command files')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Bun reporters emit ANSI color escapes.
  const output = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replaceAll('\r\n', '\n')
  if (commandKind === 'installed-script') {
    const markers = [...output.matchAll(/^CI installed script complete: (.+)$/gm)]
    if (
      files.length !== 1 ||
      !installedScripts.has(repositoryPath(files[0])) ||
      filter ||
      markers.length !== 1 ||
      markers[0][1] !== files[0] ||
      /(?:^|\n)\s*(?:\d+ (?:pass|skip|fail)\b|\(skip\)|\(fail\)|# (?:fail|cancelled|skipped) [1-9]\d*\b|FAILED\b)/m.test(
        output,
      )
    )
      throw new Error('Installed script cannot substitute for a test-framework command')
    return { count: 0, skipped: 0, skippedCases: [], basis: 'test-cases' }
  }
  if (!files.length) throw new Error('Bun transcript requires its owning command files')
  const expectedFiles = new Set(files.map(repositoryPath))
  if (expectedFiles.size !== files.length) throw new Error('Bun command repeats an owning file')
  const skippedCases = []
  const observedFiles = new Set()
  let file
  for (const line of output.split('\n')) {
    const header = /^(.+\.(?:[cm]?[jt]sx?)):$/u.exec(line)
    if (header) {
      file = repositoryPath(header[1])
      if (!expectedFiles.has(file))
        throw new Error('Bun report file does not match its owning command')
      observedFiles.add(file)
    }
    const skip = /^\(skip\) (.+)$/u.exec(line)
    if (skip) {
      if (!file) throw new Error('Bun skipped case is missing its file header')
      const parts = skip[1].split(' > ')
      const name = parts.pop()
      skippedCases.push({
        file,
        classname: parts.reverse().join(' > '),
        name,
        commandKind,
        ...(filter ? { filter } : {}),
      })
    }
    if (
      /^\(fail\)|^\s*[1-9]\d* fail\b|^error:|^# (?:fail|cancelled) [1-9]\d*\b|^FAILED\b/.test(line)
    )
      throw new Error('Failed or cancelled Bun execution report')
  }
  const summaries = [
    ...output.matchAll(
      /^\s*(\d+) pass\s*\n(?:\s*(\d+) skip\s*\n)?\s*0 fail\s*\n(?:\s*\d+ expect\(\) calls\s*\n)?Ran (\d+) tests? across \d+ files?\./gm,
    ),
  ]
  if (summaries.length !== 1)
    throw new Error('Bun command requires one completed successful report')
  const count = Number(summaries[0][1])
  const skipped = Number(summaries[0][2] ?? 0)
  if (observedFiles.size !== expectedFiles.size)
    throw new Error('Bun owning command omits a declared test file')
  if (count + skipped !== Number(summaries[0][3]) || skipped !== skippedCases.length)
    throw new Error('Bun skipped case identities do not reconcile with its report')
  return { count, skipped, skippedCases, basis: 'test-cases' }
}

function parseJUnit(path) {
  const program =
    'import sys,json,xml.etree.ElementTree as E\nr=E.parse(sys.argv[1]).getroot()\nif r.tag not in ("testsuite","testsuites"): raise ValueError("invalid JUnit root")\nc=list(r.iter("testcase"))\nif any(x.find("failure") is not None or x.find("error") is not None for x in c): raise ValueError("failed host proof")\nprint(json.dumps([dict(x.attrib, skipped=x.find("skipped") is not None) for x in c]))'
  return JSON.parse(
    execFileSync('python3', ['-c', program, path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}
function inertPath(directory, path) {
  const resolved = resolve(directory, path)
  if (relative(resolve(directory), resolved).startsWith('../'))
    throw new Error('Host report escapes its evidence directory')
  return resolved
}

// Reconstruct the actual source inventory and every owning Mac command rather
// than trusting supplied plans or a successful aggregate job's case totals.
export function readMacSkippedCases({
  repository = process.cwd(),
  source,
  targetId,
  evidenceDirectory,
}) {
  if (!/^macos-(?:x64|arm64)$/.test(targetId ?? '') || !/^[0-9a-f]{40,64}$/.test(source ?? ''))
    throw new Error('Invalid Mac skipped-case evidence identity')
  const architecture = targetId.slice(6)
  const entries = git(repository, ['ls-tree', '-rz', '--full-tree', source])
    .split('\0')
    .filter(Boolean)
  const files = entries
    .filter((entry) => /^100(?:644|755) blob /.test(entry))
    .map((entry) => entry.slice(entry.indexOf('\t') + 1))
    .filter((file) => file.startsWith('packages/jig/test/') && TEST_FILE.test(file))
    .sort()
  const shards = planMacHostTests(files, architecture)
  const skippedCases = []
  const executed = new Set()
  let count = 0
  for (const shard of shards) {
    const directory = inertPath(
      evidenceDirectory,
      `macos-prerequisites-${architecture}-${shard.index}-${source}`,
    )
    if (
      readFileSync(join(directory, `shard-${shard.index}.complete`), 'utf8').trim() !==
      `${source} ${architecture} ${shard.index}`
    )
      throw new Error('Stale Mac execution marker')
    const actual = JSON.parse(readFileSync(join(directory, 'test-plan.json'), 'utf8'))
    if (
      actual.architecture !== architecture ||
      actual.shard !== shard.index ||
      actual.shardCount !== macHostShardCount(architecture) ||
      actual.installed !== (shard.index === shards.length - 1) ||
      stableJson(actual.groups) !== stableJson(shard.groups) ||
      stableJson(actual.nativeFiles) !==
        stableJson(shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [])
    )
      throw new Error('Mac execution plan differs from its exact source inventory')
    const reports = shard.groups.map((group, i) => ({
      path: `shard-${shard.index}-group-${i}.xml`,
      files: [group.file],
      filter: group.pattern ? { file: group.file, pattern: group.pattern } : undefined,
      commandKind: 'ordinary',
    }))
    if (shard.index === 0)
      reports.push({
        path: 'native-tests.xml',
        files: NATIVE_PREREQUISITE_TESTS,
        commandKind: 'native-prerequisites',
      })
    if (actual.installed)
      reports.push({
        path: 'installed-startup.xml',
        files: ['packages/jig/test/native-agent-startup.test.ts'],
        commandKind: 'installed-startup',
      })
    for (const report of reports) {
      const cases = parseJUnit(inertPath(directory, report.path))
      if (!cases.length) throw new Error('Mac owning command has no reported cases')
      const observedFiles = new Set()
      for (const item of cases) {
        const file = repositoryPath(item.file)
        if (!report.files.includes(file))
          throw new Error('Mac JUnit file differs from its owning command')
        observedFiles.add(file)
        const fullName = bunCaseFullName(item)
        if (item.skipped)
          skippedCases.push({
            file,
            classname: item.classname ?? '',
            name: item.name,
            commandKind: report.commandKind,
            ...(report.filter ? { filter: report.filter } : {}),
          })
        else {
          if (report.filter && !new RegExp(report.filter.pattern).test(fullName))
            throw new Error('Mac executed case lies outside its owning name partition')
          const identity = stableJson({
            file,
            classname: item.classname ?? '',
            name: item.name,
            line: item.line ?? null,
          })
          if (executed.has(identity)) throw new Error('Mac case executed more than once')
          executed.add(identity)
          count++
        }
      }
      if (stableJson([...observedFiles].sort()) !== stableJson([...report.files].sort()))
        throw new Error('Mac owning command omits a planned file')
      if (report.commandKind !== 'ordinary' && cases.some((item) => item.skipped))
        throw new Error('Native prerequisite and installed-startup reports may not skip cases')
    }
  }
  return { count, skipped: skippedCases.length, skippedCases, basis: 'test-cases' }
}
