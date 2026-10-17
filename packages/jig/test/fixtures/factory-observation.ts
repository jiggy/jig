import { expect } from 'bun:test'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { type ReportingMessage, validateReportingMessage } from '@jigging/reporting'
import { asciiJsonString } from '../../src/cli-usage.js'

export const lostObservation =
  "Live progress stopped before all updates were delivered. Check the final result for the work's outcome. (LAGGED)"
export const factorySummaries = {
  Jobs: [
    '2 requested repairs; 0 finished, 0 checked patches. Inspect a repair for its goal and scope; follow Activity for current work.',
    '2 independently checked patches ready for review. Original sources are unchanged.',
  ],
  Checks: [
    'Repository tests and independent CLI cases check each proposed patch. Worker reports remain provisional until independently verified.',
    'Finished checks: verified results are shown separately from provisional worker reports. Each patch is checked separately.',
  ],
  Patches: [
    '0 independently checked candidates for human review. Changes have not been applied. Preview requires verified packet delivery.',
    '2 independently checked candidates for human review. Changes have not been applied. Preview requires verified packet delivery.',
  ],
} as const

export function assertTypedObservation(
  transcript: string,
  summaries: Readonly<Record<string, readonly [string, string]>> = factorySummaries,
  writtenOutput?: string,
): 'ended' | 'lagged' {
  // Callers supply this physical destination only after checking its own packet,
  // complete inventory and bytes. Its quoted path is data, not a loss report.
  if (writtenOutput !== undefined) {
    if (!isAbsolute(writtenOutput))
      throw new Error('Factory observation requires an absolute verified output path')
    const header = `  Output: ${asciiJsonString(writtenOutput)}`
    const lines = transcript.split('\n')
    const outputs = lines.filter((line) => line.startsWith('  Output:'))
    if (outputs.length !== 1 || outputs[0] !== header || lines.indexOf(header) === lines.length - 1)
      throw new Error('Factory observation must identify its verified output exactly once')
    transcript = lines.filter((line) => line !== header).join('\n')
  }
  if (
    transcript.includes('\u001b') ||
    /Updates unavailable|Updates incomplete|presentation limit|DISCONNECTED|OWNER_CLOSED|INVALID_INPUT|INVALID_RESULT|RESOURCE_EXHAUSTED|PROTOCOL_ERROR|CHANNEL_LOST/.test(
      transcript,
    )
  )
    throw new Error('Factory observation contains an unexpected failure or terminal control')
  // These fixtures offer Jobs first and never replace or retire that root view.
  // Plain display retains every accepted view internally, but renders one root
  // purpose and only its changed meaning at settlement.
  const selected = 'Jobs'
  const known = summaries[selected]
  if (known === undefined) throw new Error('Factory observation has no declared root view')
  const lost = transcript.includes(lostObservation)
  const guidance = `  Jig — observation incomplete:\n      Flow: ${lostObservation}\n`
  const purposes = [...transcript.matchAll(/^ {2}Flow: ([^\n]+)\n {4}([^\n]+)\n/gm)].filter((row) =>
    Object.hasOwn(summaries, row[1]),
  )
  if (purposes.length > 1 || purposes.some((row) => row[1] !== selected || !known.includes(row[2])))
    throw new Error('Factory observation has an unknown or repeated root purpose')
  const retained = [
    ...transcript.matchAll(/^ {2}Flow \/ ([^\n:]+): ([^\n]+)\n(?: {4}([^\n]+)\n)?/gm),
  ]
  if (
    (lost ? retained.length > 1 : retained.length !== 1) ||
    retained.some((row) => row[1] !== selected) ||
    (purposes.length !== 0 && retained.length === 0)
  )
    throw new Error('Factory observation must retain only its selected root view')
  const context = lost
    ? `${lostObservation}; Live observation is incomplete. Inspect the final result; application reports remain provisional`
    : 'Observation ended; application reports remain provisional'
  if (lost) {
    if (
      transcript.includes('Observation ended') ||
      transcript.match(/^ {2}Jig — observation incomplete:$/gm)?.length !== 1 ||
      transcript.split(guidance).length !== 2 ||
      transcript.split('\n').filter((line) => line === `      Flow: ${lostObservation}`).length !==
        1
    )
      throw new Error('Factory observation loss must retain its exact incomplete explanation')
  }
  for (const row of retained) {
    if (row[2] !== context) throw new Error('Factory observation has inconsistent retained context')
    const summary = row[3] ?? purposes[0]?.[2]
    if (summary === undefined || !(lost ? known.includes(summary) : summary === known[1]))
      throw new Error('Factory observation has an unknown or incomplete clean root summary')
    if (row[3] !== undefined && row[3] === purposes[0]?.[2])
      throw new Error('Factory observation repeats unchanged root meaning')
  }
  let unexplained = transcript.replace(
    /^ {2}Flow: (?:HTTP log report|Timesheet totals): Live repair updates stopped \(LAGGED\)\. The repair result will still be checked\.$/gm,
    '',
  )
  if (lost) unexplained = unexplained.replace(guidance, '')
  for (const row of [...purposes, ...retained]) unexplained = unexplained.replace(row[0], '')
  if (
    /Flow \/|LAGGED|observation incomplete|Observation ended|application reports remain provisional/i.test(
      unexplained,
    )
  )
    throw new Error('Factory observation contains unexplained settlement or loss context')
  return lost ? 'lagged' : 'ended'
}

export function assertExplicitObservation(stdout: string): {
  status: 'closed' | 'lagged'
  updates: ReportingMessage[]
  terminal: ReturnType<typeof JSON.parse>
} {
  if (!stdout.endsWith('\n')) throw new Error('Explicit observation has an incomplete final line')
  const records = stdout
    .slice(0, -1)
    .split('\n')
    .map((line) => JSON.parse(line))
  const fields = (record: Record<string, unknown>, keys: string[]) => {
    if (
      record === null ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(keys.sort())
    )
      throw new Error('Explicit observation has unexpected record fields')
  }
  if (records.length < 3) throw new Error('Explicit observation is missing its channel lifecycle')
  const begin = records[0]
  fields(begin, ['type', 'channel', 'startSequence'])
  if (begin.type !== 'begin' || begin.channel !== 'progress' || begin.startSequence !== 1)
    throw new Error('Explicit observation has an unexpected channel beginning')
  const terminal = records.at(-1)
  fields(terminal, ['type', 'result'])
  if (
    terminal.type !== 'terminal' ||
    terminal.result === null ||
    typeof terminal.result !== 'object' ||
    Array.isArray(terminal.result)
  )
    throw new Error('Explicit observation is missing its authoritative terminal')
  const updates = records.slice(1, -2).map((record, index) => {
    fields(record, ['type', 'channel', 'sequence', 'value'])
    if (record.type !== 'data' || record.channel !== 'progress' || record.sequence !== index + 1)
      throw new Error('Explicit observation data is not a contiguous selected-channel prefix')
    return validateReportingMessage(record.value)
  })
  const end = records.at(-2)
  if (end.status === 'closed') {
    fields(end, ['type', 'channel', 'status', 'lastSequence'])
    if (end.lastSequence !== updates.length)
      throw new Error('Explicit observation has an inconsistent clean sequence ending')
  } else {
    fields(end, ['type', 'channel', 'status', 'code'])
    if (end.status !== 'failed' || end.code !== 'LAGGED')
      throw new Error('Explicit observation has an unsupported failed ending')
  }
  if (end.type !== 'end' || end.channel !== 'progress')
    throw new Error('Explicit observation is missing its selected-channel ending')
  return {
    status: end.status === 'closed' ? 'closed' : 'lagged',
    updates,
    terminal: terminal.result,
  }
}

export function assertFactoryPrefix(
  updates: ReportingMessage[],
  phase: 'blocked' | 'checked',
  jobs: ReturnType<typeof JSON.parse>,
) {
  const summaries: Readonly<Record<string, readonly string[]>> = {
    ...factorySummaries,
    Jobs: [
      factorySummaries.Jobs[0],
      phase === 'blocked'
        ? 'No checked patches. Inspect each repair for its cause; original sources are unchanged.'
        : factorySummaries.Jobs[1],
    ],
    Patches: [
      factorySummaries.Patches[0],
      phase === 'blocked' ? factorySummaries.Patches[0] : factorySummaries.Patches[1],
    ],
  }
  const paths = new Set([
    'summary.txt',
    ...['logs', 'timesheet'].flatMap((id) =>
      (phase === 'blocked'
        ? ['goal.txt', 'summary.txt']
        : ['goal.txt', 'summary.txt', 'proposal-1.patch', 'review.patch']
      ).map((file) => `${id}/${file}`),
    ),
  ])
  const references = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (
      object.kind === 'artifact' &&
      (object.attachment !== 'deliverables' || !paths.has(object.path as string))
    )
      throw new Error('Factory view references an unexpected delivered artifact')
    if (
      object.kind === 'call' &&
      !['repair:logs', 'repair:timesheet'].includes(object.operationId as string)
    )
      throw new Error('Factory view references an unexpected repair call')
    for (const child of Object.values(object)) references(child)
  }
  for (const update of updates) {
    if (update.kind === 'notice') {
      if (
        update.text !==
          'Software factory: 2 requested repairs. No checked patches yet. Jobs contains goals and scope; Checks contains evidence; Patches contains candidates for human review. Changes are not applied.' &&
        !['HTTP log report: ', 'Timesheet totals: '].some((label) => update.text.startsWith(label))
      )
        throw new Error('Factory notice has an unexpected reporting identity')
      continue
    }
    if (update.kind === 'activity' || update.kind === 'clear') {
      if (!['factory:logs', 'factory:timesheet'].includes(update.id))
        throw new Error('Factory activity has an unexpected repair identity')
      if (
        update.kind === 'activity' &&
        (!update.label.startsWith(
          update.id === 'factory:logs' ? 'HTTP log report: ' : 'Timesheet totals: ',
        ) ||
          update.operationId !== undefined ||
          update.progress !== undefined)
      )
        throw new Error('Factory activity has an unexpected reporting identity or control')
      continue
    }
    if (update.kind === 'retire-view') throw new Error('Factory view retired unexpectedly')
    if (update.kind !== 'view') continue
    const title = (
      { jobs: 'Jobs', checks: 'Checks', patches: 'Patches' } as Record<string, string>
    )[update.id]
    if (
      title === undefined ||
      title !== update.title ||
      !summaries[title]!.includes(update.summary)
    )
      throw new Error('Factory observation contains an unknown view prefix')
    expect(update.sections).toHaveLength(1)
    const blocks = update.sections[0]!.blocks
    expect(blocks).toHaveLength(update.id === 'checks' ? 1 : 2)
    const final = update.summary === summaries[title]![1]
    if (update.id === 'jobs')
      expect(blocks[0]).toMatchObject({
        kind: 'progress',
        completed: final ? 2 : 0,
        total: 2,
        unit: 'jobs',
      })
    const table = blocks[update.id === 'jobs' ? 1 : 0]
    if (table?.kind !== 'collection')
      throw new Error('Factory view is missing its declared collection')
    const ids =
      update.id === 'patches' && (phase === 'blocked' || !final) ? [] : ['logs', 'timesheet']
    expect(table.id).toBe(update.id)
    expect(table.total).toBe(ids.length)
    expect(table.rows.map((row) => row.id)).toEqual(ids)
    let settledRows = 0
    for (const row of table.rows) {
      const requested = jobs.find((job) => job.id === row.id)
      expect(requested).toBeDefined()
      const label = row.id === 'logs' ? 'HTTP log report' : 'Timesheet totals'
      expect(row.cells.job).toBe(label)
      if (update.id !== 'checks')
        expect(row.details?.[0]).toMatchObject({
          kind: 'report',
          text: `Requested goal: ${requested.issue}`,
          references: [
            { kind: 'artifact', attachment: 'deliverables', path: `${row.id}/goal.txt` },
          ],
        })
      if (update.id === 'jobs')
        expect(row.cells).toEqual({
          job: label,
          action: final
            ? phase === 'blocked'
              ? 'No checked patch'
              : 'Ready for review'
            : 'In progress',
          checks: final
            ? phase === 'blocked'
              ? 'No accepted patch'
              : 'Tests + 4/4 cases passed'
            : 'Verification pending',
          patch:
            final && phase === 'checked'
              ? { kind: 'artifact', attachment: 'deliverables', path: `${row.id}/review.patch` }
              : null,
        })
      if (update.id === 'checks') {
        const settled = row.cells.repository !== 'Verification pending'
        if (settled) settledRows++
        expect(row.cells).toEqual({
          job: label,
          repository: settled
            ? phase === 'blocked'
              ? 'No checked patch'
              : 'Verified pass'
            : 'Verification pending',
          cases: settled
            ? phase === 'blocked'
              ? 'No accepted patch'
              : '4/4 verified'
            : '4 supplied cases',
        })
      }
      if (update.id === 'patches')
        expect(row.cells).toEqual({
          job: label,
          files: requested.editPaths.join(', '),
          patch: { kind: 'artifact', attachment: 'deliverables', path: `${row.id}/review.patch` },
        })
    }
    if (update.id === 'checks') expect(settledRows === 2).toBe(final)
    references(update)
  }
}

export async function assertDeliveredPacket(
  terminal: ReturnType<typeof JSON.parse>,
  project: string,
  destination: string,
  files: string[],
) {
  expect(JSON.parse(await readFile(join(project, destination, 'result.json'), 'utf8'))).toEqual(
    terminal,
  )
  expect(terminal.delivery.files.map((file) => file.path).sort()).toEqual([...files].sort())
  const physical: string[] = []
  const walk = async (relative = '') => {
    for (const entry of await readdir(join(project, destination, 'files', relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(path)
      else {
        expect(entry.isFile()).toBe(true)
        physical.push(path)
      }
    }
  }
  await walk()
  expect(physical.sort()).toEqual([...files].sort())
  for (const file of terminal.delivery.files) {
    const bytes = await readFile(join(project, destination, 'files', file.path))
    expect(bytes.byteLength).toBe(file.bytes)
    expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(file.digest)
  }
}

export function assertRequestedJob(
  job: ReturnType<typeof JSON.parse>,
  requested: ReturnType<typeof JSON.parse>,
) {
  expect(requested).toBeDefined()
  const { id, label, directory, issue, editPaths, method } = requested
  expect(job).toMatchObject({ id, label, directory, issue, editPaths })
  expect(job.baseDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(job.acceptanceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(job.routing).toEqual({
    mode: 'explicit',
    candidateId: method,
    slot: method === 'p1' ? 'single-pass' : 'checked-correction',
  })
}

export function assertEvaluation(
  evaluation: ReturnType<typeof JSON.parse>,
  cases: ReturnType<typeof JSON.parse>,
  accepted: boolean,
) {
  expect(cases).toHaveLength(4)
  expect(evaluation).toMatchObject({ accepted, repositoryTestsPassed: accepted })
  expect(evaluation.acceptance.map((item) => item.id)).toEqual(cases.map((item) => item.id))
  expect(evaluation.commands).toHaveLength(5)
  expect(evaluation.candidateDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
  for (const [index, command] of evaluation.commands.entries()) {
    const input = index === 0 ? '' : cases[index - 1].stdin
    expect(command).toMatchObject({
      candidateDigest: evaluation.candidateDigest,
      cleanup: 'complete',
      stopReason: 'exited',
      signal: null,
      stdinDigest: `sha256:${createHash('sha256').update(input).digest('hex')}`,
    })
    expect(command.invocation).toEqual(
      index === 0
        ? ['bun', 'test', 'test/project.test.ts']
        : ['bun', 'src/cli.ts', ...cases[index - 1].args],
    )
    expect(command.stdout.truncated).toBe(false)
    expect(command.stderr.truncated).toBe(false)
    expect(typeof command.stdout.text).toBe('string')
    expect(typeof command.stderr.text).toBe('string')
    if (index === 0) expect(command.exitCode).toBe(accepted ? 0 : 1)
    else {
      expect(Number.isInteger(command.exitCode) && command.exitCode >= 0).toBe(true)
      const expected = cases[index - 1]
      const passed =
        command.exitCode === expected.exitCode &&
        command.stdout.text === expected.stdout &&
        command.stderr.text === expected.stderr
      expect(evaluation.acceptance[index - 1].passed).toBe(passed)
      if (accepted) expect(passed).toBe(true)
    }
  }
}
