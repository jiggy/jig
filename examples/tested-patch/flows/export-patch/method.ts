import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { exportedPatchView } from './dashboard.ts'
import { unifiedPatch } from './patch.ts'

type ReviewData = {
  issue: string
  originals: Record<string, string>
  checked: {
    ready: boolean
    reason: string
    proposals: { number: number; replacements: { path: string; content: string }[] }[]
  }
}

export function patchFiles(data: ReviewData): Record<string, string> {
  const { issue, originals, checked } = data
  const files: Record<string, string> = {
    'goal.txt': issue + '\n',
    'summary.txt': `${checked.ready ? 'review-ready' : 'unsuccessful'}\n${checked.reason}\n${checked.proposals.length} validated proposal(s). See result.json for command output, termination, and individual assertions.\n`,
  }
  if (
    new Set(checked.proposals.map((proposal) => proposal.number)).size !== checked.proposals.length
  )
    throw new TypeError('Proposal numbers must be unique.')
  for (const proposal of checked.proposals) {
    if (proposal.number !== 1 && proposal.number !== 2)
      throw new TypeError('Proposal numbers must be 1 or 2.')
    let patch = ''
    for (const replacement of proposal.replacements) {
      if (!/^src\/[A-Za-z0-9_-]+(?:[./][A-Za-z0-9_-]+)*\.(ts|js)$/.test(replacement.path))
        throw new TypeError('Patch paths must identify source files below src/.')
      if (!Object.hasOwn(originals, replacement.path))
        throw new TypeError('Every replacement needs a captured original.')
      patch += unifiedPatch(replacement.path, originals[replacement.path]!, replacement.content)
    }
    files[`proposal-${proposal.number}.patch`] = patch
    if (checked.ready && proposal === checked.proposals.at(-1)) files['review.patch'] = patch
  }
  if (checked.ready && !files['review.patch'])
    throw new TypeError('A review-ready export needs a nonempty patch.')
  return files
}

export async function exportPatch(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  const destination = run.attachments.files
  if (destination?.access !== 'read-write')
    throw new TypeError('Supply a writable files attachment.')
  const data = run.input as unknown as ReviewData
  const files = patchFiles(data)
  const review = join(destination.path, 'review')
  await mkdir(review)
  for (const [name, text] of Object.entries(files)) {
    run.signal.throwIfAborted()
    await writeFile(join(review, name), text, { flag: 'wx' })
  }
  run.signal.throwIfAborted()
  reporter
    ?.view('patches', { title: 'Exported review files', landing: true })
    .update(exportedPatchView(files))
  return { outcome: 'done', output: { ready: data.checked.ready, files: Object.keys(files) } }
}
