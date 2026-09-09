import { constants } from 'node:fs'
import { open, opendir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { RunContext, RunResult } from '@jigging/flow'
import cases from './cases.json'
import { monitoredRepair } from './monitoring.ts'

function hash(text: string) {
  return `sha256:${new Bun.CryptoHasher('sha256').update(text).digest('hex')}`
}
export function identity(value: any): string {
  const canonical = (v: any): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : v !== null && typeof v === 'object'
        ? `{${Object.keys(v)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
            .join(',')}}`
        : JSON.stringify(v)
  return hash(canonical(value))
}
function validText(value: unknown, limit: number): value is string {
  return (
    typeof value === 'string' &&
    Buffer.byteLength(value) <= limit &&
    Buffer.from(value).toString('utf8') === value &&
    !value.includes('\0')
  )
}
export async function readRepairInput(value: unknown, source: string, selectedCases = cases) {
  const request = value as { issue: string; editPaths: string[] }
  if (
    !request ||
    Object.keys(request).sort().join(',') !== 'editPaths,issue' ||
    !validText(request.issue, 8000) ||
    !request.issue.trim() ||
    !Array.isArray(request.editPaths) ||
    request.editPaths.length < 1 ||
    request.editPaths.length > 8 ||
    new Set(request.editPaths).size !== request.editPaths.length
  )
    throw new TypeError('Supply an issue and selected editPaths.')
  const files: Record<string, string> = Object.create(null)
  let remaining = 65536,
    entries = 0
  const walk = async (relative: string) => {
    const directory = await opendir(join(source, relative))
    for await (const entry of directory) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (
        ++entries > 64 ||
        !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(path) ||
        path.split('/').length > 16 ||
        ['node_modules', '.git', '.jig'].includes(entry.name) ||
        entry.isSymbolicLink()
      )
        throw new TypeError('Unsupported source path or tree size.')
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (Object.keys(files).length >= 16) throw new TypeError('Expected at most 16 text files.')
      const file = await open(
        join(source, path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      )
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > remaining)
          throw new TypeError('Expected regular text files totaling at most 64 KiB.')
        const buffer = Buffer.alloc(remaining + 1)
        let used = 0
        while (used < buffer.length) {
          const { bytesRead } = await file.read(buffer, used, buffer.length - used, null)
          if (bytesRead === 0) break
          used += bytesRead
        }
        if (used > remaining) throw new TypeError('Source exceeds 64 KiB.')
        remaining -= used
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          buffer.subarray(0, used),
        )
        if (!validText(content, 65536)) throw new TypeError('Expected Unicode source without NUL.')
        files[path] = content
      } finally {
        await file.close()
      }
    }
  }
  await walk('')
  if (
    request.editPaths.some(
      (p) =>
        typeof p !== 'string' ||
        !p.startsWith('src/') ||
        !/\.(ts|js)$/.test(p) ||
        !Object.hasOwn(files, p),
    )
  )
    throw new TypeError('Select existing TypeScript or JavaScript source files below src/.')
  return { ...request, files, cases: selectedCases }
}

/** Build applicable complete-file hunks from captured originals, never from model diff text. */
export function unifiedPatch(path: string, before: string, after: string): string {
  if (before === after) return ''
  const lines = (text: string) =>
    text === '' ? [] : text.split('\n').slice(0, text.endsWith('\n') ? -1 : undefined)
  const oldLines = lines(before),
    newLines = lines(after)
  const body = (text: string, content: string[], prefix: string) =>
    content.map((line) => prefix + line + '\n').join('') +
    (content.length && !text.endsWith('\n') ? '\\ No newline at end of file\n' : '')
  return (
    `--- a/${path}\n+++ b/${path}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n` +
    body(before, oldLines, '-') +
    body(after, newLines, '+')
  )
}

type Input = Awaited<ReturnType<typeof readRepairInput>>
export function inspect(input: Input, result: RunResult) {
  const evidence = result.output as any
  if (
    !evidence ||
    evidence.baseDigest !== identity(input.files) ||
    evidence.acceptanceDigest !== identity(input.cases) ||
    !Array.isArray(evidence.attempts) ||
    evidence.attempts.length > 2 ||
    typeof evidence.reason !== 'string'
  )
    throw new TypeError('Repair evidence does not match the captured input.')
  const check = (evaluation: any, files: Record<string, string>) => {
    if (
      !evaluation ||
      evaluation.candidateDigest !== identity(files) ||
      !Array.isArray(evaluation.commands) ||
      evaluation.commands.length !== input.cases.length + 1
    )
      throw new TypeError('Incomplete command evidence.')
    for (const [i, command] of evaluation.commands.entries()) {
      if (
        command.candidateDigest !== identity(files) ||
        command.cleanup !== 'complete' ||
        command.stopReason !== 'exited' ||
        command.command !== (i === 0 ? 'tests' : 'cli') ||
        command.stdinDigest !== hash(i === 0 ? '' : input.cases[i - 1]!.stdin) ||
        !Array.isArray(command.invocation) ||
        command.invocation[0] !== 'bun' ||
        (i === 0
          ? command.invocation[1] !== 'test'
          : !isDeepStrictEqual(command.invocation.slice(2), input.cases[i - 1]!.args))
      )
        throw new TypeError('Command identity does not match the candidate and checks.')
      for (const log of [command.stdout, command.stderr])
        if (!log || typeof log.text !== 'string' || typeof log.truncated !== 'boolean')
          throw new TypeError('Missing command logs.')
    }
    const acceptance = input.cases.map((c, i) => {
      const observed = evaluation.commands[i + 1]
      return {
        id: c.id,
        passed:
          observed.exitCode === c.exitCode &&
          observed.signal === null &&
          !observed.stdout.truncated &&
          !observed.stderr.truncated &&
          observed.stdout.text === c.stdout &&
          observed.stderr.text === c.stderr,
      }
    })
    const tests = evaluation.commands[0]
    const repositoryTestsPassed =
      tests.exitCode === 0 &&
      tests.signal === null &&
      !tests.stdout.truncated &&
      !tests.stderr.truncated
    const accepted = repositoryTestsPassed && acceptance.every((c) => c.passed)
    if (
      !isDeepStrictEqual(acceptance, evaluation.acceptance) ||
      evaluation.repositoryTestsPassed !== repositoryTestsPassed ||
      evaluation.accepted !== accepted
    )
      throw new TypeError('The reported verdict contradicts collected command behavior.')
    return { accepted, acceptance }
  }
  const baseline = check(evidence.baseline, input.files)
  const proposals: { number: number; patch: string }[] = []
  let lastAccepted = false
  for (const [index, attempt] of evidence.attempts.entries()) {
    lastAccepted = false
    if (attempt.proposal === undefined) {
      if (typeof attempt.invalidProposal !== 'string')
        throw new TypeError('Missing proposal or rejection reason.')
      continue
    }
    const replacements = attempt.proposal.replacements
    if (
      !Array.isArray(replacements) ||
      replacements.length < 1 ||
      replacements.length > input.editPaths.length ||
      new Set(replacements.map((f) => f.path)).size !== replacements.length
    )
      throw new TypeError('Invalid replacement set.')
    const files = { ...input.files }
    let patch = ''
    for (const file of replacements) {
      if (!input.editPaths.includes(file.path) || !validText(file.content, 65536))
        throw new TypeError('Unapproved replacement.')
      files[file.path] = file.content
      patch += unifiedPatch(file.path, input.files[file.path]!, file.content)
    }
    if (
      Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0) > 65536 ||
      attempt.candidateDigest !== identity(files)
    )
      throw new TypeError('Candidate identity or size differs from its replacement bytes.')
    proposals.push({ number: index + 1, patch })
    if (attempt.evaluation) lastAccepted = check(attempt.evaluation, files).accepted
  }
  const ready = result.outcome === 'done'
  if (
    ready &&
    (!lastAccepted || baseline.acceptance.every((c) => c.passed) || !proposals.at(-1)?.patch)
  )
    throw new TypeError('Completion lacks a reproduced defect and independently accepted patch.')
  return { ready, proposals, reason: evidence.reason as string }
}
export function repairDeliverables(input: Input, result: RunResult): Record<string, string> {
  const summary = inspect(input, result)
  const files: Record<string, string> = {
    'summary.txt': `${summary.ready ? 'review-ready' : 'unsuccessful'}\n${summary.reason}\n${summary.proposals.length} validated proposal(s). See result.json for command output, termination, and individual assertions.\n`,
  }
  for (const proposal of summary.proposals)
    files[`proposal-${proposal.number}.patch`] = proposal.patch
  if (summary.ready) files['review.patch'] = summary.proposals.at(-1)!.patch
  return files
}
export async function writeRepairDeliverables(path: string, input: Input, result: RunResult) {
  for (const [name, text] of Object.entries(repairDeliverables(input, result)))
    await writeFile(join(path, name), text, { flag: 'wx' })
}
export async function repairFiles(run: RunContext): Promise<RunResult> {
  const { source, deliverables } = run.attachments
  if (source?.access !== 'read' || deliverables?.access !== 'read-write')
    throw new TypeError('Supply source and deliverables attachments.')
  const input = await readRepairInput(run.input, source.path)
  return monitoredRepair(run, input, async (result) => {
    run.signal.throwIfAborted()
    await writeRepairDeliverables(deliverables.path, input, result)
    await run.callCapability({
      operationId: 'progress:1',
      slot: 'progress',
      method: 'save',
      input: { sequence: 1, evidence: result, files: repairDeliverables(input, result) },
    })
  })
}
