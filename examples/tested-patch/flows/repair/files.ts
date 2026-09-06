import { constants } from 'node:fs'
import { open, opendir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import checks from './checks.json'
import { inspect } from './evidence.ts'
import { parseInput, snapshotDigest, sha256, type RepairInput, type SourceFile } from './policy.ts'
import { repair } from './repair.ts'

/** Application policy: text only, one edit path, and a 64 KiB context budget. */
export async function readRepairInput(value: unknown, source: string): Promise<RepairInput> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'editPath,issue'
  )
    throw new TypeError('Supply only issue and editPath; source belongs in the read attachment.')
  const { issue, editPath } = value as { issue: string; editPath: string }
  const files: SourceFile[] = []
  let remaining = 65536,
    entries = 0
  const walk = async (relative: string) => {
    const directory = await opendir(join(source, relative))
    for await (const entry of directory) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      if (
        ++entries > 64 ||
        !/^[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*$/.test(path) ||
        path.split('/').length > 16
      )
        throw new TypeError('Unsupported source path or tree size.')
      if (entry.isSymbolicLink())
        throw new TypeError('Source attachments must not contain symlinks.')
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (files.length >= 16) throw new TypeError('Expected at most 16 text files.')
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
        files.push({
          path,
          content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            buffer.subarray(0, used),
          ),
        })
      } finally {
        await file.close()
      }
    }
  }
  await walk('')
  return parseInput({ issue, editPath, snapshot: { files, sha256: snapshotDigest(files) } })
}

export async function writeRepairDeliverables(
  path: string,
  input: RepairInput,
  result: RunResult,
): Promise<void> {
  const acceptance = {
    checkerSha256: sha256(await readFile(join(import.meta.dir, 'check.ts'), 'utf8')),
    casesSha256: sha256(await readFile(join(import.meta.dir, 'checks.json'), 'utf8')),
    cases: checks.cases,
  }
  const summary = inspect(result, input, acceptance)
  if (summary.status === 'invalid-evidence') throw new TypeError(summary.reason)
  const text =
    [
      summary.status,
      summary.reason,
      ...(summary.baseline === undefined
        ? []
        : [`Original checks: ${summary.baseline.passed}/${summary.baseline.total}`]),
      ...summary.attempts.map(
        (attempt) =>
          `Attempt ${attempt.number}: ${attempt.checks === undefined ? (attempt.failure ?? 'no check verdict') : `${attempt.checks.passed}/${attempt.checks.total} checks`}`,
      ),
    ].join('\n') + '\n'
  await writeFile(join(path, 'summary.txt'), text, { flag: 'wx' })
  for (const [index, patch] of summary.proposals.entries())
    await writeFile(join(path, `proposal-${index + 1}.patch`), patch, { flag: 'wx' })
  if (summary.status === 'review-ready')
    await writeFile(join(path, 'review.patch'), summary.proposals.at(-1)!, { flag: 'wx' })
}

export async function repairFiles(run: RunContext): Promise<RunResult> {
  const source = run.attachments.source,
    deliverables = run.attachments.deliverables
  if (source?.access !== 'read' || deliverables?.access !== 'read-write')
    throw new TypeError('Supply source and deliverables attachments.')
  const input = await readRepairInput(run.input, source.path)
  const result = await repair({
    input: input as unknown as RunContext['input'],
    signal: run.signal,
    callFlow: run.callFlow.bind(run),
    callEffect: run.callEffect.bind(run),
  })
  run.signal.throwIfAborted()
  await writeRepairDeliverables(deliverables.path, input, result)
  return result
}
