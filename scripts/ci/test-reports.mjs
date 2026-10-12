import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import {
  INSTALLED_STARTUP_TEST,
  macHostShardCount,
  NATIVE_PREREQUISITE_TESTS,
  planMacHostTests,
} from './macos-host-test-shards.mjs'
import { filesForTarget, gitRepositoryTests } from './suite-inventory.mjs'

const manifest = JSON.parse(readFileSync(new URL('./affected-manifest.json', import.meta.url)))
const installedScripts = new Map([
  ...[
    'packages/jig/test/package-smoke.ts',
    'packages/display-model/test/package-smoke.ts',
    'packages/display-web/test/package-smoke.ts',
    'packages/display-tui/test/package-smoke.ts',
    'scripts/test-operational-baseline.ts',
    'scripts/test-installed-hostile-baseline.ts',
  ].map((file) => [file, `CI installed script complete: ${file}`]),
  [
    'packages/jig/test/installed-display-smoke.ts',
    'Installed display witness passed with unchanged frozen archives.',
  ],
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
function repositoryPath(file) {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\0') ||
    file.includes('\\') ||
    isAbsolute(file)
  )
    throw new Error('Report requires a repository-relative file identity')
  const path = file.replace(/^\.\//, '')
  if (normalize(path) !== path || path === '..' || path.startsWith('../'))
    throw new Error('Report file identity escapes the repository')
  return path
}

// Whole-file commands have no name filters or skipped registrations. Platform
// applicability is decided before execution by the shared suite inventory.
export function parseBunTranscript(text, { files, filter, commandKind = 'ordinary' } = {}) {
  if (typeof text !== 'string' || !Array.isArray(files) || filter !== undefined)
    throw new Error('Whole-file report requires exact command files without filters')
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Bun can color its reporter.
  const output = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replaceAll('\r\n', '\n')
  if (commandKind === 'installed-script') {
    const marker = files.length === 1 ? installedScripts.get(repositoryPath(files[0])) : undefined
    if (
      !marker ||
      output.split('\n').filter((line) => line === marker).length !== 1 ||
      /(?:^|\n)\s*(?:\d+ (?:pass|skip|fail)\b|\((?:skip|fail)\)|# (?:fail|cancelled|skipped) [1-9]\d*\b|FAILED\b)/m.test(
        output,
      ) ||
      output
        .split('\n')
        .some((line) => line.startsWith('CI installed script complete:') && line !== marker)
    )
      throw new Error('Installed script lacks its exact completion proof')
    return { count: 0, skipped: 0, filtered: 0, skippedCases: [], basis: 'test-cases' }
  }
  if (
    !['ordinary', 'native-prerequisites', 'installed-startup'].includes(commandKind) ||
    !files.length
  )
    throw new Error('Unknown or empty test-framework command')
  const expectedFiles = new Set(files.map(repositoryPath))
  if (expectedFiles.size !== files.length) throw new Error('Test command repeats a file')
  if (
    /^\s*(?:\(skip\)|\(fail\)|[1-9]\d* (?:skip|fail|filtered out)\b|error:|FAILED\b)/m.test(output)
  )
    throw new Error('Selected whole-file suite failed, skipped or filtered execution')
  const summaries = [
    ...output.matchAll(
      /^\s*(\d+) pass\s*\n(?:\s*0 skip\s*\n)?\s*0 fail\s*\n(?:\s*\d+ expect\(\) calls\s*\n)?Ran (\d+) tests? across (\d+) files?\./gm,
    ),
  ]
  if (summaries.length !== 1) throw new Error('Test command requires one completed report')
  const summary = summaries[0]
  if (
    !/^\s*(?:\[\d+(?:\.\d+)?(?:ms|s)\])?\s*$/u.test(output.slice(summary.index + summary[0].length))
  )
    throw new Error('Test command has incomplete or trailing execution output')
  let file
  let grouped
  let groupOpen = false
  const observed = new Set()
  const identities = new Set()
  let count = 0
  for (const line of output.slice(0, summary.index).split('\n')) {
    if (line === '::endgroup::') {
      if (!groupOpen) throw new Error('Report closes an unopened file group')
      groupOpen = false
      file = undefined
      continue
    }
    const header = /^(?:(::group::))?(.+\.(?:[cm]?[jt]sx?)):$/u.exec(line)
    if (header) {
      const wrapped = header[1] !== undefined
      if (groupOpen || (grouped !== undefined && grouped !== wrapped))
        throw new Error('Report has nested or mixed file groups')
      grouped = wrapped
      groupOpen = wrapped
      file = repositoryPath(header[2])
      if (!expectedFiles.has(file)) throw new Error('Report file differs from its owning command')
      if (observed.has(file)) throw new Error('Report repeats an owning file')
      observed.add(file)
    } else if (line.startsWith('::group::') || line.startsWith('::endgroup'))
      throw new Error('Report has an invalid file group marker')
    const pass = /^\(pass\) (.+)$/u.exec(line)
    if (pass) {
      if (!file) throw new Error('Passed case lacks an owning file')
      const name = pass[1].replace(/ \[\d+(?:\.\d+)?(?:ms|s)\]$/u, '')
      const identity = stableJson({ file, name })
      if (identities.has(identity)) throw new Error('Passed case identity repeats')
      identities.add(identity)
      count++
    }
  }
  if (
    groupOpen ||
    observed.size !== expectedFiles.size ||
    Number(summary[3]) !== expectedFiles.size ||
    count !== Number(summary[1]) ||
    count !== Number(summary[2]) ||
    count <= 0
  )
    throw new Error('Report does not reconcile complete owning files and cases')
  return { count, skipped: 0, filtered: 0, skippedCases: [], basis: 'test-cases' }
}

function inertPath(directory, path) {
  const root = realpathSync(directory)
  const resolved = resolve(root, path)
  const delta = relative(root, resolved)
  if (!delta || delta === '..' || delta.startsWith('../') || isAbsolute(delta))
    throw new Error('Report escapes its evidence directory')
  if (!lstatSync(resolved).isFile() || realpathSync(resolved) !== resolved)
    throw new Error('Report must be a regular evidence file')
  return resolved
}
function parseJUnit(path) {
  const program =
    'import sys,json,xml.etree.ElementTree as E\nr=E.parse(sys.argv[1]).getroot()\nif r.tag not in ("testsuite","testsuites"): raise ValueError("invalid JUnit root")\nc=list(r.iter("testcase"))\nif not c or any(x.find("failure") is not None or x.find("error") is not None or x.find("skipped") is not None for x in c): raise ValueError("failed, skipped or empty host proof")\nif any(int(x.get("failures","0")) or int(x.get("errors","0")) or int(x.get("skipped","0")) for x in r.iter() if x.tag in ("testsuite","testsuites")): raise ValueError("failed suite")\nif r.get("tests") is not None and int(r.get("tests"))!=len(c): raise ValueError("incomplete JUnit cases")\nprint(json.dumps([dict(x.attrib) for x in c]))'
  return JSON.parse(
    execFileSync('python3', ['-c', program, path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }),
  )
}

export function readMacReports({
  repository = process.cwd(),
  source,
  targetId,
  evidenceDirectory,
}) {
  if (!/^macos-(?:x64|arm64)$/.test(targetId ?? '') || !/^[0-9a-f]{40,64}$/.test(source ?? ''))
    throw new Error('Invalid Mac report source/profile identity')
  const architecture = targetId.slice(6)
  const files = filesForTarget(gitRepositoryTests(repository, source), targetId, manifest)
  const shards = planMacHostTests(files, architecture)
  const identities = new Set()
  let count = 0
  for (const shard of shards) {
    const directory = join(
      evidenceDirectory,
      `macos-prerequisites-${architecture}-${shard.index}-${source}`,
    )
    if (
      readFileSync(inertPath(directory, `shard-${shard.index}.complete`), 'utf8').trim() !==
      `${source} ${architecture} ${shard.index}`
    )
      throw new Error('Stale Mac execution marker')
    const actual = JSON.parse(readFileSync(inertPath(directory, 'test-plan.json'), 'utf8'))
    if (
      actual.architecture !== architecture ||
      actual.shard !== shard.index ||
      actual.shardCount !== macHostShardCount(architecture) ||
      actual.installed !== (shard.index === shards.length - 1) ||
      stableJson(actual.groups) !== stableJson(shard.groups) ||
      stableJson(actual.nativeFiles) !==
        stableJson(shard.index === 0 ? NATIVE_PREREQUISITE_TESTS : [])
    )
      throw new Error('Mac command plan differs from its pinned source inventory')
    const reports = shard.groups.map((group, index) => ({
      path: `shard-${shard.index}-group-${index}.xml`,
      files: [group.file],
    }))
    if (shard.index === 0)
      reports.push({ path: 'native-tests.xml', files: NATIVE_PREREQUISITE_TESTS })
    if (actual.installed)
      reports.push({ path: 'installed-startup.xml', files: [INSTALLED_STARTUP_TEST] })
    for (const report of reports) {
      const observed = new Set()
      for (const item of parseJUnit(inertPath(directory, report.path))) {
        const file = repositoryPath(item.file)
        if (!report.files.includes(file) || typeof item.name !== 'string' || !item.name.trim())
          throw new Error('Mac case differs from its owning command')
        const identity = stableJson({ file, classname: item.classname ?? '', name: item.name })
        if (identities.has(identity))
          throw new Error('Mac case identity repeats within or across commands')
        identities.add(identity)
        observed.add(file)
        count++
      }
      if (stableJson([...observed].sort()) !== stableJson([...report.files].sort()))
        throw new Error('Mac owning report omits a planned file')
    }
  }
  return { count, skipped: 0, filtered: 0, skippedCases: [], basis: 'test-cases' }
}
