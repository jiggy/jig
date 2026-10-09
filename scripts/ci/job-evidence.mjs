import { execFileSync } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArguments } from './affected-plan.mjs'
import { regularFile } from './candidate-provenance.mjs'
import {
  authorizeExpectedSkips,
  parseBunTranscript,
  readMacSkippedCases,
} from './expected-skips.mjs'

// Counts come from completed tool reports or built files, never from a job's
// status. The final gate also checks job status and independently rebuilds the plan.
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
  hostEvidence,
  repository = process.cwd(),
  pythonTranscript,
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
    return {
      count: reports.reduce((sum, report) => sum + report.count, 0),
      skipped: reports.reduce((sum, report) => sum + report.skipped, 0),
      filtered: reports.reduce((sum, report) => sum + (report.filtered ?? 0), 0),
      skippedCases: reports.flatMap((report) => report.skippedCases),
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
    return {
      count: reports.reduce((sum, report) => sum + report.count, 0),
      skipped: reports.reduce((sum, report) => sum + report.skipped, 0),
      basis: 'test-cases',
    }
  }
  if (junit) {
    const program =
      'import sys,json,xml.etree.ElementTree as E\nr=E.parse(sys.argv[1]).getroot()\nif r.tag not in ("testsuite","testsuites"): raise ValueError("invalid JUnit root")\nc=list(r.iter("testcase"))\nif any(x.find("failure") is not None or x.find("error") is not None for x in c) or any(int(x.get("failures","0")) or int(x.get("errors","0")) for x in r.iter() if x.tag in ("testsuite","testsuites")): raise ValueError("failed test proof")\nif r.get("tests") is not None and int(r.get("tests"))!=len(c): raise ValueError("incomplete JUnit cases")\ns=[dict(x.attrib) for x in c if x.find("skipped") is not None]\nprint(json.dumps({"count":len(c)-len(s),"skipped":len(s),"skippedCases":s}))'
    const report = {
      ...JSON.parse(execFileSync('python3', ['-c', program, junit], { encoding: 'utf8' })),
      basis: 'test-cases',
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
        'operational-baseline-1',
        'installed-hostile-baseline',
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
      (source && report.revision !== source) ||
      (targetId && targetId !== `macos-${report.architecture}`)
    )
      throw new Error('Failed or stale host summary')
    if (!hostEvidence || !source || !targetId) throw new Error('Missing owning Mac JUnit evidence')
    const observed = readMacSkippedCases({
      repository,
      source,
      targetId,
      evidenceDirectory: hostEvidence,
    })
    if (observed.count !== report.executed || observed.skipped !== report.skipped_reports)
      throw new Error('Mac summary differs from owning execution reports')
    return observed
  }
  throw new Error('Provide an observed execution report')
}

export async function writeJobEvidence({
  planPath,
  id,
  output,
  profile,
  profiles: selectedProfiles,
  ...reports
}) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  const target = plan.targets.find((item) => item.id === id)
  if (!target?.selected) throw new Error('Execution evidence needs a selected target')
  const profiles =
    selectedProfiles ??
    (profile ? [profile] : target.runtimeProfiles.length === 1 ? target.runtimeProfiles : [])
  if (!profiles.length || new Set(profiles).size !== profiles.length)
    throw new Error('Declare each observed execution profile explicitly')
  const {
    count,
    basis,
    skipped = 0,
    filtered = 0,
    skippedCases = [],
  } = await observedCount({ ...reports, source: plan.identity.head, targetId: id, profiles })
  if (!Number.isSafeInteger(count) || count <= 0)
    throw new Error('No observed nonempty execution proof')
  if (profiles.some((item) => !target.runtimeProfiles.includes(item)))
    throw new Error('Unknown execution profile')
  let skipProof = { observedSkipped: 0 }
  if (skipped) {
    if (profiles.length !== 1 || skippedCases.length !== skipped)
      throw new Error('Unaccounted skipped execution; provide exact expected-skip proof')
    skipProof = authorizeExpectedSkips({
      repository: reports.repository,
      source: plan.identity.head,
      targetId: id,
      profile: profiles[0],
      skipPolicy: reports.skipPolicy,
      skippedCases,
    })
  }
  const result = {
    id,
    status: 'success',
    inventoryDigest: target.inventoryDigest,
    executedCount: count,
    ...(filtered ? { observedFiltered: filtered } : {}),
    basis,
    unexpectedSkips: 0,
    ...skipProof,
    ...(skipped ? { skipPolicy: reports.skipPolicy } : {}),
    profiles,
    ...(reports.artifacts ? { artifactsVerified: true } : {}),
    ...(reports.residue ? { residueVerified: true } : {}),
  }
  await writeFile(
    output,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        planDigest: plan.planDigest,
        source: plan.identity.head,
        results: [result],
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
}

export async function collectJobEvidence({
  planPath,
  directory,
  resultsPath,
  output,
  scope = 'ci',
}) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  const statuses = JSON.parse(await readFile(resultsPath, 'utf8'))
  const targets = plan.targets.filter((target) => target.scope === scope)
  const reports = []
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(path, entry.name))
      else if (entry.isFile() && entry.name.endsWith('.json'))
        reports.push(JSON.parse(await readFile(join(path, entry.name), 'utf8')))
    }
  }
  await walk(directory)
  const results = targets.map((target) => {
    if (!target.selected) {
      if (statuses[target.id] !== 'skipped')
        throw new Error(`Unexpected execution for omitted target ${target.id}`)
      return { id: target.id, status: 'skipped', omissionReason: target.omissionReason }
    }
    if (statuses[target.id] !== 'success')
      throw new Error(`Required job did not succeed: ${target.id}`)
    const rows = reports.flatMap((report) => {
      if (
        report.schemaVersion !== 1 ||
        !Array.isArray(report.results) ||
        report.planDigest !== plan.planDigest ||
        report.source !== plan.identity.head
      )
        throw new Error('Stale or malformed job evidence')
      if (report.results.some((row) => !targets.some((item) => item.id === row.id)))
        throw new Error('Unexpected execution report target')
      return report.results.filter((row) => row.id === target.id)
    })
    if (
      !rows.length ||
      rows.some(
        (row) =>
          row.status !== 'success' ||
          row.inventoryDigest !== target.inventoryDigest ||
          !Number.isSafeInteger(row.executedCount) ||
          row.executedCount <= 0 ||
          (row.observedFiltered !== undefined &&
            (!Number.isSafeInteger(row.observedFiltered) || row.observedFiltered < 0)),
      )
    )
      throw new Error(`Missing execution reports: ${target.id}`)
    const profiles = rows.flatMap((row) => row.profiles)
    if (new Set(profiles).size !== profiles.length)
      throw new Error(`Repeated execution profile: ${target.id}`)
    return {
      ...rows[0],
      executedCount: rows.reduce((sum, row) => sum + row.executedCount, 0),
      ...(rows.some((row) => row.observedFiltered !== undefined)
        ? { observedFiltered: rows.reduce((sum, row) => sum + (row.observedFiltered ?? 0), 0) }
        : {}),
      profiles,
      unexpectedSkips: rows.reduce((sum, row) => sum + row.unexpectedSkips, 0),
      observedSkipped: rows.reduce((sum, row) => sum + row.observedSkipped, 0),
      artifactsVerified: rows.every((row) => row.artifactsVerified === true),
      residueVerified: rows.every((row) => row.residueVerified === true),
    }
  })
  await writeFile(
    output,
    `${JSON.stringify(
      { schemaVersion: 1, planDigest: plan.planDigest, source: plan.identity.head, results },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(
      process.argv.slice(2),
      [
        '--plan',
        '--id',
        '--output',
        '--profile',
        '--profiles',
        '--skip-policy',
        '--transcript',
        '--transcript-manifest',
        '--host-evidence',
        '--python-transcript',
        '--junit',
        '--pages',
        '--qualification',
        '--summary',
        '--archives',
        '--directory',
        '--results',
        '--scope',
      ],
      ['--artifacts', '--residue'],
    )
    if (!options['--plan'] || !options['--output']) throw new Error('Provide --plan and --output')
    if (options['--directory'])
      await collectJobEvidence({
        planPath: options['--plan'],
        directory: options['--directory'],
        resultsPath: options['--results'],
        output: options['--output'],
        scope: options['--scope'],
      })
    else
      await writeJobEvidence({
        planPath: options['--plan'],
        id: options['--id'],
        output: options['--output'],
        profile: options['--profile'],
        profiles: options['--profiles']?.split(','),
        skipPolicy: options['--skip-policy'],
        transcript: options['--transcript'],
        transcriptManifest: options['--transcript-manifest'],
        hostEvidence: options['--host-evidence'],
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
