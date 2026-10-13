import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { regularFile } from './candidate-provenance.mjs'
import { filesForTarget, gitRepositoryTests } from './suite-inventory.mjs'
import { parseBunTranscript, readJUnitCases } from './test-reports.mjs'

// Counts come from completed reports or built files. The aggregate binds them
// to the current full inventory and requires every job and runtime profile.
export async function observedCount({
  transcript,
  junit,
  pages,
  qualification,
  summary,
  archives,
  source,
  targetId,
  profiles,
  transcriptManifest,
  repository = process.cwd(),
  pythonTranscript,
  testFiles,
}) {
  if (transcriptManifest) {
    const manifest = JSON.parse(await readFile(transcriptManifest, 'utf8'))
    if (
      manifest.schemaVersion !== 1 ||
      !Array.isArray(manifest.commands) ||
      !manifest.commands.length
    )
      throw new Error('Missing owning transcript commands')
    const paths = new Set()
    const reports = []
    for (const command of manifest.commands) {
      if (paths.has(command.transcript)) throw new Error('Repeated owning transcript')
      paths.add(command.transcript)
      const transcriptPath = await regularFile(dirname(transcriptManifest), command.transcript)
      const text = await readFile(transcriptPath, 'utf8')
      reports.push(parseBunTranscript(text, command))
    }
    if (reports.some((report) => report.skipped !== 0 || report.filtered !== 0))
      throw new Error('Selected whole-file execution contains skipped or filtered cases')
    let count = reports.reduce((sum, report) => sum + report.count, 0)
    if (junit) {
      if (manifest.commands.some((command) => command.commandKind !== 'installed-script'))
        throw new Error('Use one owning test-framework report per command')
      count += (await observedCount({ junit, pythonTranscript, testFiles })).count
    }
    return {
      count,
      skipped: 0,
      basis: 'test-cases',
    }
  }
  if (archives) {
    async function countArchives(path) {
      let count = 0
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory()) count += await countArchives(join(path, entry.name))
        else if (entry.isFile() && /\.(?:tgz|whl|tar\.gz)$/.test(entry.name)) {
          if ((await readFile(join(path, entry.name))).length === 0)
            throw new Error('Empty archive evidence')
          count++
        } else if (entry.isSymbolicLink())
          throw new Error('Archive evidence must not contain links')
      }
      return count
    }
    const files = await readdir(archives)
    for (const profile of profiles ?? []) {
      const stem = profile.replaceAll('-', '_')
      if (
        files.filter((file) => file.startsWith(`${stem}-`) && file.endsWith('.whl')).length !== 1 ||
        files.filter((file) => file.startsWith(`${stem}-`) && file.endsWith('.tar.gz')).length !== 1
      )
        throw new Error(`Missing wheel/sdist pair for ${profile}`)
    }
    return { count: await countArchives(archives), skipped: 0, basis: 'qualified-artifacts' }
  }
  if (transcript) {
    const rawOutput = await readFile(transcript, 'utf8')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip terminal ANSI escapes before checking complete tool reports.
    const plainOutput = rawOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    const output = plainOutput.replaceAll('\r\n', '\n')
    if (
      /(?:^|\n)\s*[1-9]\d* fail\b|(?:^|\n)# (?:fail|cancelled) [1-9]\d*\b|(?:^|\n)FAILED\b/m.test(
        output,
      )
    )
      throw new Error('Failed or cancelled execution report')
    if (/^(?:\s*\(skip\)|\s*[1-9]\d* skip\b|# skipped [1-9]\d*\b)/m.test(output))
      throw new Error('Selected execution contains skipped cases')
    const reports = [
      ...[
        ...output.matchAll(
          /^\s*(\d+) pass\s*\n(?:\s*(\d+) skip\s*\n)?\s*0 fail\s*\n(?:\s*\d+ expect\(\) calls\s*\n)?Ran (\d+) tests? across \d+ files?\./gm,
        ),
      ].map((match) => ({
        count: Number(match[1]),
        skipped: Number(match[2] ?? 0),
        total: Number(match[3]),
      })),
      ...[
        ...output.matchAll(
          /^# tests (\d+)\n# suites \d+\n# pass (\d+)\n# fail 0\n# cancelled 0\n# skipped (\d+)\n# todo 0\n# duration_ms /gm,
        ),
      ].map((match) => ({
        count: Number(match[2]),
        skipped: Number(match[3]),
        total: Number(match[1]),
      })),
      ...[...output.matchAll(/^Ran (\d+) tests? in [^\n]+\n\nOK(?: \(skipped=(\d+)\))?\s*$/gm)].map(
        (match) => ({
          count: Number(match[1]) - Number(match[2] ?? 0),
          skipped: Number(match[2] ?? 0),
          total: Number(match[1]),
        }),
      ),
    ]
    if (!reports.length || reports.some((report) => report.count + report.skipped !== report.total))
      throw new Error('No complete reconciled execution report')
    if (reports.some((report) => report.skipped !== 0))
      throw new Error('Selected execution contains skipped cases')
    if (targetId === 'source-python') {
      const markers = [...output.matchAll(/^CI Python source file complete: ([^\r\n]+)$/gm)].map(
        (match) => match[1],
      )
      const pythonSummaries = [...output.matchAll(/^Ran (\d+) tests? in [^\n]+\n\nOK\s*$/gm)]
      if (
        !Array.isArray(testFiles) ||
        !testFiles.length ||
        new Set(testFiles).size !== testFiles.length ||
        new Set(markers).size !== markers.length ||
        JSON.stringify([...testFiles].sort()) !== JSON.stringify(markers.sort()) ||
        pythonSummaries.length !== 4 ||
        reports.length !== 4 ||
        pythonSummaries.some((match) => Number(match[1]) <= 0)
      )
        throw new Error('Python source proof differs from its exact file inventory or four suites')
    }
    return {
      count: reports.reduce((sum, report) => sum + report.count, 0),
      skipped: 0,
      basis: 'test-cases',
    }
  }
  if (junit) {
    const cases = readJUnitCases(junit)
    const report = {
      count: cases.length,
      skipped: 0,
      basis: 'test-cases',
    }
    if (testFiles) {
      if (
        !Array.isArray(testFiles) ||
        !testFiles.length ||
        new Set(testFiles).size !== testFiles.length ||
        JSON.stringify([...testFiles].sort()) !==
          JSON.stringify([...new Set(cases.map((item) => item.file ?? ''))].sort())
      )
        throw new Error('JUnit files differ from the selected target inventory')
    }
    if (pythonTranscript) {
      const text = await readFile(pythonTranscript, 'utf8')
      if (/^FAILED\b|^OK \(skipped=|^skipped=/m.test(text))
        throw new Error('Failed or skipped Python source proof')
      const summaries = [...text.matchAll(/^Ran (\d+) tests? in [^\n]+\n\nOK\s*$/gm)]
      if (summaries.length < 4 || summaries.some((match) => Number(match[1]) <= 0))
        throw new Error('Missing complete Python source suites')
      report.count += summaries.reduce((sum, match) => sum + Number(match[1]), 0)
    }
    return report
  }
  if (pages) {
    async function countHtml(path) {
      let count = 0
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory()) count += await countHtml(join(path, entry.name))
        else if (entry.isFile() && entry.name.endsWith('.html')) {
          if (!(await readFile(join(path, entry.name), 'utf8')).trim())
            throw new Error('Empty built page evidence')
          count++
        } else if (entry.isSymbolicLink())
          throw new Error('Built page evidence must not contain links')
      }
      return count
    }
    for (const profile of profiles ?? [])
      if (!(await countHtml(join(pages, profile)))) throw new Error(`No built pages for ${profile}`)
    return { count: await countHtml(pages), skipped: 0, basis: 'built-pages' }
  }
  if (qualification) {
    const report = JSON.parse(await readFile(qualification, 'utf8'))
    const names = {
      flow: '@jigging/flow',
      agent: '@jigging/agent-method',
      acp: '@jigging/agent-acp',
      jig: '@jigging/jig',
    }
    if (
      report.schemaVersion !== 1 ||
      (source && report.commit !== source) ||
      (profiles && (profiles.length !== 1 || report.package !== names[profiles[0]]))
    )
      throw new Error('Stale candidate execution source or profile')
    if (
      !Array.isArray(report.gates) ||
      !report.gates.length ||
      report.gates.some((gate) => typeof gate !== 'string')
    )
      throw new Error('Missing completed candidate obligations')
    const obligations = {
      flow: ['package-smoke', 'npm-install-import'],
      agent: ['npm-install-import', 'installed-flow-invalid-input'],
      acp: ['npm-install-import', 'installed-flow-invalid-input'],
      jig: [
        'display-model-package-smoke',
        'display-web-package-smoke',
        'display-tui-package-smoke',
        'package-smoke',
        'npm-local-install-help',
        'npm-global-install-help',
      ],
    }
    if (
      profiles?.length !== 1 ||
      JSON.stringify(report.gates) !== JSON.stringify(obligations[profiles[0]])
    )
      throw new Error('Incomplete candidate profile obligations')
    if (new Set(report.gates).size !== report.gates.length)
      throw new Error('Repeated candidate obligation')
    return { count: report.gates.length, skipped: 0, basis: 'qualified-artifacts' }
  }
  if (summary) {
    const report = JSON.parse(await readFile(summary, 'utf8'))
    if (
      report.failures !== 0 ||
      !Array.isArray(report.errors) ||
      report.errors.length ||
      report.qualified !== true ||
      report.skipped_reports !== 0 ||
      (source && report.revision !== source) ||
      (targetId && targetId !== `macos-${report.architecture}`)
    )
      throw new Error('Failed or stale host summary')
    if (
      !Number.isSafeInteger(report.executed) ||
      report.executed <= 0 ||
      !Array.isArray(report.shards) ||
      !report.shards.length ||
      report.shards.some(
        (row) =>
          row.failures !== 0 ||
          row.skipped_reports !== 0 ||
          !Number.isSafeInteger(row.executed) ||
          row.executed <= 0,
      ) ||
      report.shards.reduce((sum, row) => sum + row.executed, 0) !== report.executed
    )
      throw new Error('Incomplete validated Mac summary')
    return { count: report.executed, skipped: 0, basis: 'test-cases' }
  }
  throw new Error('Provide an observed execution report')
}

const catalog = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url)))
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function executionInventory({ repository = process.cwd(), scope } = {}) {
  const source = execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 10000,
  }).trim()
  if (!/^[0-9a-f]{40}$/.test(source)) throw new Error('Missing exact execution source')
  if (scope && !['ci', 'linux', 'macos'].includes(scope)) throw new Error('Unknown execution scope')
  const files = gitRepositoryTests(repository, source)
  const targets = catalog.targets
    .filter((target) => !scope || target.scope === scope)
    .map((target) => {
      const testInventory = filesForTarget(files, target.id, catalog)
      return {
        ...target,
        runtimeProfiles: target.profiles,
        testInventory,
        inventoryDigest: sha({ id: target.id, profiles: target.profiles, testInventory }),
      }
    })
  return { source, targets }
}

export async function writeJobEvidence({
  id,
  output,
  profile,
  profiles: selectedProfiles,
  repository,
  ...reports
}) {
  const { source, targets } = executionInventory({ repository })
  const target = targets.find((target) => target.id === id)
  if (!target) throw new Error('Unknown execution target')
  const profiles =
    selectedProfiles ??
    (profile ? [profile] : target.runtimeProfiles.length === 1 ? target.runtimeProfiles : [])
  if (
    !profiles.length ||
    new Set(profiles).size !== profiles.length ||
    profiles.some((profile) => !target.runtimeProfiles.includes(profile))
  )
    throw new Error('Declare each known execution profile exactly once')
  if ((reports.junit || id === 'source-python') && !target.testInventory.length)
    throw new Error('Execution requires a nonempty full file inventory')
  const {
    count,
    basis,
    skipped = 0,
    filtered = 0,
  } = await observedCount({
    ...reports,
    source,
    targetId: id,
    profiles,
    repository,
    ...(reports.junit || id === 'source-python' ? { testFiles: target.testInventory } : {}),
  })
  if (skipped !== 0 || filtered !== 0 || !Number.isSafeInteger(count) || count <= 0)
    throw new Error('No complete positive zero-skip execution proof')
  const result = {
    id,
    status: 'success',
    inventoryDigest: target.inventoryDigest,
    executedCount: count,
    basis,
    unexpectedSkips: 0,
    observedSkipped: 0,
    profiles,
    ...(reports.artifacts ? { artifactsVerified: true } : {}),
    ...(reports.residue ? { residueVerified: true } : {}),
  }
  await writeFile(
    output,
    JSON.stringify({ schemaVersion: 1, source, results: [result] }, null, 2) + '\n',
    { flag: 'wx' },
  )
}

export async function collectJobEvidence({
  directory,
  resultsPath,
  output,
  scope = 'ci',
  repository,
}) {
  const { source, targets } = executionInventory({ repository, scope })
  const statuses = JSON.parse(await readFile(resultsPath, 'utf8'))
  const reports = []
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(path, entry.name))
      else if (entry.isFile() && entry.name.endsWith('.json'))
        reports.push(JSON.parse(await readFile(join(path, entry.name), 'utf8')))
      else if (entry.isSymbolicLink()) throw new Error('Execution evidence cannot contain links')
    }
  }
  await walk(directory)
  for (const report of reports) {
    if (
      report.schemaVersion !== 1 ||
      report.source !== source ||
      !Array.isArray(report.results) ||
      report.results.some((row) => !targets.some((target) => target.id === row.id))
    )
      throw new Error('Stale or malformed job evidence')
  }
  const results = targets.map((target) => {
    if (statuses[target.id] !== 'success')
      throw new Error(`Required job did not succeed: ${target.id}`)
    const rows = reports.flatMap((report) => report.results.filter((row) => row.id === target.id))
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.status !== 'success' ||
          row.inventoryDigest !== target.inventoryDigest ||
          !Number.isSafeInteger(row.executedCount) ||
          row.executedCount <= 0 ||
          row.observedSkipped !== 0 ||
          row.unexpectedSkips !== 0 ||
          (row.observedFiltered !== undefined && row.observedFiltered !== 0) ||
          row.skipPolicy !== undefined ||
          row.skippedCases !== undefined ||
          row.skippedCaseDigest !== undefined ||
          !Array.isArray(row.profiles) ||
          !row.profiles.length ||
          !['test-cases', 'built-pages', 'qualified-artifacts'].includes(row.basis) ||
          row.profiles.some((profile) => !target.runtimeProfiles.includes(profile)) ||
          (target.requiresArtifacts && row.artifactsVerified !== true) ||
          (target.requiresResidue && row.residueVerified !== true),
      )
    )
      throw new Error(`Missing complete execution reports: ${target.id}`)
    const profiles = rows.flatMap((row) => row.profiles)
    if (
      new Set(profiles).size !== profiles.length ||
      JSON.stringify([...profiles].sort()) !== JSON.stringify([...target.runtimeProfiles].sort())
    )
      throw new Error(`Incomplete or repeated execution profile: ${target.id}`)
    return {
      ...rows[0],
      executedCount: rows.reduce((sum, row) => sum + row.executedCount, 0),
      profiles,
    }
  })
  await writeFile(output, JSON.stringify({ schemaVersion: 1, source, results }, null, 2) + '\n', {
    flag: 'wx',
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const values = new Set([
      '--id',
      '--output',
      '--profile',
      '--profiles',
      '--transcript',
      '--transcript-manifest',
      '--python-transcript',
      '--junit',
      '--pages',
      '--qualification',
      '--summary',
      '--archives',
      '--directory',
      '--results',
      '--scope',
    ])
    const flags = new Set(['--artifacts', '--residue']),
      options = {}
    for (let index = 2; index < process.argv.length; index++) {
      const key = process.argv[index]
      if (options[key] !== undefined || (!values.has(key) && !flags.has(key)))
        throw new Error('Unknown or repeated execution option')
      if (flags.has(key)) options[key] = true
      else {
        const value = process.argv[++index]
        if (!value || value.startsWith('--')) throw new Error('Missing execution option value')
        options[key] = value
      }
    }
    if (!options['--output']) throw new Error('Provide --output')
    if (process.env.GITHUB_SHA && executionInventory().source !== process.env.GITHUB_SHA)
      throw new Error('Checkout differs from workflow source')
    if (options['--directory'])
      await collectJobEvidence({
        directory: options['--directory'],
        resultsPath: options['--results'],
        output: options['--output'],
        scope: options['--scope'],
      })
    else
      await writeJobEvidence({
        id: options['--id'],
        output: options['--output'],
        profile: options['--profile'],
        profiles: options['--profiles']?.split(','),
        transcript: options['--transcript'],
        transcriptManifest: options['--transcript-manifest'],
        pythonTranscript: options['--python-transcript'],
        junit: options['--junit'],
        pages: options['--pages'],
        qualification: options['--qualification'],
        summary: options['--summary'],
        archives: options['--archives'],
        artifacts: options['--artifacts'],
        residue: options['--residue'],
      })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
